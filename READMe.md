# MediaGen — TikTok AI Video Pipeline

Generates a branded 45-second TikTok-ready 1080×1920 vertical video from
a topic string, fully local — no cloud APIs required.

## Stack

| Layer | Tool | Notes |
|---|---|---|
| Script | Ollama (local LLM) | structured 5-beat JSON |
| Voice | Kokoro-ONNX | natural prosody, replaces Piper |
| Captions | whisper-timestamped → ASS | word-level pop highlight |
| Slides | Pillow | branded PNG per beat |
| Music | FFmpeg amix | BGM ducked under voice |
| Assembly | FFmpeg | 4-stage pipeline |

---

## Setup

### 1. Install Python deps (inside venv)

```bash
pip install -r requirements.txt
```

### 2. Kokoro model files

Kokoro auto-downloads on first run.  If your machine has no internet access,
grab the two files manually and drop them in the **project root** (`MediaGen/`):

- `kokoro-v1_0.onnx`
- `voices-v1_0.bin`

Releases: https://github.com/thewh1teagle/kokoro-onnx/releases

### 3. Ollama model

```bash
ollama pull llama3.2        # or whichever you prefer
ollama list                 # confirm the name, then set it in config.yaml
```

### 4. BGM tracks

Drop 2–3 royalty-free MP3 files into `assets/bgm/`.
One is picked at random each run.
Source: https://pixabay.com/music/ (free, no attribution required)

---

## Usage

Run **from the project root** (`MediaGen/`):

```bash
# single topic
python src/main.py "why linux beats windows for developers"

# random topic from data/topics.txt
python src/main.py --random

# process every topic in data/topics.txt
python src/main.py --batch
```

---

## Run output

```
workspace/runs/<run_id>/
  script.json        structured 5-beat script
  beat_0.wav … beat_4.wav   per-beat audio
  voice.wav          full narration
  transcript.json    word timestamps (debug)
  captions.ass       styled ASS subtitle file
  slide_0.png … slide_4.png  branded slides
  concat_slides.txt  ffmpeg concat script (debug)
  slides_silent.mp4  intermediate
  audio_mix.aac      voice + BGM mixed
  muxed.mp4          intermediate
  final.mp4          ← UPLOAD THIS
  thumbnail.jpg      cover image
  report.json        QA report + metadata
```

---

## Configuration (`config.yaml`)

| Key | What it changes |
|---|---|
| `llm.model` | Ollama model name |
| `tts.voice` | Kokoro voice ID (see below) |
| `tts.speed` | Narration speed (1.0 = normal, 1.05 = slightly punchy) |
| `brand.name` | Watermark text bottom-right |
| `slides.bg_color` | Background RGB |
| `slides.accent_colors` | Beat accent colours (one per beat) |
| `video.bgm_volume` | BGM level (0.10 = 10%) |

### Kokoro voices

| ID | Character |
|---|---|
| `af_heart` | American female, warm *(default)* |
| `af_sky`   | American female, bright |
| `am_adam`  | American male |
| `bf_emma`  | British female |
| `bm_daniel`| British male |
MediaGen/
├── assets/
│   ├── bgm/
|   |   └── music_1.mp3, music_2.mp3, music_3.mp3
│   └── fonts/
|       └── Space_Grotest/SpaceGrotesk-VariableFont_wght.ttf
├── config.yaml
├── data/
│   └── topics.txt
├── prompts/
│   └── script.txt
├── READMe.md
├── requirements.txt
├── src/
│   ├── assemble.py
│   ├── captions.py
│   ├── llm.py
│   ├── main.py
│   ├── tts.py
│   ├── utils.py
│   ├── visuals.py
│   └── __pycache__/
├── venv/
└── workspace/
    └── runs/
        ├── 48e46598/
        │   ├── bg.png
        │   ├── script.txt
        │   ├── voice.srt
        │   └── voice.wav
        ├── 5861f31c/
        │   ├── bg.png
        │   ├── script.txt
        │   ├── voice.srt
        │   └── voice.wav
        └── d1889aae/
            ├── bg.png
            ├── final.mp4
            ├── script.txt
            ├── voice.srt
            └── voice.wav