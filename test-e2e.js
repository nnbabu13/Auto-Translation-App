// End-to-end test script for Cinema AI Translator
// Run this in the browser console on http://localhost:5173/sessions/5
// or as a Node.js script with fetch polyfill

async function testEndToEnd() {
  const sessionId = 5;
  const targetLanguage = "Telugu";
  const sourceLanguage = "en";
  const apiBase = "http://localhost:5000";

  console.log("🧪 Starting end-to-end test...");

  // First, check if we have any recorded chunks in the browser's debug panel
  // If not, we'll create a test WAV with some silent audio to test the pipeline
  
  // Generate a simple test WAV (1 second of 440Hz tone at 16kHz)
  function generateTestWav() {
    const sampleRate = 16000;
    const duration = 2; // seconds
    const frequency = 440;
    const samples = new Float32Array(sampleRate * duration);
    
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.3;
    }
    
    // Encode as WAV
    const bytesPerSample = 2;
    const numChannels = 1;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // RIFF header
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  }

  const testBlob = generateTestWav();
  console.log(`Generated test WAV: ${testBlob.size} bytes, ${testBlob.type}`);
  
  // Convert to base64
  const base64Audio = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(testBlob);
  });
  
  console.log("Sending to /api/translate/chunk...");
  
  try {
    const response = await fetch(`${apiBase}/api/translate/chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: base64Audio,
        audioExt: 'wav',
        targetLanguage,
        sessionId,
        sourceLanguage,
        previousText: '',
      }),
    });
    
    const data = await response.json();
    console.log("✅ Response:", data);
    
    if (data.originalText) {
      console.log("🎯 Transcription:", data.originalText);
      console.log("🌐 Translation:", data.translatedText);
      console.log("📊 Confidence:", data.confidence);
      console.log("⏱️ Latency:", data.latencyMs, "ms");
      
      if (data.audioBase64) {
        console.log("🔊 TTS audio received:", data.audioBase64.length, "chars base64");
        
        // Play the TTS audio
        const audio = new Audio('data:audio/mp3;base64,' + data.audioBase64);
        audio.play().then(() => console.log("▶️ Playing TTS..."));
      }
    } else {
      console.log("⚠️ Empty transcription (expected for tone test)");
      console.log("   This is normal - Whisper returns empty for non-speech audio");
    }
    
    return data;
  } catch (err) {
    console.error("❌ Test failed:", err);
    throw err;
  }
}

// Run if in browser
if (typeof window !== 'undefined') {
  testEndToEnd().catch(console.error);
}

// Export for Node.js
if (typeof module !== 'undefined') {
  module.exports = { testEndToEnd };
}