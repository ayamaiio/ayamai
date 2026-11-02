import type { RequestHandler } from "express";
import { requireMember } from "./requireAuth";
import { isMediaTicketRequest } from "../lib/media-ticket-path";

// A closed-by-default API boundary protects even newly added resource routes.
// These exceptions have their own authentication/authorization, or expose only health.
export const membershipBoundary: RequestHandler = (req, res, next) => {
  const path = req.path;
  if (process.env.AYAMAI_CURATOR_ENABLED === "true" && process.env.NODE_ENV === "development" && process.env.HOST === "127.0.0.1" && (path === "/curator" || path.startsWith("/curator/"))) { next(); return; }
  // A personal browser extension has no session cookie. The capture route only
  // accepts requests on loopback and only writes into the local library.
  if (req.method === "GET" && (path === "/capture/events" || path === "/capture/live" || path === "/capture/existing") && process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim() &&
      (req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1")) { next(); return; }
  if (req.method === "POST" && (path === "/capture/url" || path === "/capture/bytes" || path === "/capture/import" || path === "/capture/log" || path === "/capture/link" || path === "/capture/from-json") && process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim() &&
      (req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1")) { next(); return; }
  if (path === "/healthz" || path === "/edge/media-authorize" || path === "/membership" || path.startsWith("/membership/") ||
      path === "/access" || path.startsWith("/access/") ||
      isMediaTicketRequest(req.method, path)) {
    next(); return;
  }
  requireMember(req, res, next);
};
