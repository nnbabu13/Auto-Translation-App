import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

function runPiper(args: string[], inputText: string): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PIPER_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout = Buffer.concat([stdout, chunk]); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`Piper exited ${code}: ${stderr}`));
      else resolve({ stdout, stderr });
    });
    proc.on("error", reject);
    proc.stdin.write(inputText);
    proc.stdin.end();
  });
}

const PIPER_BIN = join(__dirname, "../../piper/piper/piper.exe");
const MODELS_DIR = join(__dirname, "../../piper/models");
const CACHE_DIR = join(__dirname, "../../piper/cache");

const VOICE_MAP: Record<string, string> = {
  English: "en_US-lessac-medium",
  Greek: "el_GR-rapunzelina-low",
  Spanish: "es_ES-sharvard-medium",
  French: "fr_FR-siwis-medium",
  German: "de_DE-thorsten-medium",
};

const ttsCache = new Map<string, Buffer>();

export async function synthesizeSpeech(text: string, language: string): Promise<Buffer | null> {
  const voice = VOICE_MAP[language];
  if (!voice) {
    console.warn(`No Piper voice for language: ${language}`);
    return null;
  }

  const cacheKey = `${voice}:${text}`;
  if (ttsCache.has(cacheKey)) {
    return ttsCache.get(cacheKey)!;
  }

  const modelPath = join(MODELS_DIR, `${voice}.onnx`);
  const configPath = join(MODELS_DIR, `${voice}.onnx.json`);

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const tempId = randomBytes(8).toString("hex");
    const tempWav = join(CACHE_DIR, `${tempId}.wav`);

    await runPiper([
      "--model", modelPath,
      "--config_file", configPath,
      "--output_file", tempWav,
      "--length_scale", "1.0",
    ], text);

    const audioBuffer = await readFile(tempWav);

    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tempWav);
    } catch {}

    ttsCache.set(cacheKey, audioBuffer);
    if (ttsCache.size > 500) {
      const firstKey = ttsCache.keys().next().value;
      if (firstKey) ttsCache.delete(firstKey);
    }

    return audioBuffer;
  } catch (err) {
    console.error(`Piper TTS error for voice ${voice}:`, err);
    return null;
  }
}

export function hasPiperVoice(language: string): boolean {
  return language in VOICE_MAP;
}

export function listAvailableVoices(): string[] {
  return Object.keys(VOICE_MAP);
}
