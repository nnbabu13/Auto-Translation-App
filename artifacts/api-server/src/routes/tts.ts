import { Router, type IRouter } from "express";
import { synthesizeSpeech, hasPiperVoice, listAvailableVoices } from "../lib/piperTts";

const router: IRouter = Router();

router.post("/tts", async (req, res): Promise<void> => {
  const { text, language } = req.body;

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }

  if (!language || typeof language !== "string") {
    res.status(400).json({ error: "language is required" });
    return;
  }

  if (!hasPiperVoice(language)) {
    res.status(400).json({
      error: `No Piper voice available for ${language}`,
      availableVoices: listAvailableVoices(),
    });
    return;
  }

  try {
    const audioBuffer = await synthesizeSpeech(text, language);
    if (!audioBuffer) {
      res.status(500).json({ error: "TTS synthesis failed" });
      return;
    }

    res.set("Content-Type", "audio/wav");
    res.send(audioBuffer);
  } catch (err) {
    console.error("TTS endpoint error:", err);
    res.status(500).json({ error: "Internal TTS error" });
  }
});

router.get("/tts/voices", (_req, res): void => {
  res.json({
    voices: listAvailableVoices(),
  });
});

export default router;
