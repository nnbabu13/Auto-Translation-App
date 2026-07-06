import { type IncomingMessage } from "http";
import { WebSocket as WsSocket } from "ws";
import OpenAI from "openai";
import { translateAndGenerateTts, type TranslationInput } from "../lib/translationService";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

function getParam(url: string, name: string): string | null {
  const u = new URL(url, `http://${process.env.HOST ?? "localhost"}`);
  return u.searchParams.get(name);
}

export async function handleStreamConnection(clientWs: WsSocket, req: IncomingMessage) {
  const reqUrl = req.url ?? "";
  const sessionId = Number(getParam(reqUrl, "sessionId"));
  const targetLanguage = getParam(reqUrl, "targetLanguage");
  const sourceLanguage = getParam(reqUrl, "sourceLanguage") ?? "en";
  const translationModel = getParam(reqUrl, "model") ?? "gpt-4o";
  const cinemaMode = getParam(reqUrl, "cinemaMode") === "true";
  const diarize = getParam(reqUrl, "diarize") === "true";
  const sttModel = getParam(reqUrl, "sttModel") ?? "nova-3";
  const compressionMode = getParam(reqUrl, "compressionMode") === "true";
  const skipTTS = getParam(reqUrl, "skipTTS") === "true";

  if (!sessionId || !targetLanguage) {
    clientWs.send(JSON.stringify({ type: "error", message: "Missing sessionId or targetLanguage" }));
    clientWs.close();
    return;
  }

  if (!DEEPGRAM_API_KEY) {
    clientWs.send(JSON.stringify({ type: "error", message: "Deepgram API key not configured" }));
    clientWs.close();
    return;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const dgUrl = new URL("wss://api.deepgram.com/v1/listen");
  dgUrl.searchParams.set("model", sttModel);
  dgUrl.searchParams.set("encoding", "linear16");
  dgUrl.searchParams.set("sample_rate", "16000");
  dgUrl.searchParams.set("channels", "1");
  dgUrl.searchParams.set("interim_results", "true");
  dgUrl.searchParams.set("endpointing", "500");
  dgUrl.searchParams.set("utterance_end_ms", "2000");
  dgUrl.searchParams.set("smart_format", "true");
  dgUrl.searchParams.set("punctuate", "true");
  if (sourceLanguage !== "auto") {
    dgUrl.searchParams.set("language", sourceLanguage);
  }
  if (diarize) {
    dgUrl.searchParams.set("diarize", "true");
  }

  const dgWs = new WsSocket(dgUrl.toString(), {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });

  let utteranceCounter = 0;
  let sequenceCounter = 0;
  let currentUtteranceId: string | null = null;
  const transcriptHistory: { text: string; timestamp: number }[] = [];
  let dgReady = false;

  dgWs.on("open", () => {
    dgReady = true;
  });

  dgWs.on("message", (raw) => {
    let parsed: any;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (parsed.channel) {
      const alternative = parsed.channel?.alternatives?.[0];
      const text = alternative?.transcript?.trim();
      if (!text) return;

      const isFinal = parsed.is_final && parsed.speech_final;
      const confidence = alternative?.confidence ?? 0;

      if (isFinal) {
        currentUtteranceId = null;
        const sequence = ++sequenceCounter;

        const previousTranscripts = transcriptHistory.map((t) => t.text);
        transcriptHistory.push({ text, timestamp: Date.now() });

        const useCompression = compressionMode || transcriptHistory.length > 8;

        const translationInput: TranslationInput = {
          originalText: text,
          sourceLanguage,
          targetLanguage,
          sessionId,
          previousTranscripts,
          speaker: null,
          primaryLang: targetLanguage,
          cinemaMode,
          compressionMode: useCompression,
          skipTTS,
          translationModel,
        };

        translateAndGenerateTts(translationInput, openai)
          .then((result) => {
            clientWs.send(JSON.stringify({
              type: "final",
              utteranceId: `dg_${sequence}`,
              sequence,
              text,
              translatedText: result.translatedText,
              translations: result.translations,
              sourceLanguage,
              speaker: result.speaker,
              audioBase64: result.audioBase64,
              confidence,
              sttModel,
              translationLatencyMs: result.translationLatencyMs,
              ttsLatencyMs: result.ttsLatencyMs,
              timeToFinalTranscriptMs: 0,
              endToEndLatencyMs: result.translationLatencyMs + result.ttsLatencyMs,
            }));
          })
          .catch((err) => {
            console.error("Translation error:", err);
            clientWs.send(JSON.stringify({
              type: "final",
              utteranceId: `dg_${sequence}`,
              sequence,
              text,
              translatedText: "",
              sourceLanguage,
              speaker: null,
              audioBase64: "",
              confidence,
              sttModel,
              translationLatencyMs: 0,
              ttsLatencyMs: 0,
              timeToFinalTranscriptMs: 0,
              endToEndLatencyMs: 0,
            }));
          });
      } else {
        if (!currentUtteranceId) {
          currentUtteranceId = `dg_${++utteranceCounter}`;
        }
        clientWs.send(JSON.stringify({
          type: "interim",
          utteranceId: currentUtteranceId,
          text,
          confidence,
        }));
      }
    } else if (parsed.type === "UtteranceEnd") {
      currentUtteranceId = null;
      clientWs.send(JSON.stringify({ type: "utteranceEnd" }));
    }
  });

  dgWs.on("error", (err) => {
    console.error("Deepgram WS error:", err);
    clientWs.send(JSON.stringify({ type: "error", message: "Deepgram connection error" }));
  });

  dgWs.on("close", () => {
    dgReady = false;
  });

  clientWs.on("message", (raw) => {
    if (Buffer.isBuffer(raw) || raw instanceof ArrayBuffer) {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (dgReady && dgWs.readyState === WsSocket.OPEN) {
        dgWs.send(buf);
      }
    }
  });

  clientWs.on("close", () => {
    dgWs.close();
  });

  clientWs.on("error", () => {
    dgWs.close();
  });
}
