import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import http from "http";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

const { default: app } = await import("./app");
const { logger } = await import("./lib/logger");

export { app };

const rawPort = process.env["PORT"];

if (rawPort) {
  const port = Number(rawPort);
  if (!Number.isNaN(port) && port > 0) {
    const server = http.createServer(app);

    const { WebSocketServer } = await import("ws");
    const { handleStreamConnection } = await import("./routes/stream");
    const wss = new WebSocketServer({ server, path: "/api/stream" });
    wss.on("connection", handleStreamConnection);

    server.listen(port, () => {
      logger.info({ port, ws: true }, "Server listening with WebSocket support");
    });
  }
}
