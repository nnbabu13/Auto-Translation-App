
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRoute, Link } from "wouter";
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
import { QueueManager } from "@/lib/audio/queueManager";
import { StreamingCapture, type AudioStats } from "@/lib/audio/streamingCapture";
import { synthesizeLocal, hasLocalVoice, initPiper, downloadPiperVoice } from "@/lib/audio/piperTts";
import { audioDeviceManager, type DeviceInfo, type DeviceHealthStatus, type DeviceHealthReport } from "@/lib/audio/deviceManager";

type AudioInputDevice = {
  deviceId: string;
  label: string;
};

type AudioOutputDevice = {
  deviceId: string;
  label: string;
};

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
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsProvider, setTtsProvider] = useState<"local" | "cloud">("local");
  const [piperReady, setPiperReady] = useState(false);
  const [piperDownloadProgress, setPiperDownloadProgress] = useState<string>("");
  const [noiseSuppression, setNoiseSuppression] = useState(false);
  const [sourceLanguageSetting, setSourceLanguageSetting] = useState<string>("en");

  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [activeDeviceName, setActiveDeviceName] = useState("No input selected");
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState("");
  const [activeOutputDeviceName, setActiveOutputDeviceName] = useState("System Default");
  const [inputDeviceStatus, setInputDeviceStatus] = useState<DeviceHealthStatus>("ok");
  const [outputDeviceStatus, setOutputDeviceStatus] = useState<DeviceHealthStatus>("ok");
  const [showInputTest, setShowInputTest] = useState(false);
  const [inputTestRms, setInputTestRms] = useState(0);
  const [inputTestSpeechDetected, setInputTestSpeechDetected] = useState(false);
  const [showOutputTest, setShowOutputTest] = useState(false);
  const [outputTestStatus, setOutputTestStatus] = useState<"idle" | "testing" | "done" | "error">("idle");
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
  const [diarizationEnabled, setDiarizationEnabled] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [transcriptWithSpeakers, setTranscriptWithSpeakers] = useState<{speaker: string | null; text: string; timestamp: number}[]>([]);

  const [interimText, setInterimText] = useState("");
  const [utteranceId, setUtteranceId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [deepgramError, setDeepgramError] = useState<string | null>(null);

  const [translationHistory, setTranslationHistory] = useState<Array<{
    original: string;
    translated: string;
    speaker: string | null;
    timestamp: number;
  }>>([]);

  const [transcriptHistory, setTranscriptHistory] = useState<Array<{
    text: string;
    speaker: string | null;
    timestamp: number;
  }>>([]);

  const [audioStats, setAudioStats] = useState<AudioStats>({
    volumeLevel: 0,
    rmsLevel: 0,
    peakLevel: 0,
    isClipping: false,
    isSilent: true,
    quality: "Excellent",
    speechDetected: false,
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
  const streamingCaptureRef = useRef<StreamingCapture | null>(null);
  const isRecordingRef = useRef(false);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const transcriptRef = useRef<string[]>([]);
  const translationsRef = useRef<string[]>([]);
  const transcriptHistoryRef = useRef<{ text: string; timestamp: number }[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const translationEndRef = useRef<HTMLDivElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const currentUtteranceIdRef = useRef<string | null>(null);

  const restBufferRef = useRef<Int16Array>(new Int16Array(0));
  const restFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const testAnalyserRef = useRef<AnalyserNode | null>(null);
  const testAnimFrameRef = useRef<number | null>(null);
  const testAudioCtxRef = useRef<AudioContext | null>(null);

  const [currentPlaybackRate, setCurrentPlaybackRate] = useState(1.0);
  const [chunkCreationDelay, setChunkCreationDelay] = useState(0);
  const [playbackQueueDelay, setPlaybackQueueDelay] = useState(0);
  const [endToEndLatency, setEndToEndLatency] = useState(0);

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

  useEffect(() => {
    isRecordingRef.current = isRecording;
    if (!queueManagerRef.current) {
      queueManagerRef.current = new QueueManager(selectedOutputDeviceId);
    }
  }, [isRecording]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptHistory.length]);

  useEffect(() => {
    translationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [translationHistory.length]);

  useEffect(() => {
    initPiper().then(() => {
      setPiperReady(true);
      if (session?.targetLanguage && hasLocalVoice(session.targetLanguage)) {
        setPiperDownloadProgress(`Downloading ${session.targetLanguage} voice...`);
        downloadPiperVoice(session.targetLanguage, (progress) => {
          const pct = Math.round((progress.loaded * 100) / progress.total);
          setPiperDownloadProgress(`Downloading ${session.targetLanguage} voice: ${pct}%`);
        }).then(() => {
          setPiperDownloadProgress("");
        });
      }
    });
  }, [session?.targetLanguage]);

  const loadAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    await audioDeviceManager.enumerate();

    const inputs = audioDeviceManager.getInputDevices();
    const outputs = audioDeviceManager.getOutputDevices();

    setAudioInputDevices(
      inputs.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Audio Input ${i + 1}`,
      })),
    );
    setAudioOutputDevices(
      outputs.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Audio Output ${i + 1}`,
      })),
    );

    const persisted = audioDeviceManager.loadPersisted();

    const vacDevice = inputs.find(
      (d) =>
        d.label.toLowerCase().includes("cable") ||
        d.label.toLowerCase().includes("virtual") ||
        d.label.toLowerCase().includes("stereo mix") ||
        d.label.toLowerCase().includes("line"),
    );
    const preferredInput = persisted.inputId || vacDevice?.deviceId || inputs[0]?.deviceId || "";
    setSelectedDeviceId((current) => current || preferredInput);

    const preferredOutput =
      persisted.outputId || outputs.find((d) => d.label.toLowerCase().includes("headphone"))?.deviceId || "";
    setSelectedOutputDeviceId((current) => current || preferredOutput);
    if (preferredOutput) {
      const out = outputs.find((d) => d.deviceId === preferredOutput);
      setActiveOutputDeviceName(out?.label || "System Default");
    }
  }, []);

  const testInputDevice = useCallback(async () => {
    if (isRecording) return;
    setShowInputTest(true);
    setInputTestRms(0);
    setInputTestSpeechDetected(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      testStreamRef.current = stream;
      audioDeviceManager.setPermissionGranted(true);

      const audioCtx = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      testAnalyserRef.current = analyser;
      testAudioCtxRef.current = audioCtx;

      const buffer = new Float32Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!testAnalyserRef.current) return;
        testAnalyserRef.current.getFloatTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          sumSquares += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        setInputTestRms(rms);
        setInputTestSpeechDetected(rms >= 0.015);
        testAnimFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.error("Input test failed:", err);
      setShowInputTest(false);
    }
  }, [isRecording, selectedDeviceId]);

  const closeInputTest = useCallback(() => {
    setShowInputTest(false);
    if (testAnimFrameRef.current) {
      cancelAnimationFrame(testAnimFrameRef.current);
      testAnimFrameRef.current = null;
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((t) => t.stop());
      testStreamRef.current = null;
    }
    if (testAudioCtxRef.current) {
      testAudioCtxRef.current.close().catch(() => {});
      testAudioCtxRef.current = null;
    }
    testAnalyserRef.current = null;
  }, []);

  const testOutputDevice = useCallback(async () => {
    if (showOutputTest) return;
    setShowOutputTest(true);
    setOutputTestStatus("testing");

    try {
      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      if (selectedOutputDeviceId && typeof (ctx as any).setSinkId === "function") {
        try {
          await (ctx as any).setSinkId(selectedOutputDeviceId);
        } catch (err) {
          console.warn("Output test setSinkId failed:", err);
        }
      }

      const sampleRate = ctx.sampleRate;
      const duration = 1.5;
      const freq = 440;
      const length = sampleRate * duration;
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        data[i] = Math.sin(2 * Math.PI * freq * t) * 0.3 * (1 - t / duration);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start(0);
      });

      await ctx.close();
      setOutputTestStatus("done");
      setTimeout(() => {
        setShowOutputTest(false);
        setOutputTestStatus("idle");
      }, 1500);
    } catch (err) {
      console.error("Output test failed:", err);
      setOutputTestStatus("error");
      setTimeout(() => {
        setShowOutputTest(false);
        setOutputTestStatus("idle");
      }, 2000);
    }
  }, [selectedOutputDeviceId, showOutputTest]);

  useEffect(() => {
    loadAudioDevices().catch((error) => {
      console.error("Failed to enumerate audio devices:", error);
    });
  }, [loadAudioDevices]);

  useEffect(() => {
    const handleDeviceChange = (inputs: DeviceInfo[], outputs: DeviceInfo[]) => {
      setAudioInputDevices(
        inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Audio Input ${i + 1}` })),
      );
      setAudioOutputDevices(
        outputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Audio Output ${i + 1}` })),
      );

      setInputDeviceStatus(audioDeviceManager.getInputHealth(selectedDeviceId));
      setOutputDeviceStatus(audioDeviceManager.getOutputHealth(selectedOutputDeviceId));
    };

    const handleHealthChange = (reports: DeviceHealthReport[]) => {
      for (const report of reports) {
        if (report.deviceId === selectedDeviceId) {
          setInputDeviceStatus(report.status);
        }
        if (report.deviceId === selectedOutputDeviceId) {
          setOutputDeviceStatus(report.status);
        }
      }
    };

    audioDeviceManager.startListening();
    audioDeviceManager.onDeviceChange(handleDeviceChange);
    audioDeviceManager.onHealthChange(handleHealthChange);

    return () => {
      audioDeviceManager.stopListening();
      audioDeviceManager.removeDeviceChangeListener(handleDeviceChange);
      audioDeviceManager.removeHealthChangeListener(handleHealthChange);
    };
  }, [selectedDeviceId, selectedOutputDeviceId]);

  useEffect(() => {
    audioDeviceManager.persistInput(selectedDeviceId);
    const input = audioDeviceManager.getInputDevices().find((d) => d.deviceId === selectedDeviceId);
    if (input) setInputDeviceStatus("ok");
  }, [selectedDeviceId]);

  useEffect(() => {
    audioDeviceManager.persistOutput(selectedOutputDeviceId);
    const output = audioDeviceManager.getOutputDevices().find((d) => d.deviceId === selectedOutputDeviceId);
    if (output) {
      setActiveOutputDeviceName(output.label);
      setOutputDeviceStatus("ok");
    }
    if (queueManagerRef.current) {
      queueManagerRef.current.setSinkId(selectedOutputDeviceId).catch(console.error);
    }
  }, [selectedOutputDeviceId]);

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

  const handleFinalResult = useCallback((msg: any) => {
    if (!session) return;

    const { text, translatedText, translations, sourceLanguage, speaker, audioBase64, confidence, sequence, translationLatencyMs, ttsLatencyMs, endToEndLatencyMs } = msg;

    setPreviousOriginalText(text);
    transcriptRef.current.push(text);
    translationsRef.current.push(translatedText);
    transcriptHistoryRef.current.push({ text, timestamp: Date.now() });

    setOriginalText(text);
    setSourceLanguage(sourceLanguage);
    setConfidence(confidence || 0);
    setLatency((translationLatencyMs || 0) + (ttsLatencyMs || 0));

    setChunkCreationDelay(0);
    setPlaybackQueueDelay(0);
    setEndToEndLatency(endToEndLatencyMs || 0);

    setTranscriptHistory(prev => [...prev.slice(-19), {
      text,
      speaker: speaker || null,
      timestamp: Date.now(),
    }]);

    if (speaker) {
      setCurrentSpeaker(speaker);
      setTranscriptWithSpeakers(prev => [...prev.slice(-30), {
        speaker,
        text,
        timestamp: Date.now()
      }]);
    }

    setTranslatedText(translatedText);
    setTranslationHistory(prev => [...prev.slice(-20), {
      original: text,
      translated: translatedText,
      speaker: speaker || null,
      timestamp: Date.now(),
    }]);

    setDebugMetrics((prev) => {
      const newTotalLatency = prev.totalLatency + (translationLatencyMs || 0) + (ttsLatencyMs || 0);
      const newSttRequests = prev.sttRequests + 1;
      return {
        ...prev,
        recordedChunks: prev.recordedChunks + 1,
        sttRequests: newSttRequests,
        translationRequests: prev.translationRequests + 1,
        ttsRequests: audioBase64 ? prev.ttsRequests + 1 : prev.ttsRequests,
        totalLatency: newTotalLatency,
        avgLatency: newTotalLatency / newSttRequests,
        sttLatency: prev.sttLatency,
        translationLatency: prev.translationLatency + (translationLatencyMs || 0),
        ttsLatency: prev.ttsLatency + (ttsLatencyMs || 0),
      };
    });

    const shouldUseLocalTTS = ttsEnabled && ttsProvider === "local" && session && hasLocalVoice(session.targetLanguage);
    const audioForPlayback = audioBase64 || "";

    if ((audioForPlayback || shouldUseLocalTTS) && queueManagerRef.current) {
      const qLen = queueManagerRef.current.getPlaybackQueueLength();
      if (qLen > 15) {
        queueManagerRef.current.setPlaybackRate(1.15);
      } else if (qLen > 10) {
        queueManagerRef.current.setPlaybackRate(1.1);
      } else if (qLen > 5) {
        queueManagerRef.current.setPlaybackRate(1.05);
      } else {
        queueManagerRef.current.setPlaybackRate(1.0);
      }
      setCurrentPlaybackRate(queueManagerRef.current.getPlaybackRate());

      if (shouldUseLocalTTS && !audioBase64 && translatedText && session) {
        setSpeakingActive(true);
        synthesizeLocal(translatedText, session.targetLanguage).then((wavBlob) => {
          if (wavBlob && queueManagerRef.current) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(",")[1];
              queueManagerRef.current!.addToPlaybackQueue({
                chunkId: Date.now(),
                originalText: text,
                translatedText,
                sourceLanguage,
                audioBase64: base64,
                latencyMs: (translationLatencyMs || 0) + (ttsLatencyMs || 0),
              });
              setAudioQueueLength(queueManagerRef.current!.getPlaybackQueueLength());
              setEstimatedWaitMs(queueManagerRef.current!.getEstimatedWaitMs());
            };
            reader.readAsDataURL(wavBlob);
          }
          setSpeakingActive(false);
        }).catch(() => {
          setSpeakingActive(false);
        });
      } else if (audioForPlayback) {
        queueManagerRef.current.addToPlaybackQueue({
          chunkId: Date.now(),
          originalText: text,
          translatedText,
          sourceLanguage,
          audioBase64: audioForPlayback,
          latencyMs: (translationLatencyMs || 0) + (ttsLatencyMs || 0),
        });
        setAudioQueueLength(queueManagerRef.current.getPlaybackQueueLength());
        setEstimatedWaitMs(queueManagerRef.current.getEstimatedWaitMs());
      }
    }

    setProcessingCount(0);
  }, [ttsProvider, ttsEnabled, session?.targetLanguage, session]);

  const flushRestBuffer = useCallback(async () => {
    const buf = restBufferRef.current;
    if (buf.length === 0) {
      restFlushTimerRef.current = setTimeout(flushRestBuffer, 3000);
      return;
    }

    restBufferRef.current = new Int16Array(0);

    const float32 = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      float32[i] = buf[i] / (buf[i] < 0 ? 0x8000 : 0x7fff);
    }

    const { encodeWavPCM16 } = await import("@/lib/audio/wavEncoder");
    const wavBlob = encodeWavPCM16(float32, 16000);

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(wavBlob);
    });

    if (!session) {
      restFlushTimerRef.current = setTimeout(flushRestBuffer, 3000);
      return;
    }

    const nowMs = Date.now();
    const contextWindowMs = cinemaMode ? 120000 : 60000;
    const recentTranscripts = transcriptHistoryRef.current
      .filter((entry) => nowMs - entry.timestamp < contextWindowMs)
      .map((entry) => entry.text);

    const useCompression = translationHistory.length > 8;

    try {
      const response = await fetch("/api/translate/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: base64,
          audioExt: "wav",
          targetLanguage: session.targetLanguage,
          targetLanguages: session.targetLanguages || [session.targetLanguage],
          sessionId: session.id,
          previousTranscripts: recentTranscripts,
          sourceLanguage: sourceLanguageSetting,
          model: currentModel,
          sttModel,
          cinemaMode,
          diarize: diarizationEnabled,
          compressionMode: useCompression,
          skipTTS: !ttsEnabled || ttsProvider === "local",
        }),
      });

      if (!response.ok) {
        restFlushTimerRef.current = setTimeout(flushRestBuffer, 3000);
        return;
      }
      const data = await response.json();

      if (!data.originalText) {
        restFlushTimerRef.current = setTimeout(flushRestBuffer, 3000);
        return;
      }

      handleFinalResult({
        text: data.originalText,
        translatedText: data.translatedText,
        translations: data.translations,
        sourceLanguage: data.sourceLanguage,
        speaker: data.speaker || null,
        audioBase64: data.audioBase64 || "",
        confidence: data.confidence || 0,
        sequence: Date.now(),
        translationLatencyMs: data.translationLatencyMs || 0,
        ttsLatencyMs: data.ttsLatencyMs || 0,
        endToEndLatencyMs: data.latencyMs || 0,
      });
    } catch (err) {
      console.error("REST flush error:", err);
    }
    restFlushTimerRef.current = setTimeout(flushRestBuffer, 3000);
  }, [session, sourceLanguageSetting, currentModel, sttModel, cinemaMode, diarizationEnabled, translationHistory.length, ttsEnabled, ttsProvider]);

  const startRecording = async () => {
    if (!session || isRecording) return;
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      audioDeviceManager.setPermissionGranted(true);

      const activeTrack = stream.getAudioTracks()[0];
      setActiveDeviceName(
        activeTrack.label
          ? `${activeTrack.label} (${activeTrack.getSettings().sampleRate ?? "auto"} Hz)`
          : selectedDeviceId
            ? `Device ${selectedDeviceId.slice(0, 8)}...`
            : "Selected Audio Input",
      );

      streamRef.current = stream;
      await loadAudioDevices();

      let wsMode = false;
      const capture = new StreamingCapture();
      streamingCaptureRef.current = capture;
      capture.setStatsCallback((stats) => setAudioStats(stats));

      try {
        const wsUrlOverride = import.meta.env.VITE_WS_URL;
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        const wsHost = import.meta.env.DEV ? "localhost:3000" : location.host;
        const wsPath = `/api/stream?sessionId=${session.id}&targetLanguage=${session.targetLanguage}&sourceLanguage=${sourceLanguageSetting}&model=${currentModel}&sttModel=${sttModel}&cinemaMode=${cinemaMode}&diarize=${diarizationEnabled}&compressionMode=${translationHistory.length > 8}&skipTTS=${!ttsEnabled || ttsProvider === "local"}`;

        const wsUrl = wsUrlOverride || `${protocol}://${wsHost}${wsPath}`;

        await capture.start(stream, wsUrl);

        const ws = capture.getWs();
        wsRef.current = ws;

        if (!ws) {
          throw new Error("WebSocket not available after start");
        }

        ws.addEventListener("message", (event) => {
          const msg = JSON.parse(event.data as string);
          switch (msg.type) {
            case "interim":
              currentUtteranceIdRef.current = msg.utteranceId;
              setInterimText(msg.text);
              setUtteranceId(msg.utteranceId);
              break;

            case "final":
              setInterimText("");
              currentUtteranceIdRef.current = null;
              setUtteranceId(null);
              handleFinalResult(msg);
              break;

            case "utteranceEnd":
              currentUtteranceIdRef.current = null;
              setUtteranceId(null);
              break;

            case "error":
              setDeepgramError(msg.message);
              break;
          }
        });

        ws.addEventListener("open", () => {
          setWsConnected(true);
        });

        ws.addEventListener("close", () => {
          setWsConnected(false);
        });

        wsMode = true;
        setWsConnected(true);
      } catch (wsErr) {
        const msg = String(wsErr);
        if (!msg.includes("WebSocket")) throw wsErr;

        console.warn("WebSocket unavailable, falling back to REST mode");
        await capture.startRest(stream, (chunk) => {
          const buf = restBufferRef.current;
          const newBuf = new Int16Array(buf.length + chunk.length);
          newBuf.set(buf, 0);
          newBuf.set(chunk, buf.length);
          restBufferRef.current = newBuf;
        });

        restFlushTimerRef.current = setTimeout(flushRestBuffer, 3000);
      }

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

  const stopRecording = useCallback(async () => {
    if (restFlushTimerRef.current) {
      clearTimeout(restFlushTimerRef.current);
      restFlushTimerRef.current = null;
    }
    await flushRestBuffer();
    if (restFlushTimerRef.current) {
      clearTimeout(restFlushTimerRef.current);
      restFlushTimerRef.current = null;
    }
    restBufferRef.current = new Int16Array(0);

    if (streamingCaptureRef.current) {
      streamingCaptureRef.current.stop();
      streamingCaptureRef.current = null;
    }
    wsRef.current = null;
    currentUtteranceIdRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setListeningActive(false);
    setWsConnected(false);
    setInterimText("");
    setUtteranceId(null);
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
                    Supports Microphone, Line In, Virtual Audio Cable, and Stereo Mix when exposed by the OS.
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Input Device</p>
                  <p className="text-sm text-white">
                    {activeDeviceName}
                    {inputDeviceStatus !== "ok" && (
                      <span className="ml-2 text-xs text-red-500">
                        ({inputDeviceStatus === "disconnected" ? "Disconnected" : inputDeviceStatus === "changed" ? "Changed" : inputDeviceStatus === "perm-revoked" ? "Permission Revoked" : ""})
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Audio Output Device
                  </label>
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-white"
                    value={selectedOutputDeviceId}
                    onChange={(e) => setSelectedOutputDeviceId(e.target.value)}
                  >
                    <option value="">System Default</option>
                    {audioOutputDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Routes translated audio to the selected output.
                    {outputDeviceStatus !== "ok" && (
                      <span className="ml-1 text-red-500">
                        ({outputDeviceStatus === "disconnected" ? "Disconnected" : outputDeviceStatus === "changed" ? "Changed" : outputDeviceStatus === "perm-revoked" ? "Permission Revoked" : ""})
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Output Device</p>
                  <p className="text-sm text-white">{activeOutputDeviceName}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={testInputDevice}
                    disabled={isRecording}
                  >
                    Test Input
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={testOutputDevice}
                    disabled={showOutputTest}
                  >
                    {showOutputTest && outputTestStatus === "testing"
                      ? "Testing..."
                      : "Test Output"}
                  </Button>
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
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">
                    Text-to-Speech
                  </label>
                  <Button
                    variant="outline"
                    className="w-16"
                    onClick={() => setTtsEnabled(!ttsEnabled)}
                  >
                    {ttsEnabled ? "On" : "Off"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Generate spoken audio for translations. Disable to reduce latency and API costs.
                </p>
                {ttsEnabled && (
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">
                      TTS Provider
                    </label>
                    <select
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-white"
                      value={ttsProvider}
                      onChange={(e) => setTtsProvider(e.target.value as "local" | "cloud")}
                    >
                      <option value="local">Local (Piper WASM)</option>
                      <option value="cloud">Cloud (OpenAI)</option>
                    </select>
                    {ttsProvider === "local" && !piperReady && (
                      <p className="mt-1 text-xs text-yellow-500">Initializing Piper...</p>
                    )}
                    {piperDownloadProgress && (
                      <p className="mt-1 text-xs text-blue-500">{piperDownloadProgress}</p>
                    )}
                    {ttsProvider === "local" && piperReady && !piperDownloadProgress && (
                      <p className="mt-1 text-xs text-green-500">Piper ready - runs in browser, no API cost</p>
                    )}
                  </div>
                )}
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
                <span className="text-muted-foreground">WebSocket</span>
                <span className={wsConnected ? "text-green-500" : "text-red-500"}>
                  {wsConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <div className="border-t border-border pt-3 mt-3">
                <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
                  Deepgram Stream
                </p>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Utterance ID</span>
                    <span className="text-white font-mono">
                      {utteranceId || "---"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Interim</span>
                    <span className="text-white font-mono truncate max-w-[120px]">
                      {interimText || "---"}
                    </span>
                  </div>
                  {deepgramError && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Error</span>
                      <span className="text-red-500 font-mono text-xs">{deepgramError}</span>
                    </div>
                  )}
                </div>
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
                <p className="text-sm text-muted-foreground mb-1">Sequences</p>
                <p className="text-2xl font-bold text-white font-mono">
                  {debugMetrics.sttRequests}
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
              {transcriptHistory.length > 0 ? (
                <div className="space-y-4">
                  {transcriptHistory.map((entry, idx) => (
                    <div key={entry.timestamp} className={idx === transcriptHistory.length - 1 ? "" : "opacity-60"}>
                      {entry.speaker && diarizationEnabled && (
                        <span className="text-xs text-primary font-mono block">{entry.speaker}</span>
                      )}
                      <p className="text-2xl lg:text-3xl font-medium leading-relaxed text-muted-foreground">
                        {entry.text}
                      </p>
                    </div>
                  ))}
                  {interimText && (
                    <div className="opacity-40">
                      <p className="text-2xl lg:text-3xl font-medium leading-relaxed text-muted-foreground italic">
                        {interimText}
                      </p>
                    </div>
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              ) : (
                <p className="text-3xl lg:text-4xl font-medium leading-relaxed text-muted-foreground">
                  {interimText || "Waiting for audio input..."}
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
              {translationHistory.length > 0 ? (
                <div className="space-y-4">
                  {translationHistory.map((entry, idx) => (
                    <div key={entry.timestamp} className={idx === translationHistory.length - 1 ? "" : "opacity-60"}>
                      {entry.speaker && (
                        <span className="text-xs text-primary font-mono block">{entry.speaker}</span>
                      )}
                      <p className="text-4xl lg:text-5xl font-bold leading-tight text-white">
                        {entry.translated}
                      </p>
                    </div>
                  ))}
                  <div ref={translationEndRef} />
                </div>
              ) : (
                <p className="text-4xl lg:text-5xl font-bold leading-tight text-white">
                  {"Translation will appear here..."}
                </p>
              )}
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
              <Button variant="outline" onClick={() => setShowDebugPanel(false)}>
                Close
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Sequences</p>
              <p className="text-2xl font-bold">{debugMetrics.sttRequests}</p>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div>
              <p className="text-sm text-muted-foreground">WebSocket</p>
              <p className="text-2xl font-bold" style={{ color: wsConnected ? "#22c55e" : "#ef4444" }}>{wsConnected ? "Connected" : "Disconnected"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Playback Rate</p>
              <p className="text-2xl font-bold text-purple-500">{currentPlaybackRate.toFixed(2)}x</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Compression</p>
              <p className="text-2xl font-bold text-emerald-500">{translationHistory.length > 8 ? "ON" : "OFF"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Utterance ID</p>
              <p className="text-2xl font-bold text-blue-500">{utteranceId || "---"}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="rounded border border-border bg-sidebar/40 p-3">
              <p className="text-xs text-muted-foreground uppercase">Translation Latency</p>
              <p className="text-2xl font-bold text-yellow-500">{(debugMetrics.sttRequests > 0 ? (debugMetrics.translationLatency / debugMetrics.sttRequests) : 0).toFixed(0)}ms</p>
              <p className="text-xs text-muted-foreground">Avg translation time</p>
            </div>
            <div className="rounded border border-border bg-sidebar/40 p-3">
              <p className="text-xs text-muted-foreground uppercase">TTS Latency</p>
              <p className="text-2xl font-bold text-orange-500">{(debugMetrics.ttsRequests > 0 ? (debugMetrics.ttsLatency / debugMetrics.ttsRequests) : 0).toFixed(0)}ms</p>
              <p className="text-xs text-muted-foreground">Avg TTS generation</p>
            </div>
            <div className="rounded border border-border bg-sidebar/40 p-3">
              <p className="text-xs text-muted-foreground uppercase">End-to-End Latency</p>
              <p className="text-2xl font-bold text-red-500">{(endToEndLatency / 1000).toFixed(1)}s</p>
              <p className="text-xs text-muted-foreground">Final → displayed</p>
            </div>
          </div>
        </div>
      )}

      {showInputTest && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <Card className="bg-card border-card-border max-w-md w-full mx-4">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-bold text-white">Input Test</CardTitle>
              <Button variant="outline" onClick={closeInputTest}>Close</Button>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-muted-foreground">RMS Level</span>
                  <span className="text-sm text-white font-mono">{inputTestRms.toFixed(4)}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div
                    className="h-3 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, inputTestRms * 1000)}%`,
                      backgroundColor: inputTestRms >= 0.03 ? "#22c55e" : inputTestRms >= 0.015 ? "#eab308" : "#ef4444",
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Speech Detected</span>
                <span className={inputTestSpeechDetected ? "text-green-500" : "text-red-500"}>
                  {inputTestSpeechDetected ? "Yes" : "No"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {inputTestRms < 0.005
                  ? "No audible input detected. Check your device connection."
                  : inputTestRms < 0.015
                  ? "Signal detected but very low. Consider increasing input volume."
                  : "Good input level."}
              </div>
            </CardContent>
          </Card>
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
                      WebSocket Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className={`text-3xl font-bold ${wsConnected ? "text-green-500" : "text-red-500"}`}>
                      {wsConnected ? "Connected" : "Disconnected"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Deepgram Model
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-blue-500">
                      {sttModel}
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
