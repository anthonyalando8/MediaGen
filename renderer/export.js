/**
 * export.js  --  Assemble captured frames into final.mp4
 *
 * Usage:
 *   node export.js --manifest frames/manifest.json \
 *                  --voice voice.wav \
 *                  --captions captions.ass \
 *                  --out final.mp4
 *
 * Pipeline:
 *   1. For each beat: concat frames → beat_N.mp4 (with optional Ken Burns)
 *   2. Concat all beat videos → combined.mp4
 *   3. Mix voice + BGM (optional)
 *   4. Mux combined.mp4 + audio
 *   5. Burn ASS captions → final.mp4
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { parseArgs } from 'util';

const { values: args } = parseArgs({
  options: {
    manifest: { type: 'string' },
    voice:    { type: 'string' },
    captions: { type: 'string' },
    bgm:      { type: 'string' },
    bgm_vol:  { type: 'string', default: '0.10' },
    out:      { type: 'string', default: 'final.mp4' },
    fps:      { type: 'string', default: '30' },
    crf:      { type: 'string', default: '22' },
    preset:   { type: 'string', default: 'veryfast' },
  }
});

if (!args.manifest) {
  console.error('Usage: node export.js --manifest frames/manifest.json --voice voice.wav ...');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve(args.manifest), 'utf8'));
const fps     = parseInt(args.fps || manifest.fps || '30', 10);
const outPath = resolve(args.out);
const workDir = dirname(resolve(args.manifest));

function ffmpeg(cmdArgs, label) {
  console.log(`[export] ${label}...`);
  try {
    execFileSync('ffmpeg', ['-y', ...cmdArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`[export] OK ${label}`);
  } catch (e) {
    console.error(`[export] FAILED ${label}`);
    console.error(e.stderr?.toString().slice(-2000));
    throw e;
  }
}

// ── Step 1: Each beat's frames → beat_N.mp4 ─────────────────────────────────
const beatVideos = [];

for (const beat of manifest.beats) {
  const beatMp4 = join(workDir, `beat_${beat.beatIdx}.mp4`);
  beatVideos.push(beatMp4);

  // Input pattern: frames/beat_N/frame_00000.png
  const framePattern = join(beat.dir, 'frame_%05d.png');

  // Ken Burns push-in via zoompan — bakes motion into the beat video
  const w = 1080, h = 1920;
  const duration_frames = beat.frameCount;
  const zoompan = `zoompan=z='min(zoom+0.0012,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration_frames}:s=${w}x${h}:fps=${fps}`;

  ffmpeg([
    '-framerate', String(fps),
    '-i', framePattern,
    '-vf', `scale=${w}:${h},${zoompan}`,
    '-c:v', 'libx264',
    '-preset', args.preset,
    '-crf', args.crf,
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    beatMp4,
  ], `Beat ${beat.beatIdx} → video`);
}

// ── Step 2: Concat beat videos → combined.mp4 ────────────────────────────────
const concatTxt = join(workDir, 'concat_beats.txt');
writeFileSync(concatTxt, beatVideos.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));

const combinedMp4 = join(workDir, 'combined.mp4');
ffmpeg([
  '-f', 'concat', '-safe', '0',
  '-i', concatTxt,
  '-c', 'copy',
  combinedMp4,
], 'Concat beats');

// ── Step 3: Audio mix ─────────────────────────────────────────────────────────
const audioOut = join(workDir, 'audio_mix.aac');

if (args.bgm && args.voice) {
  ffmpeg([
    '-i', resolve(args.voice),
    '-stream_loop', '-1', '-i', resolve(args.bgm),
    '-filter_complex', [
      '[0:a]loudnorm=I=-16:LRA=11:TP=-1.5[voice]',
      `[1:a]volume=${args.bgm_vol},afade=t=in:st=0:d=1,afade=t=out:st=0:d=2[bgm]`,
      '[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[out]',
    ].join(';'),
    '-map', '[out]',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    audioOut,
  ], 'Mix voice + BGM');
} else if (args.voice) {
  ffmpeg([
    '-i', resolve(args.voice),
    '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5',
    '-c:a', 'aac', '-b:a', '192k',
    audioOut,
  ], 'Normalize voice');
}

// ── Step 4: Mux video + audio ─────────────────────────────────────────────────
const muxedMp4 = join(workDir, 'muxed.mp4');
const muxInputs = ['-i', combinedMp4];
if (args.voice) muxInputs.push('-i', audioOut);

ffmpeg([
  ...muxInputs,
  '-map', '0:v:0',
  ...(args.voice ? ['-map', '1:a:0'] : []),
  '-c:v', 'copy',
  '-c:a', 'copy',
  '-shortest',
  muxedMp4,
], 'Mux video + audio');

// ── Step 5: Burn captions ─────────────────────────────────────────────────────
if (args.captions) {
  // Portable path escaping for Windows FFmpeg subtitles filter
  const tmpAss   = join('C:/tmp', 'mg_captions.ass');
  const assPath  = resolve(args.captions);

  // Copy to short temp path (avoids Windows colon/space issues)
  const { copyFileSync, mkdirSync: mkdir } = await import('fs');
  mkdir('C:/tmp', { recursive: true });
  copyFileSync(assPath, tmpAss);

  // Change cwd to drive root so we can use relative path in filter
  const origCwd = process.cwd();
  process.chdir('C:/');

  try {
    ffmpeg([
      '-i', muxedMp4,
      '-vf', `subtitles='tmp/mg_captions.ass'`,
      '-c:v', 'libx264',
      '-preset', args.preset,
      '-crf', args.crf,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      outPath,
    ], 'Burn captions');
  } finally {
    process.chdir(origCwd);
  }
} else {
  // No captions — just copy
  const { copyFileSync } = await import('fs');
  copyFileSync(muxedMp4, outPath);
}

console.log(`\n[export] Done → ${outPath}`);