import { Router, type IRouter } from "express";
import { db, translationLogsTable, translationSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

const LANGUAGE_NAMES: Record<string, string> = {
  Greek: "Greek",
  English: "English",
  Hindi: "Hindi",
  Telugu: "Telugu",
  Russian: "Russian",
  German: "German",
  French: "French",
  Arabic: "Arabic",
  Spanish: "Spanish",
  Italian: "Italian",
  Portuguese: "Portuguese",
  Japanese: "Japanese",
  Korean: "Korean",
  Chinese: "Chinese",
};

const TTS_VOICE_MAP: Record<string, "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | "ash" | "ballad" | "coral" | "sage" | "verse"> = {
  Greek: "nova",
  English: "alloy",
  Hindi: "shimmer",
  Telugu: "shimmer",
  Russian: "echo",
  German: "onyx",
  French: "fable",
  Arabic: "nova",
  Spanish: "coral",
  Italian: "sage",
  Portuguese: "ballad",
  Japanese: "ash",
  Korean: "verse",
  Chinese: "nova",
};

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
  const translationStartTime = Date.now();

  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const languagesToTranslate = Array.isArray(targetLanguages) && targetLanguages.length > 0
    ? targetLanguages
    : [targetLanguage];

  const primaryLang = targetLanguage;
  
  // Get active listeners early to know all languages needed
  const activeListeners = await db
    .select()
    .from((await import("@workspace/db")).sessionListenersTable)
    .where(eq((await import("@workspace/db")).sessionListenersTable.sessionId, sessionId));

  const allLanguages = new Set<string>([primaryLang, ...languagesToTranslate]);
  activeListeners.forEach(listener => allLanguages.add(listener.targetLanguage));

  const translations: Record<string, string> = {};

  // Execute all translations in parallel
  await Promise.all(
    Array.from(allLanguages).map(async (lang) => {
      const langName = LANGUAGE_NAMES[lang] ?? lang;
      const isPrimary = lang === primaryLang;
      
      const messages: any[] = [
        {
          role: "system",
          content: [
            `You are a professional translator. Translate the given text into ${langName}.`,
            `Output ONLY the translated text, no explanations, no notes, no quotes.`,
            `Preserve names, places, emotional tone, and movie terminology.`,
            isPrimary ? `Use the context from previous translations to maintain consistency.` : "",
            isPrimary && cinemaMode ? `Prioritize accuracy over speed. Use formal register when appropriate.` : "",
            isPrimary && compressionMode ? `Translate concisely. Remove filler words (um, uh, well, like, you know, I mean). Keep essential meaning only. Shorter is better.` : "",
          ].filter(Boolean).join(" "),
        },
      ];

      if (isPrimary) {
        if (Array.isArray(previousTranscripts) && previousTranscripts.length > 0) {
          const contextLimit = cinemaMode ? 20 : 10;
          const contextWindow = previousTranscripts.slice(-contextLimit).join(" ");
          messages.push({
            role: "system",
            content: `Previous dialogue context (for consistency): ${contextWindow}`,
          });
        } else if (previousText) {
          messages.push({
            role: "system",
            content: `Previous text: ${previousText}`,
          });
        }

        if (speaker) {
          messages.push({
            role: "system",
            content: `Note: This dialogue is spoken by ${speaker}.`,
          });
        }
      }

      messages.push({
        role: "user",
        content: originalText,
      });

      try {
        const response = await openai.chat.completions.create({
          model: translationModel,
          max_tokens: 1000,
          messages,
        });
        translations[lang] = response.choices[0]?.message?.content?.trim() ?? "";
      } catch (err) {
        console.error(`Translation error for ${lang}:`, err);
        translations[lang] = "";
      }
    })
  );

  const translatedText = translations[primaryLang] ?? "";
  translationLatencyMs = Date.now() - translationStartTime;
  const ttsStartTime = Date.now();

  let audioBase64 = "";

  // Run TTS and DB insertion in parallel
  await Promise.all([
    (async () => {
      try {
        const voice = TTS_VOICE_MAP[primaryLang] ?? "alloy";
        const ttsResponse = await openai.audio.speech.create({
          model: "tts-1", // Fixed model from gpt-4o-mini-tts to standard tts-1
          voice,
          input: translatedText || " ",
          response_format: "pcm",
        });
        audioBase64 = Buffer.from(await ttsResponse.arrayBuffer()).toString("base64");
      } catch (err) {
        console.error("TTS error:", err);
      }
    })(),
    (async () => {
      try {
        await db.insert(translationLogsTable).values({
          sessionId,
          originalText,
          translatedText,
          sourceLanguage,
          targetLanguage: primaryLang,
          speaker,
        });
      } catch (err) {
        console.error("DB insert error:", err);
      }
    })()
  ]);

  ttsLatencyMs = Date.now() - ttsStartTime;
  const latencyMs = Date.now() - startTime;

  const listenerTranslations: Record<string, string> = {};
  for (const listener of activeListeners) {
    if (listener.targetLanguage !== primaryLang && translations[listener.targetLanguage]) {
      listenerTranslations[listener.targetLanguage] = translations[listener.targetLanguage];
    }
  }

  res.json({
    originalText,
    translatedText,
    translations: { ...translations, ...listenerTranslations },
    sourceLanguage: detectedLanguage,
    speaker,
    audioBase64,
    latencyMs,
    sttLatencyMs,
    translationLatencyMs,
    ttsLatencyMs,
    confidence,
    sttModel: usedSttModel,
  });
});

export default router;
