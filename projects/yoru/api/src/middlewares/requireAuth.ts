import type { Request, RequestHandler } from "express";
import { ensureMembership } from "../lib/membership";
import { SocialError } from "../lib/social-access";
import { isActiveAccessMember } from "../lib/access-control";
import { isMediaTicketRequest } from "../lib/media-ticket-path";
import { requestUserId } from "../lib/local-dev-auth";

export const requireIdentity: RequestHandler = (req, res, next) => {
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  // Capture writes bind to the account explicitly paired in the destination tab.
  // A newly selected Clerk account must never inherit an in-flight draft.
  const captureAccount = req.get("X-Capture-Account");
  if (captureAccount && captureAccount !== userId) {
    res.status(409).json({ error: "The paired account changed. Start a new capture." });
    return;
  }

  next();
};

export const requireClerkAuth: RequestHandler = requireIdentity;

// Existing feature routers keep using requireAuth. The API root applies
// requireAppMembership before those routers so even a valid Clerk session
// without an invitation cannot reach private application data.
export const requireAuth = requireIdentity;

export const requireAppMembership: RequestHandler = async (req, res, next) => {
  if (isMediaTicketRequest(req.method, req.path)) { next(); return; }
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).set("Cache-Control", "private, no-store").json({ error: "Authentication required." });
    return;
  }
  try {
    if (!(await isActiveAccessMember(userId))) {
      res.status(403).set("Cache-Control", "private, no-store").json({ error: "An active ayamai invitation is required." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireMember: RequestHandler = (req, res, next) => {
  requireIdentity(req, res, () => {
    void ensureMembership(getRequestUserId(req)).then((member) => {
      if (!member) { res.status(403).set("Cache-Control", "private, no-store").json({ error: "An invitation is required to enter ayamai.", code: "INVITATION_REQUIRED" }); return; }
      next();
    }).catch((error: unknown) => {
      res.status(error instanceof SocialError ? error.status : 503).set({ "Cache-Control": "private, no-store", "Retry-After": "5" })
        .json({ error: error instanceof SocialError ? error.message : "Could not check membership. Please try again." });
    });
  });
};

export function getRequestUserId(req: Request): string {
  const userId = requestUserId(req);
  if (!userId) {
    throw new Error("Authentication required.");
  }
  return userId;
}
