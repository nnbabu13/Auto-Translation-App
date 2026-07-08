import * as tts from "@mintplex-labs/piper-tts-web";

const ONNX_VERSION = "1.27.0";
const ONNX_CDN = `https://unpkg.com/onnxruntime-web@${ONNX_VERSION}/dist/`;
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize";

const LANGUAGE_VOICE_MAP: Record<string, string> = {
  English: "en_US-lessac-medium",
  Greek: "el_GR-rapunzelina-low",
  Spanish: "es_ES-sharvard-medium",
  French: "fr_FR-siwis-medium",
  German: "de_DE-thorsten-medium",
};

const downloadProgressCallbacks = new Map<string, (progress: { url: string; loaded: number; total: number }) => void>();

let initialized = false;

export async function initPiper(): Promise<void> {
  if (initialized) return;
  try {
    const voices = await tts.voices();
    console.log("Piper voices available:", Object.keys(voices).length);
    initialized = true;
  } catch (err) {
    console.error("Failed to initialize Piper TTS:", err);
  }
}

export async function downloadPiperVoice(
  language: string,
  onProgress?: (progress: { url: string; loaded: number; total: number }) => void
): Promise<boolean> {
  const voiceId = LANGUAGE_VOICE_MAP[language];
  if (!voiceId) {
    console.warn(`No Piper voice for language: ${language}`);
    return false;
  }

  try {
    if (onProgress) {
      downloadProgressCallbacks.set(voiceId, onProgress);
    }
    await tts.download(voiceId, (progress) => {
      const cb = downloadProgressCallbacks.get(voiceId);
      if (cb) cb(progress);
    });
    downloadProgressCallbacks.delete(voiceId);
    return true;
  } catch (err) {
    console.error(`Failed to download Piper voice ${voiceId}:`, err);
    downloadProgressCallbacks.delete(voiceId);
    return false;
  }
}

export async function synthesizeLocal(
  text: string,
  language: string
): Promise<Blob | null> {
  const voiceId = LANGUAGE_VOICE_MAP[language];
  if (!voiceId) {
    console.warn(`No Piper voice for language: ${language}`);
    return null;
  }

  try {
    const session = new tts.TtsSession({
      voiceId,
      wasmPaths: { onnxWasm: ONNX_CDN, piperData: `${WASM_BASE}.data`, piperWasm: `${WASM_BASE}.wasm` },
    });
    await session.waitReady;
    const wavBlob = await session.predict(text);
    return wavBlob;
  } catch (err) {
    console.error(`Piper TTS synthesis error for ${language}:`, err);
    return null;
  }
}

export function hasLocalVoice(language: string): boolean {
  return language in LANGUAGE_VOICE_MAP;
}

export function getLocalVoices(): string[] {
  return Object.keys(LANGUAGE_VOICE_MAP);
}

export async function getStoredVoices(): Promise<string[]> {
  try {
    return await tts.stored();
  } catch {
    return [];
  }
}

export async function removeStoredVoice(voiceId: string): Promise<void> {
  try {
    await tts.remove(voiceId);
  } catch (err) {
    console.error(`Failed to remove voice ${voiceId}:`, err);
  }
}

export async function flushAllVoices(): Promise<void> {
  try {
    await tts.flush();
  } catch (err) {
    console.error("Failed to flush voices:", err);
  }
}
