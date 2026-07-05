import type { IncomingMessage, ServerResponse } from "http";
import app from "../api-server-bundle.mjs";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return app(req, res);
}

export const config = {
  maxDuration: 120,
};
