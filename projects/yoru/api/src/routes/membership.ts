import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import { RedeemMembershipBody } from "@workspace/api-zod";
import { getRequestUserId, requireMember, requireIdentity } from "../middlewares/requireAuth";
import { ensureMembership, invitationSummary, issueInvitation, redeemInvitation, referralRelationships, revokeInvitation } from "../lib/membership";
import { isModerator, requireAdult, socialLimit, SocialError } from "../lib/social-access";

const router = Router();
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch((error: unknown) => error instanceof SocialError
    ? res.status(error.status).json({ error: error.message }) : next(error));
};
router.use("/membership", requireIdentity, (_req, res, next) => {
  res.set({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }); next();
});
router.get("/membership", run(async (req, res) => {
  await socialLimit(getRequestUserId(req), "membership-status", 60);
  const member = await ensureMembership(getRequestUserId(req));
  res.json({ member, isOperator: member && isModerator(req) });
}));
router.post("/membership/redeem", run(async (req, res) => {
  const uid = getRequestUserId(req);
  await socialLimit(uid, "invitation-redeem", 10);
  const body = RedeemMembershipBody.safeParse(req.body);
  if (!body.success) throw new SocialError(400, "Enter a valid invitation and acknowledge the referral record.");
  await redeemInvitation(uid, body.data.token);
  res.json({ member: true, isOperator: isModerator(req) });
}));
router.get("/membership/invitations", requireMember, run(async (req, res) => {
  const uid = getRequestUserId(req); await socialLimit(uid, "invitation-list", 60);
  res.json(await invitationSummary(uid));
}));
router.post("/membership/invitations", requireMember, run(async (req, res) => {
  const uid = getRequestUserId(req);
  await requireAdult(uid); await socialLimit(uid, "invitation-issue", 10);
  res.status(201).json(await issueInvitation(uid));
}));
router.delete("/membership/invitations/:id", requireMember, run(async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw new SocialError(400, "Invalid invitation ID.");
  const uid = getRequestUserId(req); await socialLimit(uid, "invitation-revoke", 20);
  await revokeInvitation(uid, id.data); res.sendStatus(204);
}));
router.get("/membership/referrals", requireMember, run(async (req, res) => {
  if (!isModerator(req)) throw new SocialError(403, "Operator access required.");
  const uid = getRequestUserId(req); await requireAdult(uid); await socialLimit(uid, "referral-graph", 20);
  const cursor = z.string().min(1).max(128).optional().safeParse(req.query.cursor);
  if (!cursor.success) throw new SocialError(400, "Invalid cursor.");
  res.json(await referralRelationships(cursor.data));
}));
export default router;
