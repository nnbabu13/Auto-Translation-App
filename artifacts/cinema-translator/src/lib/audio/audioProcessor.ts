
import { encodeWavPCM16 } from "./wavEncoder";

export interface AudioStats {
  volumeLevel: number;
  rmsLevel: number;
  peakLevel: number;
  speechProbability: number;
  isClipping: boolean;
  isSilent: boolean;
  quality: "Excellent" | "Good" | "Poor";
  speechDetected: boolean;
  acceptedChunkCount: number;
  discardedChunkCount: number;
  activeSpeechDurationMs: number;
  waveform: number[];
}

const WHISPER_SAMPLE_RATE = 16000;

interface AudioProcessorOptions {
  sampleRate?: number;
  silenceThresholdMs?: number;
  noiseSuppression?: boolean;
  minSpeechDurationMs?: number;
  minSpeechProbability?: number;
  minRmsLevel?: number;
}

export class AudioProcessor {
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private buffer: Float32Array = new Float32Array(0);
  private sampleRate: number;
  private silenceThresholdMs: number;
  private noiseSuppression: boolean;
  private minSpeechDurationMs: number;
  private minSpeechProbability: number;
  private minRmsLevel: number;
  private silenceCount = 0;
  private isRecordingSpeech = false;
  private speechFrameCount = 0;
  private totalFrameCount = 0;
  private segmentRmsTotal = 0;
  private segmentPeak = 0;
  private chunkIndex = 0;
  private acceptedChunkCount = 0;
  private discardedChunkCount = 0;
  private latestStats: AudioStats = {
    volumeLevel: 0,
    rmsLevel: 0,
    peakLevel: 0,
    speechProbability: 0,
    isClipping: false,
    isSilent: true,
    quality: "Poor",
    speechDetected: false,
    acceptedChunkCount: 0,
    discardedChunkCount: 0,
    activeSpeechDurationMs: 0,
    waveform: [],
  };
  private statsCallback: ((stats: AudioStats) => void) | null = null;
  private chunkCallback: ((wavBlob: Blob, index: number, stats: AudioStats) => void) | null = null;

  constructor(options: AudioProcessorOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16000;
    this.silenceThresholdMs = options.silenceThresholdMs ?? 700;
    this.noiseSuppression = options.noiseSuppression ?? false;
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 250;
    this.minSpeechProbability = options.minSpeechProbability ?? 0.5;
    this.minRmsLevel = options.minRmsLevel ?? 0.003;
  }

  public async start(
    stream: MediaStream,
    statsCallback?: (stats: AudioStats) => void,
    chunkCallback?: (wavBlob: Blob, index: number, stats: AudioStats) => void,
  ) {
    this.statsCallback = statsCallback ?? null;
    this.chunkCallback = chunkCallback ?? null;

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: this.sampleRate,
      latencyHint: "interactive",
    });

    await this.audioContext.resume();

    this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.mediaStreamSource.connect(this.analyser);
    this.analyser.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);

    this.scriptProcessor.onaudioprocess = (event) => {
      this.processAudio(event);
    };
  }

  public stop() {
    if (this.isRecordingSpeech && this.buffer.length > 0) {
      this.finalizeSegment();
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor.onaudioprocess = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
    }
    if (this.audioContext) {
      this.audioContext.close();
    }

    this.audioContext = null;
    this.mediaStreamSource = null;
    this.analyser = null;
    this.scriptProcessor = null;
  }

  private processAudio(event: AudioProcessingEvent) {
    const input = event.inputBuffer.getChannelData(0);
    const stats = this.computeAudioStats(input);
    this.latestStats = stats;

    if (this.statsCallback) {
      this.statsCallback(stats);
    }

    if (stats.speechDetected) {
      this.silenceCount = 0;

      if (!this.isRecordingSpeech) {
        this.isRecordingSpeech = true;
        this.buffer = new Float32Array(0);
        this.speechFrameCount = 0;
        this.totalFrameCount = 0;
        this.segmentRmsTotal = 0;
        this.segmentPeak = 0;
      }

      this.appendToBuffer(input);
      this.speechFrameCount += input.length;
      this.totalFrameCount += input.length;
      this.segmentRmsTotal += stats.rmsLevel * input.length;
      this.segmentPeak = Math.max(this.segmentPeak, stats.peakLevel);

      const durationMs = (this.totalFrameCount / this.sampleRate) * 1000;
      if (durationMs >= 5000) {
        this.finalizeSegment();
      }
      return;
    }

    if (this.isRecordingSpeech) {
      this.appendToBuffer(input);
      this.totalFrameCount += input.length;
      this.segmentRmsTotal += stats.rmsLevel * input.length;
      this.segmentPeak = Math.max(this.segmentPeak, stats.peakLevel);
      this.silenceCount += input.length;

      const durationMs = (this.totalFrameCount / this.sampleRate) * 1000;
      const silenceMs = (this.silenceCount / this.sampleRate) * 1000;
      if (silenceMs >= this.silenceThresholdMs || durationMs >= 5000) {
        this.finalizeSegment();
      }
    }
  }

  private appendToBuffer(input: Float32Array) {
    const nextBuffer = new Float32Array(this.buffer.length + input.length);
    nextBuffer.set(this.buffer);
    nextBuffer.set(input, this.buffer.length);
    this.buffer = nextBuffer;
  }

  private async finalizeSegment() {
    const segmentDurationMs = (this.totalFrameCount / this.sampleRate) * 1000;
    const averageRms = this.totalFrameCount > 0 ? this.segmentRmsTotal / this.totalFrameCount : 0;
    const speechProbability =
      this.totalFrameCount > 0 ? this.speechFrameCount / this.totalFrameCount : 0;
    const accepted =
      segmentDurationMs >= this.minSpeechDurationMs &&
      averageRms >= this.minRmsLevel;

    const segmentStats: AudioStats = {
      volumeLevel: Math.max(0, Math.min(100, this.segmentPeak * 100)),
      rmsLevel: averageRms,
      peakLevel: this.segmentPeak,
      speechProbability,
      isClipping: this.segmentPeak >= 0.99,
      isSilent: averageRms < this.minRmsLevel,
      quality: this.getQuality(averageRms, this.segmentPeak >= 0.99, speechProbability),
      speechDetected: accepted,
      acceptedChunkCount: this.acceptedChunkCount + (accepted ? 1 : 0),
      discardedChunkCount: this.discardedChunkCount + (accepted ? 0 : 1),
      activeSpeechDurationMs: segmentDurationMs,
      waveform: this.buildWaveform(this.buffer),
    };

    if (accepted && this.buffer.length > 0) {
      // Resample to 16000 Hz for Whisper compatibility
      const resampledBuffer = await this.resampleBuffer(this.buffer, this.sampleRate, WHISPER_SAMPLE_RATE);
      const wavBlob = encodeWavPCM16(resampledBuffer, WHISPER_SAMPLE_RATE);
      this.acceptedChunkCount += 1;
      if (this.chunkCallback) {
        this.chunkCallback(wavBlob, this.chunkIndex, segmentStats);
      }
      this.chunkIndex += 1;
    } else if (this.totalFrameCount > 0) {
      this.discardedChunkCount += 1;
    }

    this.latestStats = {
      ...segmentStats,
      acceptedChunkCount: this.acceptedChunkCount,
      discardedChunkCount: this.discardedChunkCount,
    };
    if (this.statsCallback) {
      this.statsCallback(this.latestStats);
    }

    this.isRecordingSpeech = false;
    this.buffer = new Float32Array(0);
    this.silenceCount = 0;
    this.speechFrameCount = 0;
    this.totalFrameCount = 0;
    this.segmentRmsTotal = 0;
    this.segmentPeak = 0;
  }

  private async resampleBuffer(inputBuffer: Float32Array, fromSampleRate: number, toSampleRate: number): Promise<Float32Array> {
    if (fromSampleRate === toSampleRate) {
      return inputBuffer;
    }

    const offlineContext = new OfflineAudioContext({
      numberOfChannels: 1,
      length: Math.round(inputBuffer.length * (toSampleRate / fromSampleRate)),
      sampleRate: toSampleRate,
    });

    const buffer = offlineContext.createBuffer(1, inputBuffer.length, fromSampleRate);
    buffer.copyToChannel(new Float32Array(inputBuffer), 0);

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineContext.destination);
    source.start(0);

    const renderedBuffer = await offlineContext.startRendering();
    const outputBuffer = new Float32Array(renderedBuffer.length);
    renderedBuffer.copyFromChannel(outputBuffer, 0);
    return outputBuffer;
  }

  private computeAudioStats(samples: Float32Array): AudioStats {
    let sumSquares = 0;
    let peak = 0;
    let isClipping = false;
    let zeroCrossings = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const value = samples[i];
      const absolute = Math.abs(value);
      sumSquares += value * value;
      peak = Math.max(peak, absolute);
      if (absolute >= 0.99) {
        isClipping = true;
      }
      if (i > 0 && Math.sign(samples[i - 1]) !== Math.sign(value)) {
        zeroCrossings += 1;
      }
    }

    const rmsLevel = Math.sqrt(sumSquares / samples.length);
    const zeroCrossingRate = zeroCrossings / samples.length;
    const energyScore = Math.max(0, Math.min(1, (rmsLevel - this.minRmsLevel) / 0.06));
    const speechBandScore = Math.max(0, 1 - Math.min(1, Math.abs(zeroCrossingRate - 0.1) / 0.15));
    const speechProbability = Math.max(
      0,
      Math.min(1, energyScore * 0.7 + speechBandScore * 0.3),
    );
    const speechDetected = speechProbability >= this.minSpeechProbability && rmsLevel >= this.minRmsLevel;
    const quality = this.getQuality(rmsLevel, isClipping, speechProbability);

    return {
      volumeLevel: Math.max(0, Math.min(100, rmsLevel * 220)),
      rmsLevel,
      peakLevel: peak,
      speechProbability,
      isClipping,
      isSilent: rmsLevel < this.minRmsLevel,
      quality,
      speechDetected,
      acceptedChunkCount: this.acceptedChunkCount,
      discardedChunkCount: this.discardedChunkCount,
      activeSpeechDurationMs: this.totalFrameCount > 0 ? (this.totalFrameCount / this.sampleRate) * 1000 : 0,
      waveform: this.buildWaveform(samples),
    };
  }

  private buildWaveform(samples: Float32Array): number[] {
    if (samples.length === 0) {
      return [];
    }

    const bucketCount = Math.min(64, samples.length);
    const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount));
    const waveform: number[] = [];

    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
      const start = bucketIndex * bucketSize;
      const end = Math.min(samples.length, start + bucketSize);
      let peak = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(samples[sampleIndex]));
      }

      waveform.push(peak);
    }

    return waveform;
  }

  private getQuality(
    rmsLevel: number,
    isClipping: boolean,
    speechProbability: number,
  ): "Excellent" | "Good" | "Poor" {
    if (isClipping || rmsLevel < this.minRmsLevel || speechProbability < this.minSpeechProbability) {
      return "Poor";
    }
    if (rmsLevel < 0.03 || speechProbability < 0.85) {
      return "Good";
    }
    return "Excellent";
  }
}
