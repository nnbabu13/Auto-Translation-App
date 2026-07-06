import { db, translationLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { synthesizeSpeech, hasPiperVoice } from "./piperTts";
import type OpenAI from "openai";

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

export interface TranslationInput {
  originalText: string;
  sourceLanguage: string;
  targetLanguage: string;
  targetLanguages?: string[];
  sessionId: number;
  previousTranscripts?: string[];
  speaker?: string | null;
  primaryLang: string;
  cinemaMode?: boolean;
  compressionMode?: boolean;
  skipTTS?: boolean;
  translationModel?: string;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  translations?: Record<string, string>;
  sourceLanguage: string;
  speaker: string | null;
  audioBase64: string;
  translationLatencyMs: number;
  ttsLatencyMs: number;
  listenerTranslations?: Record<string, string>;
}

export async function translateAndGenerateTts(
  input: TranslationInput,
  openai: OpenAI,
): Promise<TranslationResult> {
  const {
    originalText,
    sourceLanguage,
    targetLanguage,
    targetLanguages,
    sessionId,
    previousTranscripts,
    speaker,
    primaryLang,
    cinemaMode = false,
    compressionMode = false,
    skipTTS = false,
    translationModel = "gpt-4o",
  } = input;

  const translationStartTime = Date.now();
  const languagesToTranslate = Array.isArray(targetLanguages) && targetLanguages.length > 0
    ? targetLanguages
    : [targetLanguage];

  const { sessionListenersTable } = await import("@workspace/db");
  const activeListeners = await db
    .select()
    .from(sessionListenersTable)
    .where(eq(sessionListenersTable.sessionId, sessionId));

  const allLanguages = new Set<string>([primaryLang, ...languagesToTranslate]);
  activeListeners.forEach(listener => allLanguages.add(listener.targetLanguage));

  const translations: Record<string, string> = {};

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
  const translationLatencyMs = Date.now() - translationStartTime;
  const ttsStartTime = Date.now();

  let audioBase64 = "";

  if (!skipTTS) {
    await Promise.all([
      (async () => {
        try {
          if (hasPiperVoice(primaryLang)) {
            const wavBuffer = await synthesizeSpeech(translatedText || " ", primaryLang);
            if (wavBuffer) {
              audioBase64 = wavBuffer.toString("base64");
            }
          } else {
            const voice = TTS_VOICE_MAP[primaryLang] ?? "alloy";
            const ttsResponse = await openai.audio.speech.create({
              model: "tts-1",
              voice,
              input: translatedText || " ",
              response_format: "pcm",
            });
            audioBase64 = Buffer.from(await ttsResponse.arrayBuffer()).toString("base64");
          }
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
  } else {
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
  }

  const ttsLatencyMs = Date.now() - ttsStartTime;

  const listenerTranslations: Record<string, string> = {};
  for (const listener of activeListeners) {
    if (listener.targetLanguage !== primaryLang && translations[listener.targetLanguage]) {
      listenerTranslations[listener.targetLanguage] = translations[listener.targetLanguage];
    }
  }

  return {
    originalText,
    translatedText,
    translations: { ...translations, ...listenerTranslations },
    sourceLanguage,
    speaker: speaker ?? null,
    audioBase64,
    translationLatencyMs,
    ttsLatencyMs,
    listenerTranslations,
  };
}
