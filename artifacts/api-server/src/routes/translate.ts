import { Router, type IRouter } from "express";
import { translateAndGenerateTts, type TranslationInput } from "../lib/translationService";

const router: IRouter = Router();
const MIN_CONFIDENCE = 0.3;
const HALLUCINATION_PHRASES = [
  "thank you for watching",
  "subscribe to our channel",
  "music",
  "applause",
];
const MOVIE_DIALOGUE_TRANSCRIPTION_PROMPT = [
  "This audio is from a movie.",
  "Only transcribe clearly audible spoken dialogue.",
  "Do not infer missing words.",
  "Do not guess dialogue.",
  "Do not generate text if speech is unclear.",
  "If there is no understandable speech, return an empty response.",
  "Ignore music, background sounds, applause, explosions and effects.",
].join(" ");

const DEEPGRAM_MODELS = ["nova-3", "nova-2"] as const;
const OPENAI_MODELS = ["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe-diarize"] as const;

type DeepgramModel = (typeof DEEPGRAM_MODELS)[number];
type OpenAIModel = (typeof OPENAI_MODELS)[number];

function isDeepgramModel(model: string): model is DeepgramModel {
  return (DEEPGRAM_MODELS as readonly string[]).includes(model);
}

function isOpenAIModel(model: string): model is OpenAIModel {
  return (OPENAI_MODELS as readonly string[]).includes(model);
}

function containsHallucinationPhrase(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return HALLUCINATION_PHRASES.some((phrase) => normalized.includes(phrase));
}

router.post("/translate/chunk", async (req, res): Promise<void> => {
  const {
    audio,
    audioExt,
    targetLanguage,
    targetLanguages,
    sessionId,
    previousText,
    previousTranscripts,
    sourceLanguage,
    benchmarkMode = false,
    model,
    sttModel = "nova-3",
    cinemaMode = false,
    diarize = false,
    compressionMode = false,
    skipTTS = false,
  } = req.body;
  const translationModel = model || "gpt-4o";
  const startTime = Date.now();

  if (!sourceLanguage || sourceLanguage === "auto") {
    res.status(400).json({ error: "Source language selection is required" });
    return;
  }

  if (!process.env.OPENAI_API_KEY && !process.env.DEEPGRAM_API_KEY) {
    const mockLatencyMs = Date.now() - startTime;
    res.json({
      originalText: "Mock transcription",
      translatedText: `Mock translation to ${targetLanguage}`,
      sourceLanguage,
      audioBase64: "",
      latencyMs: mockLatencyMs,
      confidence: 0.9,
    });
    return;
  }

  const audioBuffer = Buffer.from(audio, "base64");
  const ext = audioExt ?? "wav";
  const mimeType = ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : "audio/webm";

  let originalText = "";
  let confidence = 0;
  let detectedLanguage = sourceLanguage;
  let speaker: string | null = null;
  let sttLatencyMs = 0;
  let translationLatencyMs = 0;
  let ttsLatencyMs = 0;
  let usedSttModel = sttModel;
  const sttStartTime = Date.now();

  const useDeepgram = isDeepgramModel(sttModel) && process.env.DEEPGRAM_API_KEY;
  const useOpenAI = isOpenAIModel(sttModel) && process.env.OPENAI_API_KEY;

  if (useDeepgram) {
    try {
      const url = new URL("https://api.deepgram.com/v1/listen");
      url.searchParams.append("model", sttModel);
      url.searchParams.append("smart_format", "true");
      url.searchParams.append("punctuate", "true");
      url.searchParams.append("paragraphs", "true");
      if (diarize) {
        url.searchParams.append("diarize", "true");
      }
      if (sourceLanguage && sourceLanguage !== "auto") {
        url.searchParams.append("language", sourceLanguage);
      } else {
        url.searchParams.append("detect_language", "true");
      }

      const dgResponse = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Authorization": `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": mimeType,
        },
        body: audioBuffer,
      });

      if (dgResponse.ok) {
        const dgData = await dgResponse.json() as any;
        const alternative = dgData?.results?.channels?.[0]?.alternatives?.[0];
        originalText = alternative?.transcript?.trim() ?? "";
        confidence = alternative?.confidence ?? 0.9;
        detectedLanguage = dgData?.metadata?.languages?.[0] ?? sourceLanguage;

        if (diarize && alternative?.paragraphs?.paragraphs?.[0]?.speaker !== undefined) {
          speaker = `Speaker ${alternative.paragraphs.paragraphs[0].speaker}`;
        }

        console.log(`Deepgram (${sttModel}) success. Text: "${originalText}", Lang: ${detectedLanguage}, Speaker: ${speaker}`);
      } else {
        const errorText = await dgResponse.text();
        console.error(`Deepgram ${sttModel} error:`, dgResponse.status, errorText);
      }
    } catch (dgErr) {
      console.warn(`Deepgram ${sttModel} failed:`, dgErr);
    }
  }

  if (!originalText && useOpenAI) {
    try {
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const useDiarizeModel = diarize && sttModel !== "whisper-1";
      const transcriptionOptions: any = {
        file: new File([audioBuffer], `audio.${ext}`, { type: mimeType }),
        model: useDiarizeModel ? "gpt-4o-transcribe-diarize" : sttModel,
        response_format: "json",
        prompt: MOVIE_DIALOGUE_TRANSCRIPTION_PROMPT,
      };
      if (sourceLanguage && sourceLanguage !== "auto") {
        transcriptionOptions.language = sourceLanguage;
      }

      try {
        const transcription = await openai.audio.transcriptions.create(transcriptionOptions);
        originalText = (transcription as any).text?.trim() ?? "";
        detectedLanguage = (transcription as any).language ?? sourceLanguage;
        usedSttModel = useDiarizeModel ? "gpt-4o-transcribe-diarize" : sttModel;
      } catch (err: any) {
        if (err?.status === 400 && String(err).toLowerCase().includes("language")) {
          console.warn(`Language '${sourceLanguage}' not supported. Retrying with auto-detection.`);
          delete transcriptionOptions.language;
          const transcription = await openai.audio.transcriptions.create(transcriptionOptions);
          originalText = (transcription as any).text?.trim() ?? "";
          detectedLanguage = (transcription as any).language ?? sourceLanguage;
        } else {
          throw err;
        }
      }

      confidence = 0.9;
      console.log(`OpenAI (${usedSttModel}) success. Text: "${originalText}", Lang: ${detectedLanguage}`);
    } catch (err) {
      console.error("OpenAI STT error:", err);
    }
  }

  if (!originalText) {
    res.json({
      originalText: "",
      translatedText: "",
      sourceLanguage: detectedLanguage,
      audioBase64: "",
      latencyMs: Date.now() - startTime,
      sttModel: usedSttModel,
      confidence: 0,
    });
    return;
  }

  if (confidence < MIN_CONFIDENCE) {
    console.log(`Transcription rejected: confidence ${confidence.toFixed(3)} < ${MIN_CONFIDENCE}. Text: "${originalText}"`);
    res.json({
      originalText: "",
      translatedText: "",
      sourceLanguage: detectedLanguage,
      audioBase64: "",
      latencyMs: Date.now() - startTime,
      sttModel: usedSttModel,
      confidence,
    });
    return;
  }

  if (containsHallucinationPhrase(originalText)) {
    console.log(`Transcription rejected: hallucination detected. Text: "${originalText}"`);
    res.json({
      originalText: "",
      translatedText: "",
      sourceLanguage: detectedLanguage,
      audioBase64: "",
      latencyMs: Date.now() - startTime,
      sttModel: usedSttModel,
      confidence,
    });
    return;
  }

  sttLatencyMs = Date.now() - sttStartTime;

  const OpenAI = (await import("openai")).default;
  const openaiForTts = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const useCompression = compressionMode || (Array.isArray(previousTranscripts) && previousTranscripts.length > 8);

  const translationInput: TranslationInput = {
    originalText,
    sourceLanguage: detectedLanguage,
    targetLanguage,
    targetLanguages,
    sessionId,
    previousTranscripts,
    speaker,
    primaryLang: targetLanguage,
    cinemaMode,
    compressionMode: useCompression,
    skipTTS,
    translationModel,
  };

  const translationResult = await translateAndGenerateTts(translationInput, openaiForTts);

  translationLatencyMs = translationResult.translationLatencyMs;
  ttsLatencyMs = translationResult.ttsLatencyMs;
  const latencyMs = Date.now() - startTime;

  res.json({
    originalText: translationResult.originalText,
    translatedText: translationResult.translatedText,
    translations: translationResult.translations,
    sourceLanguage: detectedLanguage,
    speaker: translationResult.speaker,
    audioBase64: translationResult.audioBase64,
    latencyMs,
    sttLatencyMs,
    translationLatencyMs,
    ttsLatencyMs,
    confidence,
    sttModel: usedSttModel,
  });
});

export default router;
