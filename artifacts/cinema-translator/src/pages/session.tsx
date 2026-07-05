
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRoute, Link } from "wouter";
import JSZip from "jszip";
import { useGetSession } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Mic,
  Square,
  Activity,
  Volume2,
  Globe,
  Clock,
  Download,
  Settings,
  Eye,
  MonitorPlay,
  Zap,
  Users,
} from "lucide-react";
import { type AudioStats } from "@/lib/audio/audioProcessor";
import { QueueManager } from "@/lib/audio/queueManager";
import { createSileroVad, destroyVad, type MicVAD } from "@/lib/audio/sileroVad";

type AudioInputDevice = {
  deviceId: string;
  label: string;
};

type RecordedChunk = {
  chunkNumber: number;
  createdAt: number;
  sessionOffsetMs: number;
  durationMs: number;
  rmsLevel: number;
  peakLevel: number;
  fileSize: number;
  speechDetected: boolean;
  blob: Blob;
  transcriptionResult: string;
  translationResult: string;
};

function padChunkNumber(value: number) {
  return value.toString().padStart(4, "0");
}

function formatSessionTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getRmsIndicator(rmsLevel: number) {
  if (rmsLevel < 0.005) {
    return { color: "#ef4444", label: "No usable audio" };
  }
  if (rmsLevel < 0.015) {
    return { color: "#f97316", label: "Low audio level" };
  }
  if (rmsLevel < 0.03) {
    return { color: "#eab308", label: "Acceptable" };
  }
  if (rmsLevel < 0.1) {
    return { color: "#22c55e", label: "Good" };
  }
  return { color: "#3b82f6", label: "Very strong signal" };
}

export default function SessionScreen() {
  const [, params] = useRoute("/sessions/:id");
  const sessionId = Number(params?.id);
  const { data: session, isLoading } = useGetSession(sessionId, {
    query: { enabled: !!sessionId, queryKey: ["session", sessionId] },
  });
  const { toast } = useToast();

  useEffect(() => {
    if (session?.sourceLanguage) {
      setSourceLanguageSetting(session.sourceLanguage);
    }
  }, [session?.sourceLanguage]);

  const [isRecording, setIsRecording] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showMetricsDashboard, setShowMetricsDashboard] = useState(false);
  const [cinemaMode, setCinemaMode] = useState(false);
  const [benchmarkMode, setBenchmarkMode] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(false);
  const [sourceLanguageSetting, setSourceLanguageSetting] = useState<string>("en");
  const [audioSource, setAudioSource] = useState<string>("input");
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [activeDeviceName, setActiveDeviceName] = useState("No input selected");
  const [testMode, setTestMode] = useState(false);
  const [listeningActive, setListeningActive] = useState(false);
  const [processingCount, setProcessingCount] = useState(0);
  const [speakingActive, setSpeakingActive] = useState(false);
  const [originalText, setOriginalText] = useState("");
  const [previousOriginalText, setPreviousOriginalText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [audioQueueLength, setAudioQueueLength] = useState(0);
  const [estimatedWaitMs, setEstimatedWaitMs] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [currentModel, setCurrentModel] = useState("gpt-4o");
  const [sttModel, setSttModel] = useState("nova-3");
  const [recordedChunks, setRecordedChunks] = useState<RecordedChunk[]>([]);
  const [diarizationEnabled, setDiarizationEnabled] = useState(false);
  const [turboMode, setTurboMode] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [transcriptWithSpeakers, setTranscriptWithSpeakers] = useState<{speaker: string | null; text: string; timestamp: number}[]>([]);

  const [audioStats, setAudioStats] = useState<AudioStats>({
    volumeLevel: 0,
    rmsLevel: 0,
    peakLevel: 0,
    speechProbability: 0,
    isClipping: false,
    isSilent: true,
    quality: "Excellent",
    speechDetected: false,
    acceptedChunkCount: 0,
    discardedChunkCount: 0,
    activeSpeechDurationMs: 0,
    waveform: [],
  });

  const [debugMetrics, setDebugMetrics] = useState({
    recordedChunks: 0,
    sttRequests: 0,
    translationRequests: 0,
    ttsRequests: 0,
    totalLatency: 0,
    avgLatency: 0,
    sttLatency: 0,
    translationLatency: 0,
    ttsLatency: 0,
    audioQualityScore: 90,
    vadDiscardPercent: 10,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const queueManagerRef = useRef<QueueManager | null>(null);
  const vadRef = useRef<MicVAD | null>(null);
  const isRecordingRef = useRef(false);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastRecordedChunkRef = useRef<Blob | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);

  const transcriptRef = useRef<string[]>([]);
  const translationsRef = useRef<string[]>([]);
  const segmentsRef = useRef<Blob[]>([]);
  const transcriptHistoryRef = useRef<{ text: string; timestamp: number }[]>([]);

  const captureWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (audioStats.rmsLevel < 0.005) {
      warnings.push("Likely silence or incorrect input device.");
    } else if (audioStats.rmsLevel < 0.01) {
      warnings.push("Audio level too low.");
    }
    if (audioStats.isClipping) {
      warnings.push("Audio too loud.");
    }
    return warnings;
  }, [audioStats.isClipping, audioStats.rmsLevel]);

  const sessionDateStamp = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${year}${month}${day}`;
  }, []);

  useEffect(() => {
    isRecordingRef.current = isRecording;
    if (!queueManagerRef.current) {
      queueManagerRef.current = new QueueManager();
    }
  }, [isRecording]);

  const loadAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Audio Input ${index + 1}`,
      }));

    setAudioInputDevices(audioInputs);

    const vacDevice = audioInputs.find(
      (d) =>
        d.label.toLowerCase().includes("cable") ||
        d.label.toLowerCase().includes("virtual") ||
        d.label.toLowerCase().includes("stereo mix") ||
        d.label.toLowerCase().includes("line"),
    );
    const preferredDevice = vacDevice?.deviceId || audioInputs[0]?.deviceId || "";
    setSelectedDeviceId((current) => current || preferredDevice);
  }, []);

  useEffect(() => {
    loadAudioDevices().catch((error) => {
      console.error("Failed to enumerate audio devices:", error);
    });
  }, [loadAudioDevices]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#22c55e";
    context.lineWidth = 2;
    context.beginPath();

    const waveform = audioStats.waveform;
    if (waveform.length === 0) {
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
    } else {
      waveform.forEach((value, index) => {
        const x = (index / Math.max(1, waveform.length - 1)) * width;
        const y = height - value * height;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
    }

    context.stroke();
  }, [audioStats.waveform]);

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string")
          resolve(reader.result.split(",")[1]);
        else reject(new Error("Failed to read blob"));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const playCapturedChunk = useCallback(async (blob?: Blob | null) => {
    const chunk = blob ?? lastRecordedChunkRef.current;
    if (!chunk) {
      return;
    }

    const url = URL.createObjectURL(chunk);
    const audio = playbackAudioRef.current ?? new Audio();
    playbackAudioRef.current = audio;
    audio.src = url;
    await audio.play();
    audio.onended = () => {
      URL.revokeObjectURL(url);
    };
  }, []);

  const updateRecordedChunk = useCallback(
    (chunkNumber: number, patch: Partial<RecordedChunk>) => {
      setRecordedChunks((current) =>
        current.map((chunk) =>
          chunk.chunkNumber === chunkNumber ? { ...chunk, ...patch } : chunk,
        ),
      );
    },
    [],
  );

  const downloadRecordedChunk = useCallback(
    (chunk: RecordedChunk) => {
      const url = URL.createObjectURL(chunk.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `session_${sessionDateStamp}_chunk_${padChunkNumber(chunk.chunkNumber)}.wav`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [sessionDateStamp],
  );

  const saveRawWav = useCallback(() => {
    const latestChunk = recordedChunks[recordedChunks.length - 1];
    if (!latestChunk) {
      return;
    }
    downloadRecordedChunk(latestChunk);
  }, [downloadRecordedChunk, recordedChunks]);

  const downloadAllChunksAsZip = useCallback(async () => {
    if (recordedChunks.length === 0) {
      return;
    }

    const zip = new JSZip();
    const sessionFolder = zip.folder("session");
    if (!sessionFolder) {
      return;
    }

    const sortedChunks = [...recordedChunks].sort((left, right) => left.chunkNumber - right.chunkNumber);
    for (const chunk of sortedChunks) {
      sessionFolder.file(`chunk_${padChunkNumber(chunk.chunkNumber)}.wav`, chunk.blob);
    }

    const metadata = sortedChunks.map((chunk) => ({
      chunkNumber: chunk.chunkNumber,
      timestamp: formatSessionTime(chunk.sessionOffsetMs),
      durationMs: chunk.durationMs,
      rmsLevel: chunk.rmsLevel,
      peakLevel: chunk.peakLevel,
      fileSize: chunk.fileSize,
      speechDetected: chunk.speechDetected,
      transcriptionResult: chunk.transcriptionResult,
      translationResult: chunk.translationResult,
    }));

    sessionFolder.file("metadata.json", JSON.stringify(metadata, null, 2));

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `session_${sessionDateStamp}_chunks.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [recordedChunks, sessionDateStamp]);

  const processChunk = useCallback(
    async (blob: Blob, index: number, stats: AudioStats) => {
      if (!stats.speechDetected || !session) return;
      setProcessingCount((c) => c + 1);
      const chunkNumber = index + 1;
      const createdAt = Date.now();
      const sessionOffsetMs = recordingStartedAtRef.current
        ? createdAt - recordingStartedAtRef.current
        : 0;
      const chunkRecord: RecordedChunk = {
        chunkNumber,
        createdAt,
        sessionOffsetMs,
        durationMs: stats.activeSpeechDurationMs,
        rmsLevel: stats.rmsLevel,
        peakLevel: stats.peakLevel,
        fileSize: blob.size,
        speechDetected: stats.speechDetected,
        blob,
        transcriptionResult: "",
        translationResult: "",
      };

      try {
        segmentsRef.current.push(blob);
        lastRecordedChunkRef.current = blob;
        setRecordedChunks((current) => {
          const next = [...current, chunkRecord];
          return next.slice(-100);
        });
        if (testMode) {
          await playCapturedChunk(blob);
        }
        const base64Audio = await blobToBase64(blob);

        const nowMs = Date.now();
        const contextWindowMs = cinemaMode ? 120000 : 60000;
        const recentTranscripts = transcriptHistoryRef.current
          .filter((entry) => nowMs - entry.timestamp < contextWindowMs)
          .map((entry) => entry.text);

        const response = await fetch("/api/translate/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio: base64Audio,
            audioExt: "wav",
            targetLanguage: session.targetLanguage,
            targetLanguages: session.targetLanguages || [session.targetLanguage],
            sessionId: session.id,
            previousText: previousOriginalText,
            previousTranscripts: recentTranscripts,
            sourceLanguage: sourceLanguageSetting,
            model: currentModel,
            sttModel: sttModel,
            benchmarkMode,
            cinemaMode,
            diarize: diarizationEnabled,
          }),
        });

        if (!response.ok) return;
        const data = await response.json();

        if (!data.originalText) {
          setConfidence(0);
          updateRecordedChunk(chunkNumber, {
            transcriptionResult: "",
            translationResult: "",
          });
          return;
        }

        setPreviousOriginalText(originalText);
        transcriptRef.current.push(data.originalText);
        translationsRef.current.push(data.translatedText);
        transcriptHistoryRef.current.push({ text: data.originalText, timestamp: Date.now() });

        setOriginalText(data.originalText);
        setTranslatedText(data.translatedText);
        setSourceLanguage(data.sourceLanguage);
        setLatency(data.latencyMs);
        setConfidence(data.confidence);
        
        if (data.speaker) {
          setCurrentSpeaker(data.speaker);
          setTranscriptWithSpeakers(prev => [...prev.slice(-30), {
            speaker: data.speaker,
            text: data.originalText,
            timestamp: Date.now()
          }]);
        }

        if (data.translations) {
          const translations = data.translations as Record<string, string>;
          const primaryTranslation = translations[session.targetLanguage] || data.translatedText;
          setTranslatedText(primaryTranslation);
        }
        
        updateRecordedChunk(chunkNumber, {
          transcriptionResult: data.originalText,
          translationResult: data.translatedText,
        });

        setDebugMetrics((prev) => {
          const newTotalLatency = prev.totalLatency + data.latencyMs;
          const newSttRequests = prev.sttRequests + 1;
          return {
            ...prev,
            recordedChunks: prev.recordedChunks + 1,
            sttRequests: newSttRequests,
            translationRequests: prev.translationRequests + 1,
            ttsRequests: data.audioBase64 ? prev.ttsRequests + 1 : prev.ttsRequests,
            totalLatency: newTotalLatency,
            avgLatency: newTotalLatency / newSttRequests,
            sttLatency: prev.sttLatency + (data.sttLatencyMs || 0),
            translationLatency: prev.translationLatency + (data.translationLatencyMs || 0),
            ttsLatency: prev.ttsLatency + (data.ttsLatencyMs || 0),
          };
        });

        if (data.audioBase64 && queueManagerRef.current) {
          queueManagerRef.current.addToPlaybackQueue({
            chunkId: Date.now(),
            originalText: data.originalText,
            translatedText: data.translatedText,
            sourceLanguage: data.sourceLanguage,
            audioBase64: data.audioBase64,
            latencyMs: data.latencyMs,
          });
          setAudioQueueLength(queueManagerRef.current.getPlaybackQueueLength());
          setEstimatedWaitMs(queueManagerRef.current.getEstimatedWaitMs());
        }
      } catch (err) {
        console.error("Processing error:", err);
      } finally {
        setProcessingCount((c) => Math.max(0, c - 1));
      }
    },
    [
      originalText,
      previousOriginalText,
      sourceLanguageSetting,
      session,
      currentModel,
      sttModel,
      benchmarkMode,
      playCapturedChunk,
      testMode,
      updateRecordedChunk,
    ]
  );

  const processChunkRef = useRef(processChunk);
  processChunkRef.current = processChunk;


  const startRecording = async () => {
    if (!session) return;
    try {
      let stream: MediaStream;

      if (audioSource === "system") {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
          throw new Error("No system audio track available");
        }
        stream = new MediaStream([audioTracks[0]]);
        setActiveDeviceName("System Audio Capture");
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        const activeTrack = stream.getAudioTracks()[0];
        setActiveDeviceName(
          activeTrack.label
            ? `${activeTrack.label} (${activeTrack.getSettings().sampleRate ?? "auto"} Hz)`
            : selectedDeviceId
              ? `Device ${selectedDeviceId.slice(0, 8)}...`
              : "Selected Audio Input",
        );
      }

      streamRef.current = stream;
      recordingStartedAtRef.current = Date.now();
      setRecordedChunks([]);
      lastRecordedChunkRef.current = null;
      await loadAudioDevices();

      let acceptedCount = 0;
      let discardedCount = 0;

      const vad = await createSileroVad(
        {
          onSpeechStart: () => {
            setListeningActive(true);
          },
          onSpeechEnd: async (audio: Float32Array) => {
            const SAMPLE_RATE = 16000;
            const TURBO_CHUNK_MS = 1500;
            const durationMs = (audio.length / SAMPLE_RATE) * 1000;
            let sumSquares = 0;
            let peak = 0;
            for (let i = 0; i < audio.length; i++) {
              const val = audio[i];
              sumSquares += val * val;
              peak = Math.max(peak, Math.abs(val));
            }
            const rmsLevel = Math.sqrt(sumSquares / audio.length);
            const speechDetected = rmsLevel >= 0.003 && durationMs >= 250;

            if (!speechDetected) {
              discardedCount++;
              setAudioStats({
                volumeLevel: Math.max(0, Math.min(100, peak * 100)),
                rmsLevel,
                peakLevel: peak,
                speechProbability: 0.1,
                isClipping: peak >= 0.99,
                isSilent: rmsLevel < 0.003,
                quality: "Poor",
                speechDetected: false,
                acceptedChunkCount: acceptedCount,
                discardedChunkCount: discardedCount + 1,
                activeSpeechDurationMs: durationMs,
                waveform: [],
              });
              return;
            }

            const { encodeWavPCM16 } = await import("@/lib/audio/wavEncoder");

            const useTurbo = turboMode && durationMs > TURBO_CHUNK_MS;
            const samplesPerChunk = Math.floor(SAMPLE_RATE * (TURBO_CHUNK_MS / 1000));
            const totalChunks = useTurbo ? Math.ceil(audio.length / samplesPerChunk) : 1;

            for (let i = 0; i < totalChunks; i++) {
              const offset = i * samplesPerChunk;
              const chunkLen = Math.min(samplesPerChunk, audio.length - offset);
              const subChunk = audio.slice(offset, offset + chunkLen);
              const chunkDurationMs = (chunkLen / SAMPLE_RATE) * 1000;

              const chunkStats: AudioStats = {
                volumeLevel: Math.max(0, Math.min(100, peak * 100)),
                rmsLevel,
                peakLevel: peak,
                speechProbability: 0.9,
                isClipping: peak >= 0.99,
                isSilent: false,
                quality: rmsLevel >= 0.03 ? "Excellent" : rmsLevel >= 0.01 ? "Good" : "Poor",
                speechDetected: true,
                acceptedChunkCount: acceptedCount + i + 1,
                discardedChunkCount: discardedCount,
                activeSpeechDurationMs: chunkDurationMs,
                waveform: [],
              };

              acceptedCount++;
              const wavBlob = encodeWavPCM16(subChunk, SAMPLE_RATE);
              setAudioStats(chunkStats);
              processChunkRef.current(wavBlob, acceptedCount - 1, chunkStats);
            }
          },
          onVADMisfire: () => {
            discardedCount++;
          },
          onFrameProcessed: (probability: number) => {
            setAudioStats((prev) => ({
              ...prev,
              speechProbability: probability,
            }));
          },
        },
        {
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          redemptionMs: cinemaMode ? 1000 : 500,
          minSpeechMs: cinemaMode ? 300 : 250,
          model: "v5",
          stream: streamRef.current,
        },
      );

      vadRef.current = vad;
      vad.start();

      setIsRecording(true);
      setListeningActive(true);
    } catch (err) {
      console.error("Recording error:", err);
      const message = err instanceof Error ? err.message : String(err);
      let description = "Please allow audio capture access and verify the selected input device.";
      if (message.includes("NotAllowedError")) {
        description = "Microphone permission was denied. Please allow access in your browser settings.";
      } else if (message.includes("NotFoundError")) {
        description = "No audio input device found. Please connect a microphone or select a different device.";
      } else if (message.includes("NotReadableError") || message.includes("OverconstrainedError")) {
        description = `Audio device error: ${message}`;
      } else if (message.includes("fetch") || message.includes("network") || message.includes("WASM")) {
        description = `Failed to load VAD model files. Check your network connection.`;
      } else {
        description = `Recording setup failed: ${message}`;
      }
      toast({
        title: "Microphone Error",
        description,
        variant: "destructive",
      });
    }
  };

  const stopRecording = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.destroy();
      vadRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setListeningActive(false);
  }, []);

  const downloadSessionLogs = useCallback(async () => {
    const logData = {
      transcripts: transcriptRef.current,
      translations: translationsRef.current,
      stats: debugMetrics,
      cinemaMode,
      benchmarkMode,
    };
    const transcriptJson = JSON.stringify(logData, null, 2);
    const transcriptBlob = new Blob([transcriptJson], {
      type: "application/json",
    });
    const url = URL.createObjectURL(transcriptBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId}-logs.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessionId, debugMetrics, cinemaMode, benchmarkMode]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  if (isLoading || !session) {
    return (
      <div className="min-h-screen bg-background text-foreground flex justify-center items-center font-mono tracking-widest">
        INITIALIZING...
      </div>
    );
  }

  const translatingActive = processingCount > 0;
  const latestRmsIndicator = getRmsIndicator(audioStats.rmsLevel);
  const qualityColor =
    audioStats.quality === "Excellent"
      ? "#22c55e"
      : audioStats.quality === "Good"
      ? "#eab308"
      : "#ef4444";

  return (
    <div className="min-h-screen bg-background text-foreground p-8 flex flex-col">
      <header className="flex items-center justify-between mb-8 border-b border-border pb-4">
        <div className="flex items-center space-x-6">
          <Link
            href="/"
            className="inline-flex items-center text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              {session.name}
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Source: {session.sourceLanguage?.toUpperCase()} &middot; Target: {session.targetLanguage}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={saveRawWav}
            disabled={!lastRecordedChunkRef.current}
          >
            Save Raw WAV
          </Button>
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={() => playCapturedChunk()}
            disabled={!lastRecordedChunkRef.current}
          >
            Play Last Chunk
          </Button>
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={() => setCinemaMode(!cinemaMode)}
          >
            <MonitorPlay className="w-4 h-4 mr-2" />
            {cinemaMode ? "Cinema Mode On" : "Cinema Mode"}
          </Button>
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={() => setShowDebugPanel(!showDebugPanel)}
          >
            <Eye className="w-4 h-4 mr-2" />
            Debug
          </Button>
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={() => setShowMetricsDashboard(!showMetricsDashboard)}
          >
            <Activity className="w-4 h-4 mr-2" />
            Metrics
          </Button>
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={downloadSessionLogs}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Logs
          </Button>
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={downloadAllChunksAsZip}
            disabled={recordedChunks.length === 0}
          >
            Download All Chunks ZIP
          </Button>
          <Button
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <Link href={`/sessions/${sessionId}/history`}>
            <Button
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
            >
              View Log History
            </Button>
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
        <div className="lg:col-span-3 space-y-6">
          {showAdvancedSettings && (
            <Card className="bg-card border-card-border">
              <CardHeader className="pb-2 border-b border-border">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Advanced Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Capture Mode
                  </label>
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-white"
                    value={audioSource}
                    onChange={(e) => setAudioSource(e.target.value)}
                  >
                    <option value="input">Audio Input Device</option>
                    <option value="system">System Audio Capture</option>
                  </select>
                </div>
                {audioSource === "input" && (
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">
                      Audio Input Device
                    </label>
                    <select
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-white"
                      value={selectedDeviceId}
                      onChange={(e) => setSelectedDeviceId(e.target.value)}
                    >
                      {audioInputDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Supports Virtual Audio Cable, Stereo Mix, Microphone, and Line In when exposed by the OS.
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Active Device</p>
                  <p className="text-sm text-white">{activeDeviceName}</p>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">
                    Noise Suppression
                  </label>
                  <Button
                    variant="outline"
                    className="w-16"
                    onClick={() => setNoiseSuppression(!noiseSuppression)}
                  >
                    {noiseSuppression ? "On" : "Off"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Browser processing is disabled for capture: echo cancellation, noise suppression, and auto gain control are all off.
                </p>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">
                    Test Mode
                  </label>
                  <Button
                    variant="outline"
                    className="w-16"
                    onClick={() => setTestMode(!testMode)}
                  >
                    {testMode ? "On" : "Off"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Test Mode plays each captured WAV chunk back locally so you can verify the source audio matches the capture.
                </p>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">
                    Benchmark Mode
                  </label>
                  <Button
                    variant="outline"
                    className="w-16"
                    onClick={() => setBenchmarkMode(!benchmarkMode)}
                  >
                    {benchmarkMode ? "On" : "Off"}
                  </Button>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Translation Model
                  </label>
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-white"
                    value={currentModel}
                    onChange={(e) => setCurrentModel(e.target.value)}
                  >
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="gpt-4o">gpt-4o</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Speech-to-Text Model
                  </label>
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-white"
                    value={sttModel}
                    onChange={(e) => setSttModel(e.target.value)}
                  >
                    <optgroup label="Deepgram">
                      <option value="nova-3">Nova 3 (best accuracy)</option>
                      <option value="nova-2">Nova 2 (fast)</option>
                    </optgroup>
                    <optgroup label="OpenAI">
                      <option value="whisper-1">Whisper 1</option>
                      <option value="gpt-4o-mini-transcribe">GPT-4o Mini Transcribe</option>
                    </optgroup>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">
                    Speaker Diarization
                  </label>
                  <Button
                    variant="outline"
                    className="w-16"
                    onClick={() => setDiarizationEnabled(!diarizationEnabled)}
                  >
                    {diarizationEnabled ? "On" : "Off"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Identify different speakers in the audio stream.
                </p>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">
                    Turbo Mode
                  </label>
                  <Button
                    variant="outline"
                    className="w-16"
                    onClick={() => setTurboMode(!turboMode)}
                  >
                    {turboMode ? "On" : "Off"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Split long utterances into 1.5s chunks for faster translation.
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="bg-card border-card-border">
            <CardContent className="p-6">
              <div className="space-y-4">
                {!isRecording ? (
                  <Button
                    className="w-full h-24 text-2xl font-bold bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={startRecording}
                  >
                    <Mic className="mr-3 h-8 w-8" />
                    START
                  </Button>
                ) : (
                  <Button
                    className="w-full h-24 text-2xl font-bold bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={stopRecording}
                  >
                    <Square className="mr-3 h-8 w-8 fill-current" />
                    STOP
                  </Button>
                )}

                <div className="grid grid-cols-2 gap-2 pt-4">
                  <StageIndicator
                    active={listeningActive}
                    label="Listening"
                    icon={<Mic className="w-4 h-4" />}
                  />
                  <StageIndicator
                    active={processingCount > 0}
                    label={processingCount > 1 ? `STT ×${processingCount}` : "STT"}
                    icon={<Activity className="w-4 h-4" />}
                  />
                  <StageIndicator
                    active={translatingActive}
                    label={
                      processingCount > 1
                        ? `Trans ×${processingCount}`
                        : "Translating"
                    }
                    icon={<Globe className="w-4 h-4" />}
                  />
                  <StageIndicator
                    active={speakingActive}
                    label="Speaking"
                    icon={<Volume2 className="w-4 h-4" />}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2 border-b border-border">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Audio Diagnostics
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Waveform</span>
                  <span className="text-sm text-white font-mono">Target RMS &gt; 0.03</span>
                </div>
                <canvas
                  ref={waveformCanvasRef}
                  width={320}
                  height={88}
                  className="w-full rounded border border-border bg-slate-950"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Live RMS</span>
                  <span className="text-sm text-white font-mono">
                    {audioStats.rmsLevel.toFixed(3)}
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, audioStats.rmsLevel * 1000)}%`,
                      backgroundColor:
                        audioStats.rmsLevel >= 0.03 ? "#22c55e" : "#eab308",
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Peak Level</span>
                  <span className="text-sm text-white font-mono">
                    {(audioStats.peakLevel * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, audioStats.peakLevel * 100)}%`,
                      backgroundColor: audioStats.isClipping ? "#ef4444" : "#38bdf8",
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Speech Probability</span>
                <span className="text-white font-mono">
                  {(audioStats.speechProbability * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">RMS Level</span>
                <span className="text-white font-mono">
                  {audioStats.rmsLevel.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Speech</span>
                <span
                  className={
                    audioStats.speechDetected ? "text-green-500" : "text-red-500"
                  }
                >
                  {audioStats.speechDetected ? "Detected" : "Not Detected"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Clipping</span>
                <span
                  className={
                    audioStats.isClipping ? "text-red-500" : "text-green-500"
                  }
                >
                  {audioStats.isClipping ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">RMS Quality</span>
                <span className="text-lg font-bold" style={{ color: latestRmsIndicator.color }}>
                  {latestRmsIndicator.label}
                </span>
              </div>
              {captureWarnings.length > 0 && (
                <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/10 p-3">
                  {captureWarnings.map((warning) => (
                    <p key={warning} className="text-sm text-amber-200">
                      {warning}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-card-border">
            <CardHeader className="pb-2 border-b border-border">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Session Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1 flex items-center">
                  <Clock className="w-4 h-4 mr-2" />
                  Latency
                </p>
                <p className="text-2xl font-bold text-white font-mono">
                  {latency !== null ? `${(latency / 1000).toFixed(1)}s` : "--"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1 flex items-center">
                  <Globe className="w-4 h-4 mr-2" />
                  Detected
                </p>
                <p className="text-2xl font-bold text-accent font-mono uppercase">
                  {sourceLanguage || "--"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1 flex items-center">
                  <Zap className="w-4 h-4 mr-2" />
                  Confidence
                </p>
                <p className="text-2xl font-bold text-white font-mono">
                  {`${(confidence * 100).toFixed(0)}%`}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Queue</p>
                <p className="text-2xl font-bold text-white font-mono">
                  {audioQueueLength}
                </p>
                {estimatedWaitMs > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ~{(estimatedWaitMs / 1000).toFixed(1)}s wait
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Accepted Chunks</p>
                <p className="text-2xl font-bold text-white font-mono">
                  {audioStats.acceptedChunkCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Discarded Chunks</p>
                <p className="text-2xl font-bold text-white font-mono">
                  {audioStats.discardedChunkCount}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-9 grid grid-rows-2 gap-6 h-[calc(100vh-12rem)]">
          <Card className="bg-card border-card-border overflow-hidden flex flex-col">
            <CardHeader className="bg-sidebar border-b border-border py-4">
              <CardTitle className="text-lg font-bold text-muted-foreground uppercase tracking-wider flex items-center">
                Live Transcript
                {listeningActive && (
                  <span className="ml-3 flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                  </span>
                )}
                {diarizationEnabled && currentSpeaker && (
                  <span className="ml-3 text-sm font-normal text-primary">
                    <Users className="inline h-4 w-4 mr-1" />
                    {currentSpeaker}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 flex-1 overflow-auto bg-background/50">
              {diarizationEnabled && transcriptWithSpeakers.length > 0 ? (
                <div className="space-y-4">
                  {transcriptWithSpeakers.slice(-10).map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <span className="text-xs text-primary font-mono mt-1">
                        {entry.speaker || "Unknown"}
                      </span>
                      <p className="text-2xl lg:text-3xl font-medium leading-relaxed text-muted-foreground">
                        {entry.text}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-3xl lg:text-4xl font-medium leading-relaxed text-muted-foreground">
                  {originalText || "Waiting for audio input..."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-primary/20 border-2 overflow-hidden flex flex-col shadow-[0_0_15px_rgba(255,191,0,0.05)]">
            <CardHeader className="bg-sidebar border-b border-border py-4">
              <CardTitle className="text-lg font-bold text-primary uppercase tracking-wider flex items-center">
                <Globe className="h-5 w-5 mr-2" />
                Live Translation
                {speakingActive && (
                  <Volume2 className="ml-3 h-5 w-5 text-primary animate-pulse" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 flex-1 overflow-auto bg-background/50">
              <p className="text-4xl lg:text-5xl font-bold leading-tight text-white">
                {translatedText || "Translation will appear here..."}
              </p>
              {session.targetLanguages && session.targetLanguages.length > 1 && (
                <div className="mt-4 text-sm text-muted-foreground">
                  Translating to: {session.targetLanguages.join(", ")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {showDebugPanel && (
        <div className="fixed bottom-4 left-4 right-4 top-20 bg-card border border-border rounded-lg p-6 shadow-lg z-50 overflow-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">Debug Panel</h2>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={downloadAllChunksAsZip}
                disabled={recordedChunks.length === 0}
              >
                Download All Chunks as ZIP
              </Button>
              <Button variant="outline" onClick={() => setShowDebugPanel(false)}>
                Close
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Recorded Chunks</p>
              <p className="text-2xl font-bold">{audioStats.acceptedChunkCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">STT Requests</p>
              <p className="text-2xl font-bold">{debugMetrics.sttRequests}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Translation Requests</p>
              <p className="text-2xl font-bold">
                {debugMetrics.translationRequests}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg. Latency</p>
              <p className="text-2xl font-bold">
                {debugMetrics.avgLatency.toFixed(0)}ms
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            {recordedChunks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recorded chunks yet. Start capture to inspect WAV input.
              </p>
            ) : (
              [...recordedChunks]
                .sort((left, right) => right.chunkNumber - left.chunkNumber)
                .map((chunk) => {
                  const indicator = getRmsIndicator(chunk.rmsLevel);
                  return (
                    <div
                      key={chunk.chunkNumber}
                      className="rounded border border-border bg-sidebar/40 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-lg font-semibold text-white">
                            Chunk {chunk.chunkNumber}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Time: {formatSessionTime(chunk.sessionOffsetMs)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Duration: {(chunk.durationMs / 1000).toFixed(1)}s
                          </p>
                          <p className="text-sm text-muted-foreground">
                            RMS: {chunk.rmsLevel.toFixed(3)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Peak: {chunk.peakLevel.toFixed(3)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            File Size: {formatFileSize(chunk.fileSize)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Speech: {chunk.speechDetected ? "YES" : "NO"}
                          </p>
                          <p
                            className="text-sm font-medium"
                            style={{ color: indicator.color }}
                          >
                            {indicator.label}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => playCapturedChunk(chunk.blob)}
                          >
                            Play
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => downloadRecordedChunk(chunk)}
                          >
                            Download
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      )}

      {showMetricsDashboard && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <Card className="bg-card border-card-border max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-xl font-bold text-white">
                Metrics Dashboard
              </CardTitle>
              <Button
                variant="outline"
                onClick={() => setShowMetricsDashboard(false)}
              >
                Close
              </Button>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Audio Quality Score
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-green-500">
                      {debugMetrics.audioQualityScore}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      VAD Discard Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-blue-500">
                      {debugMetrics.vadDiscardPercent}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Avg. Total Latency
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-yellow-500">
                      {debugMetrics.avgLatency.toFixed(0)}ms
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Current Models
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">STT: <span className="text-cyan-500 font-bold">{sttModel}</span></p>
                      <p className="text-sm text-muted-foreground">Translation: <span className="text-purple-500 font-bold">{currentModel}</span></p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Avg. STT Latency
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-cyan-500">
                      {debugMetrics.sttRequests > 0
                        ? `${(debugMetrics.sttLatency / debugMetrics.sttRequests).toFixed(0)}ms`
                        : "--"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Avg. Translation Latency
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-orange-500">
                      {debugMetrics.sttRequests > 0
                        ? `${(debugMetrics.translationLatency / debugMetrics.sttRequests).toFixed(0)}ms`
                        : "--"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Avg. TTS Latency
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-pink-500">
                      {debugMetrics.ttsRequests > 0
                        ? `${(debugMetrics.ttsLatency / debugMetrics.ttsRequests).toFixed(0)}ms`
                        : "--"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      STT Model
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xl font-bold text-emerald-500">
                      gpt-4o-mini-transcribe
                    </p>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function StageIndicator({
  active,
  label,
  icon,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-3 rounded border transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-sidebar text-muted-foreground"
      }`}
    >
      <div className={`mb-1 ${active ? "animate-pulse" : ""}`}>{icon}</div>
      <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}
