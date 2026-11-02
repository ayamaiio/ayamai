import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { assertLocalDevAuthConfiguration, createLocalFounderAuth, localFounderModeEnabled } from "./lib/local-dev-auth";
import { membershipBoundary } from "./middlewares/membershipBoundary";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

assertLocalDevAuthConfiguration();
const localFounderAuth = createLocalFounderAuth();
const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigins = new Set(
  [
    ...(process.env.REPLIT_DOMAINS ?? "")
      .split(",")
      .map((domain) => domain.trim())
      .filter(Boolean)
      .map((domain) => `https://${domain}`),
    process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "",
    ...(process.env.NODE_ENV === "production"
      ? []
      : [
          process.env.AYAMAI_PUBLIC_ORIGIN ?? "http://ayamai.local",
          "http://localhost:25221", "http://127.0.0.1:25221",
          "http://localhost:25222", "http://127.0.0.1:25222",
        ]),
  ].filter(Boolean),
);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed."));
    },
  }),
);
// Screenshot captures arrive as base64 from the browser; the default 100kb
// limit rejects every real one.
app.use(express.json({ limit: "48mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(localFounderModeEnabled()
  ? (_req, _res, next) => next()
  : clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })));

app.use(localFounderAuth.middleware);
app.post("/api/dev-auth/session", localFounderAuth.createSession);

app.use("/api", membershipBoundary, router);

// Express's development error page includes stacks/SQL, which can identify an
// anonymous uploader. Keep failures explicit without sending internal details.
const safeErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) { next(error); return; }
  const status = error?.type === "entity.parse.failed" ? 400 : 500;
  logger.error({ name: error instanceof Error ? error.name : "UnknownError", requestId: req.id }, "API request failed");
  // Capture is a local-only path; surface the real reason instead of a shrug.
  if (req.path.includes("/capture")) {
    logger.error({ message: (error as Error)?.message, stack: (error as Error)?.stack?.split("\n").slice(0, 3) }, "capture failure detail");
  }
  res.status(status).set("Cache-Control", "private, no-store").json({
    error: status === 400 ? "Invalid JSON request."
      : req.path.startsWith("/capture") ? ((error as Error)?.message ?? "capture failed")
      : "The request could not be completed. Please try again.",
  });
};
app.use(safeErrorHandler);

export default app;
