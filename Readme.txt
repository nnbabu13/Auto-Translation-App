# Cinema AI Translator - Product Requirements v2

## Objective

Build a real-time movie translation platform capable of translating cinema audio into another language with minimal delay.

Target use cases:

* Censorship screenings
* Film festivals
* Accessibility services
* Foreign language screenings

Target latency:

2-5 seconds.

Target comprehension:

85-90%.

---

## Input Sources

Support:

* Microphone
* Virtual Audio Cable
* Stereo Mix
* USB Audio Interface
* Cinema Processor Feed
* Center Channel Feed

Preferred order:

1. Center Channel
2. Line Feed
3. Virtual Audio Cable
4. Microphone

---

## Audio Processing Pipeline

Audio Input
↓
Dialogue Enhancement
↓
Voice Activity Detection
↓
Utterance Detection
↓
Speech Recognition
↓
Translation
↓
Text To Speech
↓
Playback

---

## Dialogue Enhancement

Implement optional preprocessing:

* RNNoise
* WebRTC Noise Suppression
* Dialogue Isolation Models

Future support:

* Demucs
* SpeechBrain SepFormer
* UVR

Goal:

Remove music and effects before transcription.

---

## Voice Activity Detection

Use:

* Silero VAD
  or
* WebRTC VAD

Detect:

* Speech Start
* Speech End

Ignore:

* Silence
* Music
* Explosions
* Ambient sound

---

## Dynamic Utterance Segmentation

Replace fixed chunks.

Current:

5 second chunking.

New:

Speech starts
↓
Buffer audio
↓
Silence > 700ms
↓
Create utterance

Cinema Mode:

Silence > 1000ms

This prevents sentence fragmentation.

---

## Overlapping Speech Handling

Primary strategy:

* Transcribe dominant speaker only.

Future support:

* Speaker diarization
* Speaker separation

Possible technologies:

* Pyannote
* SpeechBrain
* NVIDIA NeMo

---

## Speech Recognition

Primary model:

Whisper Large-v3

Settings:

* Temperature = 0
* Force source language
* Ignore unclear speech
* Return empty transcript if confidence is low

Future support:

* GPT-4o Transcribe
* Deepgram Nova-3

---

## Translation Engine

Primary model:

GPT-4o

Requirements:

* Preserve names.
* Preserve places.
* Preserve emotional tone.
* Preserve movie terminology.

Use rolling context memory.

Maintain:

* Previous 60 seconds transcript
* Previous translations

---

## Text To Speech

Primary:

GPT-4o Mini TTS

Requirements:

* Natural speech
* Low latency
* Streaming output

Support:

* Male voice
* Female voice

---

## Playback Queue

Never interrupt active playback.

Queue translated speech.

Display:

* Queue length
* Delay
* Estimated wait time

---

## Session Storage

Store:

* Audio
* Transcript
* Translation
* Timestamps
* Metrics

Allow export.

---

## Developer Dashboard

Display:

* RMS
* Peak
* Speech probability
* STT latency
* Translation latency
* TTS latency
* Total latency
* Queue length

---

## Cinema Mode

Enable:

* Longer context windows
* Higher speech threshold
* Better sentence detection
* Accuracy prioritization

---

## Future Improvements

1. Center channel integration.
2. Dialogue extraction.
3. Streaming STT.
4. Local GPU inference.
5. Character dictionary.
6. Multiple listeners.
7. Multiple target languages.
8. Cloud synchronization.

---

## Long-Term Architecture

Cinema Processor Center Channel
↓
Dialogue Isolation
↓
Whisper Large-v3
↓
GPT-4o Translation
↓
GPT-4o Mini TTS
↓
Headphones

This is the recommended long-term production architecture.
