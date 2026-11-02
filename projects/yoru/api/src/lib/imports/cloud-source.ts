import { z } from "zod/v4";
import { CloudApi } from "./cloud-api";
import { cloudAccess } from "./cloud-accounts";
import { openSource } from "./providers";
import { ImportError, type Provider } from "./network";

const accountSource = z.object({ kind: z.literal("cloud-account"), accountId: z.uuid() });
export async function openImportSource(provider: Provider, source: string, sourceId: string, signal: AbortSignal, userId: string) {
  if (!source.startsWith("{")) return openSource(provider, source, sourceId, signal);
  const parsed = accountSource.safeParse(JSON.parse(source));
  if (!parsed.success || provider === "mega") throw new ImportError("This import source is invalid. Create a new preview.");
  const credentials = await cloudAccess(userId, provider, parsed.data.accountId, signal);
  return new CloudApi(provider, credentials.accessToken, signal).open(sourceId);
}
