import { Router, type IRouter } from "express";
import { db, translationLogsTable, translationSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const MIN_CONFIDENCE = 0.3;
const STT_MODEL = "gpt-4o-mini-transcribe";
const DIARIZE_MODEL = "gpt-4o-transcribe-diarize";
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
    cinemaMode = false,
    diarize = false,
  } = req.body;
  const translationModel = model || "gpt-4o";
  const startTime = Date.now();

  if (!sourceLanguage || sourceLanguage === "auto") {
    res.status(400).json({ error: "Source language selection is required" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
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

  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const audioBuffer = Buffer.from(audio, "base64");
  const ext = audioExt ?? "wav";
  const mimeType = ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : "audio/webm";

  let transcription: any;
  let confidence = 0;
  let originalText = "";
  let detectedLanguage = sourceLanguage;
  let speaker: string | null = null;
  let sttLatencyMs = 0;
  let translationLatencyMs = 0;
  let ttsLatencyMs = 0;
  const sttStartTime = Date.now();

  if (process.env.DEEPGRAM_API_KEY) {
    try {
      const url = new URL("https://api.deepgram.com/v1/listen");
      url.searchParams.append("model", "nova-3");
      url.searchParams.append("smart_format", "true");
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

        console.log(`Deepgram transcription success. Text: "${originalText}", Language: ${detectedLanguage}, Speaker: ${speaker}`);
      } else {
        const errorText = await dgResponse.text();
        console.error("Deepgram transcription API error:", dgResponse.status, errorText);
        throw new Error(`Deepgram failed: ${dgResponse.status} - ${errorText}`);
      }
    } catch (dgErr) {
      console.warn("Deepgram STT failed, falling back to OpenAI Whisper:", dgErr);
    }
  }

  if (!originalText) {
    try {
      const useDiarizeModel = diarize && process.env.OPENAI_API_KEY;
      const transcriptionOptions: any = {
        file: new File([audioBuffer], `audio.${ext}`, { type: mimeType }),
        model: useDiarizeModel ? DIARIZE_MODEL : STT_MODEL,
        response_format: useDiarizeModel ? "verbose_json" : "json",
        prompt: MOVIE_DIALOGUE_TRANSCRIPTION_PROMPT,
      };
      if (sourceLanguage && sourceLanguage !== "auto") {
        transcriptionOptions.language = sourceLanguage;
      }

      try {
        transcription = await openai.audio.transcriptions.create(transcriptionOptions);
      } catch (err: any) {
        if (err?.status === 400 && (err?.code === 'unsupported_language' || String(err).toLowerCase().includes("language"))) {
          console.warn(`Language code '${sourceLanguage}' not supported. Retrying with auto-detection.`);
          delete transcriptionOptions.language;
          transcription = await openai.audio.transcriptions.create(transcriptionOptions);
        } else {
          throw err;
        }
      }

      const segments = transcription?.segments;
      if (Array.isArray(segments) && segments.length > 0) {
        confidence = segments.reduce((sum: number, seg: any) => sum + (seg?.confidence || 0.9), 0) / segments.length;

        if (diarize && segments[0]?.speaker !== undefined) {
          speaker = `Speaker ${segments[0].speaker}`;
        }
      } else {
        confidence = 0.9;
      }
      originalText = (transcription as any).text?.trim() ?? "";
      detectedLanguage = (transcription as any).language ?? sourceLanguage;
    } catch (err) {
      console.error("STT error:", err);
      res.json({
        originalText: "",
        translatedText: "",
        sourceLanguage: detectedLanguage,
        audioBase64: "",
        latencyMs: Date.now() - startTime,
        confidence: 0,
      });
      return;
    }
  }

  if (!originalText) {
    res.json({
      originalText: "",
      translatedText: "",
      sourceLanguage: detectedLanguage,
      audioBase64: "",
      latencyMs: Date.now() - startTime,
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
      confidence,
    });
    return;
  }

  sttLatencyMs = Date.now() - sttStartTime;
  const translationStartTime = Date.now();

  const languagesToTranslate = Array.isArray(targetLanguages) && targetLanguages.length > 0
    ? targetLanguages
    : [targetLanguage];

  const primaryLang = targetLanguage;
  const primaryLangName = LANGUAGE_NAMES[primaryLang] ?? primaryLang;

  const messages: any[] = [
    {
      role: "system",
      content: [
        `You are a professional translator. Translate the given text into ${primaryLangName}.`,
        `Output ONLY the translated text, no explanations, no notes, no quotes.`,
        `Preserve names, places, emotional tone, and movie terminology.`,
        `Use the context from previous translations to maintain consistency.`,
        cinemaMode ? `Prioritize accuracy over speed. Use formal register when appropriate.` : "",
      ].filter(Boolean).join(" "),
    },
  ];

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

  messages.push({
    role: "user",
    content: originalText,
  });

  let translatedText = "";
  try {
    const translationResponse = await openai.chat.completions.create({
      model: translationModel,
      max_tokens: 1000,
      messages,
    });
    translatedText = translationResponse.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error("Translation error:", err);
  }

  const translations: Record<string, string> = { [primaryLang]: translatedText };

  if (languagesToTranslate.length > 1) {
    for (const lang of languagesToTranslate) {
      if (lang === primaryLang) continue;
      const langName = LANGUAGE_NAMES[lang] ?? lang;
      try {
        const extraResponse = await openai.chat.completions.create({
          model: translationModel,
          max_tokens: 1000,
          messages: [
            {
              role: "system",
              content: `You are a professional translator. Translate the given text into ${langName}. Output ONLY the translated text, no explanations, no notes, no quotes. Preserve names, places, emotional tone, and movie terminology.`,
            },
            { role: "user", content: originalText },
          ],
        });
        translations[lang] = extraResponse.choices[0]?.message?.content?.trim() ?? "";
      } catch (err) {
        console.error(`Translation error for ${lang}:`, err);
      }
    }
  }

  translationLatencyMs = Date.now() - translationStartTime;
  const ttsStartTime = Date.now();

  let audioBase64 = "";
  try {
    const voice = TTS_VOICE_MAP[primaryLang] ?? "alloy";
    const ttsResponse = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: translatedText,
      response_format: "pcm",
    });
    audioBase64 = Buffer.from(await ttsResponse.arrayBuffer()).toString("base64");
  } catch (err) {
    console.error("TTS error:", err);
  }

  ttsLatencyMs = Date.now() - ttsStartTime;
  const latencyMs = Date.now() - startTime;

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

  const activeListeners = await db
    .select()
    .from((await import("@workspace/db")).sessionListenersTable)
    .where(eq((await import("@workspace/db")).sessionListenersTable.sessionId, sessionId));

  const listenerTranslations: Record<string, string> = {};
  for (const listener of activeListeners) {
    if (listener.targetLanguage !== primaryLang && translations[listener.targetLanguage]) {
      listenerTranslations[listener.targetLanguage] = translations[listener.targetLanguage];
    } else if (listener.targetLanguage !== primaryLang && !translations[listener.targetLanguage]) {
      try {
        const langName = LANGUAGE_NAMES[listener.targetLanguage] ?? listener.targetLanguage;
        const extraResponse = await openai.chat.completions.create({
          model: translationModel,
          max_tokens: 1000,
          messages: [
            {
              role: "system",
              content: `You are a professional translator. Translate the given text into ${langName}. Output ONLY the translated text. Preserve names, places, emotional tone, and movie terminology.`,
            },
            { role: "user", content: originalText },
          ],
        });
        listenerTranslations[listener.targetLanguage] = extraResponse.choices[0]?.message?.content?.trim() ?? "";
      } catch (err) {
        console.error(`Listener translation error for ${listener.targetLanguage}:`, err);
      }
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
    model: diarize ? DIARIZE_MODEL : STT_MODEL,
  });
});

export default router;
