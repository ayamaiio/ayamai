import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  AcceptAccessInviteBody,
  AcceptAccessInviteResponse,
  CreateAccessInviteBody,
  CreateAccessInviteResponse,
  GetAccessMeResponse,
  RevokeAccessInviteParams,
  RevokeAccessMemberParams,
  ValidateAccessInviteBody,
  ValidateAccessInviteResponse,
} from "@workspace/api-zod";
import { AccessError, acceptAccessInvite, createAccessInvite, getAccessSnapshot, requireActiveOwner, revokeAccessInvite, revokeAccessMember, validateAccessInvite } from "../lib/access-control";
import { getRequestUserId, requireClerkAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
const validationAttempts = new Map<string, { count: number; resetAt: number }>();
const VALIDATION_WINDOW_MS = 10 * 60 * 1000;
const VALIDATION_LIMIT = 30;

const run = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch((error: unknown) => {
      if (!(error instanceof AccessError)) { next(error); return; }
      if (error.retryAfterSeconds) res.set("Retry-After", String(error.retryAfterSeconds));
      res.status(error.status).set("Cache-Control", "private, no-store").json({
        error: error.message,
        ...(error.status === 429 ? { code: "ACCESS_RATE_LIMITED", retryAfterSeconds: error.retryAfterSeconds } : {}),
      });
    });
  };

function publicValidationLimit(req: Request, res: Response): boolean {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  for (const [candidate, value] of validationAttempts) {
    if (value.resetAt <= now) validationAttempts.delete(candidate);
  }
  if (!validationAttempts.has(key) && validationAttempts.size >= 10_000) {
    res.status(429).set({ "Cache-Control": "private, no-store", "Retry-After": "600" }).json({ error: "Invitation checks are temporarily busy. Try again later." });
    return false;
  }
  const current = validationAttempts.get(key);
  if (current && current.resetAt > now && current.count >= VALIDATION_LIMIT) {
    res.status(429).set({ "Cache-Control": "private, no-store", "Retry-After": "600" }).json({ error: "Too many invitation checks. Try again later." });
    return false;
  }
  validationAttempts.set(key, current && current.resetAt > now
    ? { count: current.count + 1, resetAt: current.resetAt }
    : { count: 1, resetAt: now + VALIDATION_WINDOW_MS });
  return true;
}

router.use("/access", (_req, res, next) => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  next();
});

router.get("/access/me", requireClerkAuth, run(async (req, res) => {
  res.json(GetAccessMeResponse.parse(await getAccessSnapshot(getRequestUserId(req))));
}));

router.post("/access/invites/validate", run(async (req, res) => {
  if (!publicValidationLimit(req, res)) return;
  const body = ValidateAccessInviteBody.safeParse(req.body);
  if (!body.success) throw new AccessError(400, "Invitation is invalid or expired.");
  res.json(ValidateAccessInviteResponse.parse(await validateAccessInvite(body.data.token)));
}));

router.post("/access/invites/accept", requireClerkAuth, run(async (req, res) => {
  const body = AcceptAccessInviteBody.safeParse(req.body);
  if (!body.success) throw new AccessError(400, "Invitation is invalid or expired.");
  const userId = getRequestUserId(req);
  await acceptAccessInvite(userId, body.data.token);
  res.json(AcceptAccessInviteResponse.parse(await getAccessSnapshot(userId)));
}));

router.post("/access/invites", requireClerkAuth, run(async (req, res) => {
  const body = CreateAccessInviteBody.safeParse(req.body);
  if (!body.success) throw new AccessError(400, "Enter a valid email address.");
  const userId = getRequestUserId(req);
  await requireActiveOwner(userId);
  const result = await createAccessInvite(userId, body.data.email);
  res.status(201).json(CreateAccessInviteResponse.parse(result));
}));

router.delete("/access/invites/:id", requireClerkAuth, run(async (req, res) => {
  const params = RevokeAccessInviteParams.safeParse(req.params);
  if (!params.success) throw new AccessError(400, "Invitation not found.");
  const userId = getRequestUserId(req);
  await requireActiveOwner(userId);
  await revokeAccessInvite(params.data.id);
  res.sendStatus(204);
}));

router.delete("/access/members/:userId", requireClerkAuth, run(async (req, res) => {
  const params = RevokeAccessMemberParams.safeParse(req.params);
  if (!params.success) throw new AccessError(400, "Member not found.");
  const userId = getRequestUserId(req);
  await requireActiveOwner(userId);
  await revokeAccessMember(userId, params.data.userId);
  res.sendStatus(204);
}));

export default router;
