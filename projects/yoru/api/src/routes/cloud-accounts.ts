import { Router, type IRouter, type Request } from "express";
import {
  AuthorizeCloudAccountParams, AuthorizeCloudAccountResponse, BrowseCloudEntriesParams,
  BrowseCloudEntriesQueryParams, BrowseCloudEntriesResponse, DisconnectCloudAccountParams,
  FinishCloudAuthorizationParams, FinishCloudAuthorizationQueryParams, ListCloudAccountsResponse,
  PreviewCloudSelectionBody, PreviewCloudSelectionParams,
} from "@workspace/api-zod";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import {
  beginCloudAuthorization, cloudAccess, cloudAccountStatus, cloudConfig,
  disconnectCloudAccount, finishCloudAuthorization, openCloudCursor, sealCloudCursor,
} from "../lib/imports/cloud-accounts";
import { CloudApi, expandCloudSelection, type CloudProvider } from "../lib/imports/cloud-api";
import { ImportError } from "../lib/imports/network";
import { publicImportError } from "../lib/imports/providers";
import { sealSource } from "../lib/imports/source-crypto";
import { createImportPreview } from "./imports";

const router: IRouter = Router();
router.use("/imports/accounts", requireAuth, (_req, res, next) => {
  res.set({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
  next();
});
function checkOrigin(req: Request, provider: CloudProvider) {
  const config = cloudConfig(provider);
  if (!config) throw new ImportError("This provider needs OAuth app configuration before accounts can be connected.");
  if (req.get("origin") !== config.origin) throw new ImportError("Open this app at its configured cloud-import address to connect or browse an account.");
}
const cookieName = (provider: CloudProvider) => `cloud_oauth_${provider}`;
const cookieOptions = (provider: CloudProvider) => ({
  httpOnly: true, secure: true, sameSite: "lax" as const,
  path: `/api/imports/accounts/${provider}/callback`, maxAge: 10 * 60_000,
});
function stateCookie(req: Request, provider: CloudProvider) {
  const cookies = req.headers.cookie?.split(";").map((part) => part.trim());
  return cookies?.find((part) => part.startsWith(`${cookieName(provider)}=`))?.slice(cookieName(provider).length + 1);
}

router.get("/imports/accounts", async (req, res): Promise<void> => {
  res.json(ListCloudAccountsResponse.parse(await cloudAccountStatus(getRequestUserId(req))));
});
router.post("/imports/accounts/:provider/authorize", async (req, res): Promise<void> => {
  const params = AuthorizeCloudAccountParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Choose Drive or Dropbox." }); return; }
  try {
    checkOrigin(req, params.data.provider);
    const result = await beginCloudAuthorization(getRequestUserId(req), params.data.provider);
    res.cookie(cookieName(params.data.provider), result.state, cookieOptions(params.data.provider));
    res.json(AuthorizeCloudAccountResponse.parse({ url: result.url }));
  } catch (error) { res.status(400).json({ error: publicImportError(error) }); }
});
router.get("/imports/accounts/:provider/callback", async (req, res): Promise<void> => {
  const params = FinishCloudAuthorizationParams.safeParse(req.params);
  const query = FinishCloudAuthorizationQueryParams.safeParse(req.query);
  let success = false;
  if (params.success) {
    const provider = params.data.provider;
    const cookie = stateCookie(req, provider);
    res.clearCookie(cookieName(provider), cookieOptions(provider));
    try {
      if (!query.success || !query.data.state || cookie !== query.data.state) throw new ImportError("Authorization could not be verified.");
      await finishCloudAuthorization(getRequestUserId(req), provider, query.data.state, query.data.error ? undefined : query.data.code);
      success = true;
    } catch { /* Do not reflect authorization codes, tokens, or provider errors into HTML. */ }
  }
  // No script, external assets, raw query, tokens, or postMessage payload.
  res.status(success ? 200 : 400).set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    .type("html").send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Cloud authorization</title><h1>${success ? "Account connected" : "Account not connected"}</h1><p>${success ? "You can close this tab and return to the import window." : "Authorization was cancelled, expired, or could not be verified. Close this tab and try connecting again from the import window."}</p></html>`);
});
router.delete("/imports/accounts/:provider", async (req, res): Promise<void> => {
  const params = DisconnectCloudAccountParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Choose Drive or Dropbox." }); return; }
  try {
    // Allow disconnect even after configuration has been removed.
    const origin = req.get("origin");
    if (!origin || origin !== process.env.CLOUD_IMPORT_ORIGIN) throw new ImportError("Open this app at its configured cloud-import address to disconnect.");
    await disconnectCloudAccount(getRequestUserId(req), params.data.provider);
    res.sendStatus(204);
  } catch (error) { res.status(400).json({ error: publicImportError(error) }); }
});
router.get("/imports/accounts/:provider/entries", async (req, res): Promise<void> => {
  const params = BrowseCloudEntriesParams.safeParse(req.params);
  const query = BrowseCloudEntriesQueryParams.safeParse(req.query);
  if (!params.success || !query.success) { res.status(400).json({ error: "Choose a valid folder." }); return; }
  try {
    const userId = getRequestUserId(req), provider = params.data.provider, folder = query.data.folder ?? "";
    const credentials = await cloudAccess(userId, provider);
    const cursor = query.data.cursor ? openCloudCursor(query.data.cursor, userId, provider, credentials.accountId, folder) : undefined;
    const page = await new CloudApi(provider, credentials.accessToken, AbortSignal.timeout(25_000)).list(folder, cursor);
    res.json(BrowseCloudEntriesResponse.parse({
      entries: page.entries,
      cursor: page.cursor ? sealCloudCursor(userId, provider, credentials.accountId, folder, page.cursor) : null,
    }));
  } catch (error) { res.status(400).json({ error: publicImportError(error) }); }
});
router.post("/imports/accounts/:provider/preview", async (req, res): Promise<void> => {
  const params = PreviewCloudSelectionParams.safeParse(req.params);
  const body = PreviewCloudSelectionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Select up to 200 folders or files." }); return; }
  try {
    const userId = getRequestUserId(req), provider = params.data.provider;
    checkOrigin(req, provider);
    const credentials = await cloudAccess(userId, provider);
    res.status(201).json(await createImportPreview(userId, provider, sealSource(JSON.stringify({
      kind: "cloud-account", accountId: credentials.accountId,
    }), userId), () => expandCloudSelection(
      new CloudApi(provider, credentials.accessToken, AbortSignal.timeout(25_000)), body.data.ids,
    ), credentials.accountId));
  } catch (error) { res.status(400).json({ error: publicImportError(error) }); }
});
export default router;
