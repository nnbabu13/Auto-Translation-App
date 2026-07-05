import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, translationSessionsTable, translationLogsTable, sessionListenersTable } from "@workspace/db";
import {
  CreateSessionBody,
  GetSessionParams,
  DeleteSessionParams,
  ListSessionLogsParams,
  GetSessionExportParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sessions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sessions = await db
    .select({
      id: translationSessionsTable.id,
      name: translationSessionsTable.name,
      sourceLanguage: translationSessionsTable.sourceLanguage,
      targetLanguage: translationSessionsTable.targetLanguage,
      targetLanguages: translationSessionsTable.targetLanguages,
      createdAt: translationSessionsTable.createdAt,
      logCount: sql<number>`(SELECT COUNT(*) FROM translation_logs WHERE session_id = ${translationSessionsTable.id})::int`,
    })
    .from(translationSessionsTable)
    .where(eq(translationSessionsTable.userId, req.user.id))
    .orderBy(desc(translationSessionsTable.createdAt));

  res.json(sessions);
});

router.post("/sessions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const targetLanguages = parsed.data.targetLanguages || [parsed.data.targetLanguage];
  const sourceLanguage = parsed.data.sourceLanguage || "en";

  const [session] = await db
    .insert(translationSessionsTable)
    .values({
      userId: req.user.id,
      name: parsed.data.name,
      sourceLanguage,
      targetLanguage: parsed.data.targetLanguage,
      targetLanguages,
    })
    .returning();

  res.status(201).json({ ...session, logCount: 0 });
});

router.get("/sessions/stats", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  const [totalSessionsResult, totalLogsResult, recentSessions] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(translationSessionsTable)
      .where(eq(translationSessionsTable.userId, userId)),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(translationLogsTable)
      .innerJoin(translationSessionsTable, eq(translationLogsTable.sessionId, translationSessionsTable.id))
      .where(eq(translationSessionsTable.userId, userId)),
    db
      .select({
        id: translationSessionsTable.id,
        name: translationSessionsTable.name,
        sourceLanguage: translationSessionsTable.sourceLanguage,
        targetLanguage: translationSessionsTable.targetLanguage,
        targetLanguages: translationSessionsTable.targetLanguages,
        createdAt: translationSessionsTable.createdAt,
        logCount: sql<number>`(SELECT COUNT(*) FROM translation_logs WHERE session_id = ${translationSessionsTable.id})::int`,
      })
      .from(translationSessionsTable)
      .where(eq(translationSessionsTable.userId, userId))
      .orderBy(desc(translationSessionsTable.createdAt))
      .limit(5),
  ]);

  res.json({
    totalSessions: totalSessionsResult[0]?.count ?? 0,
    totalLogs: totalLogsResult[0]?.count ?? 0,
    recentSessions,
  });
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(translationSessionsTable)
    .where(eq(translationSessionsTable.id, params.data.id));

  if (!session || session.userId !== req.user.id) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const logs = await db
    .select()
    .from(translationLogsTable)
    .where(eq(translationLogsTable.sessionId, params.data.id))
    .orderBy(translationLogsTable.timestamp);

  const listeners = await db
    .select()
    .from(sessionListenersTable)
    .where(eq(sessionListenersTable.sessionId, params.data.id))
    .orderBy(desc(sessionListenersTable.joinedAt));

  res.json({ ...session, logCount: logs.length, logs, listeners });
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(translationSessionsTable)
    .where(eq(translationSessionsTable.id, params.data.id));

  if (!session || session.userId !== req.user.id) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await db.delete(translationSessionsTable).where(eq(translationSessionsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/sessions/:id/logs", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const params = ListSessionLogsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(translationSessionsTable)
    .where(eq(translationSessionsTable.id, params.data.id));

  if (!session || session.userId !== req.user.id) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const logs = await db
    .select()
    .from(translationLogsTable)
    .where(eq(translationLogsTable.sessionId, params.data.id))
    .orderBy(translationLogsTable.timestamp);

  res.json(logs);
});

router.get("/sessions/:id/export", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const params = GetSessionExportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(translationSessionsTable)
    .where(eq(translationSessionsTable.id, params.data.id));

  if (!session || session.userId !== req.user.id) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const logs = await db
    .select()
    .from(translationLogsTable)
    .where(eq(translationLogsTable.sessionId, params.data.id))
    .orderBy(translationLogsTable.timestamp);

  const lines: string[] = [
    `Cinema AI Translator — Session Export`,
    `Session: ${session.name}`,
    `Target Languages: ${(session.targetLanguages || [session.targetLanguage]).join(", ")}`,
    `Created: ${session.createdAt.toISOString()}`,
    `Total Entries: ${logs.length}`,
    ``,
    `---`,
    ``,
  ];

  for (const log of logs) {
    lines.push(`[${log.timestamp.toISOString()}]`);
    if (log.speaker) {
      lines.push(`Speaker: ${log.speaker}`);
    }
    lines.push(`Detected: ${log.sourceLanguage}`);
    lines.push(`Original:    ${log.originalText}`);
    lines.push(`Translation (${log.targetLanguage}): ${log.translatedText}`);
    lines.push(``);
  }

  const content = lines.join("\n");
  const filename = `session-${session.id}-${session.name.replace(/\s+/g, "-")}.txt`;

  res.json({ content, filename });
});

router.post("/sessions/:id/listeners", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { listenerName, targetLanguage } = req.body;
  if (!listenerName || !targetLanguage) {
    res.status(400).json({ error: "listenerName and targetLanguage are required" });
    return;
  }

  const [session] = await db
    .select()
    .from(translationSessionsTable)
    .where(eq(translationSessionsTable.id, params.data.id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [listener] = await db
    .insert(sessionListenersTable)
    .values({
      sessionId: params.data.id,
      listenerName,
      targetLanguage,
    })
    .returning();

  res.status(201).json(listener);
});

router.delete("/sessions/:id/listeners/:listenerId", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const listenerId = Number(req.params.listenerId);
  if (isNaN(listenerId)) {
    res.status(400).json({ error: "Invalid listener ID" });
    return;
  }

  await db
    .update(sessionListenersTable)
    .set({ leftAt: new Date() })
    .where(eq(sessionListenersTable.id, listenerId));

  res.sendStatus(204);
});

router.get("/sessions/:id/listeners", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const listeners = await db
    .select()
    .from(sessionListenersTable)
    .where(eq(sessionListenersTable.sessionId, params.data.id))
    .orderBy(desc(sessionListenersTable.joinedAt));

  res.json(listeners);
});

export default router;
