import { MicVAD } from "@ricky0123/vad-web";

export type { MicVAD };

export interface SileroVadCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
  onVADMisfire?: () => void;
  onFrameProcessed?: (probability: number, frame: Float32Array) => void;
}

export interface SileroVadOptions {
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionMs?: number;
  minSpeechMs?: number;
  preSpeechPadMs?: number;
  model?: "v5" | "legacy";
  stream?: MediaStream;
  audioContext?: AudioContext;
  submitUserSpeechOnPause?: boolean;
}

let vadInstance: MicVAD | null = null;

export async function createSileroVad(
  callbacks: SileroVadCallbacks,
  options: SileroVadOptions = {},
): Promise<MicVAD> {
  const {
    positiveSpeechThreshold = 0.3,
    negativeSpeechThreshold = 0.25,
    redemptionMs = 1400,
    minSpeechMs = 400,
    preSpeechPadMs = 800,
    model = "v5",
    stream,
    audioContext,
    submitUserSpeechOnPause = true,
  } = options;

  console.log("[VAD] Initializing with model:", model, "stream:", !!stream);

  const vad = await MicVAD.new({
    model,
    positiveSpeechThreshold,
    negativeSpeechThreshold,
    redemptionMs,
    minSpeechMs,
    preSpeechPadMs,
    baseAssetPath: "/",
    onnxWASMBasePath: "/",
    submitUserSpeechOnPause,
    ...(stream ? { getStream: () => Promise.resolve(stream) } : {}),
    ...(audioContext ? { audioContext } : {}),
    ortConfig: (ort) => {
      ort.env.wasm.numThreads = 1;
    },
    onSpeechStart: () => {
      callbacks.onSpeechStart();
    },
    onSpeechEnd: (audio: Float32Array) => {
      callbacks.onSpeechEnd(audio);
    },
    onVADMisfire: () => {
      callbacks.onVADMisfire?.();
    },
    onFrameProcessed: (_probabilities: any, _frame: Float32Array) => {
      callbacks.onFrameProcessed?.(_probabilities.isSpeech, _frame);
    },
  });

  console.log("[VAD] Initialized successfully");
  vadInstance = vad;
  return vad;
}

export function getVadInstance(): MicVAD | null {
  return vadInstance;
}

export function destroyVad(): void {
  if (vadInstance) {
    vadInstance.destroy();
    vadInstance = null;
  }
}
