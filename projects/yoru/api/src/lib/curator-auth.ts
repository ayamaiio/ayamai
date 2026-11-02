import crypto from "node:crypto";
import type { Request, RequestHandler } from "express";
import { requestUserId } from "./local-dev-auth";
import { eq } from "drizzle-orm";
import { db, curatorTokensTable as tokens } from "@workspace/db";
import { isActiveAccessMember } from "./access-control";

export const CURATOR_SCOPE = "curator:write";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function issueToken(): string {
  return `cur_${crypto.randomBytes(32).toString("base64url")}`;
}

/**
 * Accepts either a Clerk session (future in-app surface) or a scoped personal
 * access token (local Curator client). Both resolve to a stable account id and
 * both require an active membership. There is no development bypass.
 */
export const requireCuratorIdentity: RequestHandler = (req, res, next) => {
  void (async () => {
    try {
      const header = req.get("authorization") ?? "";
      const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

      if (bearer.startsWith("cur_")) {
        if (req.method !== "POST" || req.path !== "/labels/batch") { res.status(403).json({error:"Curator tokens can only submit label batches."}); return; }
        const [row] = await db.select().from(tokens).where(eq(tokens.tokenHash, hashToken(bearer))).limit(1);
        if (!row || row.revokedAt) {
          res.status(401).set("Cache-Control", "private, no-store").json({ error: "Invalid curator token." });
          return;
        }
        if (!row.scopes.includes(CURATOR_SCOPE)) {
          res.status(403).set("Cache-Control", "private, no-store").json({ error: "Token lacks curator scope." });
          return;
        }
        if (!(await isActiveAccessMember(row.labelerAccountId))) {
          res.status(403).set("Cache-Control", "private, no-store").json({ error: "An active ayamai invitation is required." });
          return;
        }
        setCuratorUser(req, row.labelerAccountId);
        void db.update(tokens).set({ lastUsedAt: new Date() }).where(eq(tokens.id, row.id)).catch(() => {});
        next();
        return;
      }

      const userId = requestUserId(req);
      if (!userId) {
        res.status(401).set("Cache-Control", "private, no-store").json({ error: "Authentication required." });
        return;
      }
      if (!(await isActiveAccessMember(userId))) {
        res.status(403).set("Cache-Control", "private, no-store").json({ error: "An active ayamai invitation is required." });
        return;
      }
      setCuratorUser(req, userId);
      next();
    } catch (error) {
      next(error);
    }
  })();
};

type CuratorRequest = Request & { curatorUserId?: string };

function setCuratorUser(req: Request, userId: string) {
  (req as CuratorRequest).curatorUserId = userId;
}

export function getCuratorUserId(req: Request): string {
  const userId = (req as CuratorRequest).curatorUserId;
  if (!userId) throw new Error("Curator identity missing.");
  return userId;
}

/** Token management is session-only; a token must never mint another token. */
export function requireSessionIdentity(req: Request): string {
  if (req.get("authorization")?.startsWith("Bearer cur_")) { const error = new Error("Tokens cannot manage tokens."); Object.assign(error, {status:403}); throw error; }
  const userId = requestUserId(req);
  if (!userId) {
    const error = new Error("A signed-in session is required to manage curator tokens.");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  const curatorUser = (req as CuratorRequest).curatorUserId;
  if (curatorUser && curatorUser !== userId) {
    const error = new Error("A personal token cannot manage curator tokens.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
  return userId;
}
