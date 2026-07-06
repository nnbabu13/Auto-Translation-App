export function convertToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

export interface AudioStats {
  volumeLevel: number;
  rmsLevel: number;
  peakLevel: number;
  isClipping: boolean;
  isSilent: boolean;
  quality: "Excellent" | "Good" | "Poor";
  speechDetected: boolean;
  waveform: number[];
}

export class StreamingCapture {
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private ws: WebSocket | null = null;
  private animationId: number | null = null;
  private statsCallback: ((stats: AudioStats) => void) | null = null;
  private isRunning = false;

  async start(
    stream: MediaStream,
    wsUrl: string,
    onStats?: (stats: AudioStats) => void,
  ): Promise<void> {
    this.setupAudio(stream, onStats);

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("WebSocket connection failed"));
      };
      const cleanup = () => {
        this.ws?.removeEventListener("open", onOpen);
        this.ws?.removeEventListener("error", onError);
      };
      this.ws!.addEventListener("open", onOpen);
      this.ws!.addEventListener("error", onError);
    });

    this.isRunning = true;

    this.scriptProcessor!.onaudioprocess = (event) => {
      if (!this.isRunning || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const int16 = convertToInt16(event.inputBuffer.getChannelData(0));

      const FRAME_SIZE = 320;
      for (let offset = 0; offset < int16.length; offset += FRAME_SIZE) {
        const end = Math.min(offset + FRAME_SIZE, int16.length);
        const chunk = int16.subarray(offset, end);
        this.ws.send(chunk.buffer);
      }
    };

    this.startAnalyserLoop();
  }

  async startRest(
    stream: MediaStream,
    onChunk: (pcm16: Int16Array) => void,
    onStats?: (stats: AudioStats) => void,
  ): Promise<void> {
    this.setupAudio(stream, onStats);
    this.isRunning = true;

    this.scriptProcessor!.onaudioprocess = (event) => {
      if (!this.isRunning) return;
      onChunk(convertToInt16(event.inputBuffer.getChannelData(0)));
    };

    this.startAnalyserLoop();
  }

  private setupAudio(stream: MediaStream, onStats?: (stats: AudioStats) => void): void {
    this.stop();
    this.statsCallback = onStats ?? null;

    this.audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }

    this.source = this.audioContext.createMediaStreamSource(stream);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;

    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.source.connect(this.analyser);
    this.analyser.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  private startAnalyserLoop(): void {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const timeDomain = new Float32Array(bufferLength);

    const tick = () => {
      if (!this.isRunning || !this.analyser) return;

      this.analyser.getFloatTimeDomainData(timeDomain);

      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        const val = timeDomain[i];
        sumSquares += val * val;
        peak = Math.max(peak, Math.abs(val));
      }
      const rms = Math.sqrt(sumSquares / timeDomain.length);

      const step = Math.max(1, Math.floor(timeDomain.length / 160));
      const waveform: number[] = [];
      for (let i = 0; i < timeDomain.length; i += step) {
        waveform.push((timeDomain[i] + 1) / 2);
      }

      const stats: AudioStats = {
        volumeLevel: Math.max(0, Math.min(100, peak * 100)),
        rmsLevel: rms,
        peakLevel: peak,
        isClipping: peak >= 0.99,
        isSilent: rms < 0.005,
        speechDetected: rms >= 0.015,
        quality: rms >= 0.03 ? "Excellent" : rms >= 0.01 ? "Good" : "Poor",
        waveform,
      };

      this.statsCallback?.(stats);
      this.animationId = requestAnimationFrame(tick);
    };

    this.animationId = requestAnimationFrame(tick);
  }

  setStatsCallback(callback: (stats: AudioStats) => void): void {
    this.statsCallback = callback;
  }

  getWs(): WebSocket | null {
    return this.ws;
  }

  stop(): void {
    this.isRunning = false;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
