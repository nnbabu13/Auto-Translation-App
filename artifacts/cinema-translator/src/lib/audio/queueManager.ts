
export interface ChunkData {
  id: number;
  blob: Blob;
  stats: {
    volumeLevel: number;
    isClipping: boolean;
    isSilent: boolean;
    quality: "Excellent" | "Good" | "Poor";
    speechDetected: boolean;
  };
}

export interface TranslationResult {
  chunkId: number;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  audioBase64?: string;
  latencyMs: number;
}

export class QueueManager {
  private captureQueue: ChunkData[] = [];
  private sttQueue: ChunkData[] = [];
  private translationQueue: { chunkId: number; originalText: string }[] = [];
  private ttsQueue: { chunkId: number; translatedText: string }[] = [];
  private playbackQueue: TranslationResult[] = [];
  private isProcessingPlayback = false;
  private chunkCounter = 0;
  private playbackRate = 1.0;

  constructor() {}

  addToCaptureQueue(data: ChunkData) {
    this.captureQueue.push(data);
    this.processCaptureQueue();
  }

  private processCaptureQueue() {
    while (this.captureQueue.length > 0) {
      const chunk = this.captureQueue.shift()!;
      if (chunk.stats.speechDetected) {
        this.sttQueue.push(chunk);
        this.processSTTQueue();
      }
    }
  }

  private async processSTTQueue() {
    while (this.sttQueue.length > 0) {
      const chunk = this.sttQueue.shift()!;
      // We'll do STT processing in the session component
    }
  }

  addToTranslationQueue(chunkId: number, originalText: string) {
    this.translationQueue.push({ chunkId, originalText });
    this.processTranslationQueue();
  }

  private async processTranslationQueue() {
    while (this.translationQueue.length > 0) {
      const item = this.translationQueue.shift()!;
      // We'll do translation processing in the session component
    }
  }

  addToTTSQueue(chunkId: number, translatedText: string) {
    this.ttsQueue.push({ chunkId, translatedText });
    this.processTTSQueue();
  }

  private async processTTSQueue() {
    while (this.ttsQueue.length > 0) {
      const item = this.ttsQueue.shift()!;
      // We'll do TTS processing in the session component
    }
  }

  addToPlaybackQueue(result: TranslationResult) {
    this.playbackQueue.push(result);
    this.processPlaybackQueue();
  }

  private async processPlaybackQueue() {
    if (this.isProcessingPlayback) return;

    this.isProcessingPlayback = true;
    while (this.playbackQueue.length > 0) {
      const result = this.playbackQueue.shift()!;
      if (result.audioBase64) {
        const audioBuffer = this.base64ToArrayBuffer(result.audioBase64);
        await this.playAudio(audioBuffer);
      }
    }
    this.isProcessingPlayback = false;
  }

  private base64ToArrayBuffer(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private async playAudio(arrayBuffer: ArrayBuffer) {
    try {
      if (!window.audioContext) {
        window.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = window.audioContext;

      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = this.playbackRate;
      source.connect(ctx.destination);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start(0);
      });
    } catch (err) {
      console.error("Playback error:", err);
    }
  }

  getPlaybackQueueLength() {
    return this.playbackQueue.length;
  }

  getEstimatedWaitMs(): number {
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    let totalSamples = 0;
    for (const item of this.playbackQueue) {
      if (item.audioBase64) {
        const byteLength = Math.ceil((item.audioBase64.length * 3) / 4);
        totalSamples += byteLength / BYTES_PER_SAMPLE;
      }
    }
    return (totalSamples / SAMPLE_RATE) * 1000;
  }

  setPlaybackRate(rate: number) {
    this.playbackRate = Math.max(1.0, Math.min(1.15, rate));
  }

  getPlaybackRate() {
    return this.playbackRate;
  }

  getNextChunkId() {
    return ++this.chunkCounter;
  }
}

declare global {
  interface Window {
    audioContext?: AudioContext | (typeof AudioContext) extends undefined ? any : AudioContext;
  }
}
