import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import sessionsRouter from "./sessions";
import translateRouter from "./translate";
import ttsRouter from "./tts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(sessionsRouter);
router.use(translateRouter);
router.use(ttsRouter);

export default router;
