import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";

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

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Ensure the mock dev user exists in the database (satisfies FK constraints)
const DEV_USER = {
  id: "test-user-id-123",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profileImageUrl: null,
};

if (process.env.DATABASE_URL) {
  db.insert(usersTable)
    .values(DEV_USER)
    .onConflictDoNothing({ target: usersTable.id })
    .then(() => logger.info("Dev user ensured in database"))
    .catch((err) => logger.warn({ err }, "Could not upsert dev user (non-fatal)"));
} else {
  logger.warn("DATABASE_URL not set — skipping dev user seed");
}

// Add a mock user to req for development
app.use((req, res, next) => {
  (req as any).user = DEV_USER;
  (req as any).isAuthenticated = () => true;
  next();
});

app.use("/api", router);

export default app;

