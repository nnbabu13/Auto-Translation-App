import { app } from "../api-server-bundle.mjs";

export default function handler(req, res) {
  return app(req, res);
}

export const config = {
  maxDuration: 120,
};
