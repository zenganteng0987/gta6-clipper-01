// gta6-clipper-01 entry point (Node 22, standard library only).
//
// This program renders the vertical GTA 6 clip (30 s, 1080x1920) from the
// official launch trailer and hands VIDEO.json to the grader.
//
// Clip layout (canvas 1080x1920, 9:16):
//   - Montage, 0-20 s: five trailer moments. Each shot is shown twice at
//     once: a blurred, darkened full-frame background that fills the 9:16
//     canvas, and the same footage center-cropped to 4:3 (2880x2160 from
//     the 3840x2160 source, no upscale) scaled to 1080x810 and placed at
//     y=555, leaving 555 px of empty space above and below for text.
//     A two-line hook sits in the top space for the whole montage.
//   - Pitch, 20-30 s: the same three pitch lines as the v1 clip, over a
//     blurred full-frame background only (no foreground video).
//   - Audio: the trailer audio of the montage cuts (short fades at the
//     cuts, longer fade-out into the pitch); the pitch itself is silent.
//
// Moments (trailer time, surveyed from the trailer frames):
//   24.5-28.5  Vice City skyline at sunset (logo dissolves into it)
//   18.5-21.5  green lowrider
//   47.0-52.0  street chase into the motorcycle stunt (jump + flight)
//   54.8-58.8  biplane with pink smoke over the beach
//   77.0-81.0  GTA VI logo
//
// Environment:
//   MAKEFUN_BOT_DIR     repository root (default "/bot")
//   MAKEFUN_OUTPUT_DIR  directory the house reads (default "/output")
//   TRAILER_PATH        launch trailer (default ../work/gta6-launch-trailer.mp4
//                       relative to the repository root)
//   CLIP_OUTPUT         rendered clip (default ../clip-final.mp4 relative
//                       to the repository root)
//   FONT_PATH           bold font for on-screen text (default DejaVu Sans Bold)
//
// If the trailer is not present (for example in the grading harness, where
// only the repository is mounted), rendering is skipped with a warning and
// VIDEO.json is still copied, so the entry point never fails on that.
// If the trailer IS present and rendering fails, the program exits non-zero.
//
// Local run:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const botDir = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const trailerPath =
  process.env.TRAILER_PATH ?? resolve(join(botDir, '..', 'work', 'gta6-launch-trailer.mp4'));
const clipPath =
  process.env.CLIP_OUTPUT ?? resolve(join(botDir, '..', 'clip-final.mp4'));
const fontPath =
  process.env.FONT_PATH ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// Canvas geometry (all px).
const W = 1080;
const H = 1920;
const FG_H = 810; // 1080x810 foreground (4:3 crop scaled)
const FG_Y = 555; // (1920 - 810) / 2
const CRF = 20;

// Montage segments: trailer start/end in seconds, in clip order.
const MONTAGE = [
  { start: 24.5, end: 28.5, label: 'skyline sunset' },
  { start: 18.5, end: 21.5, label: 'green lowrider' },
  { start: 47.0, end: 52.0, label: 'motorcycle stunt' },
  { start: 54.8, end: 58.8, label: 'biplane pink smoke' },
  { start: 77.0, end: 81.0, label: 'GTA VI logo' },
];
// Pitch background: blurred trailer footage behind the pitch lines.
const PITCH = { start: 79.17, end: 89.17 };

const HOOK_LINES = [
  { text: 'WELCOME BACK', size: 85, y: 165 },
  { text: 'TO VICE CITY', size: 85, y: 280 },
];
const PITCH_LINES = [
  { text: 'Make clips like this with AI', size: 62, y: 810 },
  { text: 'and earn money on make.fun', size: 62, y: 915 },
  { text: 'make.fun/bounty/gta6-clipper-01', size: 50, y: 1020 },
];

function drawtext(line: { text: string; size: number; y: number }): string {
  // Thicker outline (borderw 3, up from 2) plus a soft drop shadow so the
  // white letters stay crisp over bright footage (e.g. the sunset skyline);
  // at 1080x1920 the old 2 px outline was barely visible.
  return (
    `drawtext=fontfile=${fontPath}:fontsize=${line.size}:text='${line.text}'` +
    `:x=(w-text_w)/2:y=${line.y}:fontcolor=white:borderw=3:bordercolor=black` +
    `:shadowcolor=black@0.7:shadowx=4:shadowy=4` +
    `:box=1:boxcolor=black@0.45:boxborderw=15`
  );
}

// Blurred full-frame background, built at low resolution (blur hides the
// upscale) and scaled back up to the 1080p canvas.
function bgChain(brightness: string): string {
  return (
    `scale=540:960:force_original_aspect_ratio=increase,crop=540:960,` +
    `gblur=sigma=25,eq=brightness=${brightness},scale=${W}:${H},setsar=1`
  );
}

function buildFilterGraph(): string {
  const parts: string[] = [];

  MONTAGE.forEach((seg, i) => {
    const dur = seg.end - seg.start;
    const fadeOut = i === MONTAGE.length - 1 ? 0.8 : 0.15;
    // Video: one blurred background + one 4:3 foreground, composited.
    parts.push(
      `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS,split=2[s${i}bg][s${i}fg]`,
    );
    parts.push(`[s${i}bg]${bgChain('-0.3')}[s${i}b]`);
    parts.push(`[s${i}fg]crop=2880:2160,scale=${W}:${FG_H},setsar=1[s${i}f]`);
    const hook = HOOK_LINES.map(drawtext).join(',');
    parts.push(`[s${i}b][s${i}f]overlay=0:${FG_Y},${hook}[s${i}]`);
    // Audio: trailer audio of this cut, short fades at the joins.
    parts.push(
      `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=0.15,afade=t=out:st=${dur - fadeOut}:d=${fadeOut}[a${i}]`,
    );
  });

  // Pitch: blurred background only, pitch lines centred on the canvas.
  const pitchText = PITCH_LINES.map(drawtext).join(',');
  parts.push(
    `[0:v]trim=start=${PITCH.start}:end=${PITCH.end},setpts=PTS-STARTPTS,` +
      `${bgChain('-0.35')},${pitchText}[s${MONTAGE.length}]`,
  );
  // Pitch audio: 10 s of silence.
  parts.push(
    `anullsrc=r=48000:cl=stereo,atrim=0:10,asetpts=PTS-STARTPTS[a${MONTAGE.length}]`,
  );

  const vInputs = MONTAGE.map((_, i) => `[s${i}]`).join('') + `[s${MONTAGE.length}]`;
  const aInputs = MONTAGE.map((_, i) => `[a${i}]`).join('') + `[a${MONTAGE.length}]`;
  parts.push(`${vInputs}concat=n=6:v=1:a=0[vout]`);
  parts.push(`${aInputs}concat=n=6:v=0:a=1[aout]`);

  return parts.join(';\n');
}

function renderClip(): void {
  if (!existsSync(trailerPath)) {
    console.warn(`Trailer not found at ${trailerPath}; skipping render.`);
    return;
  }
  if (!existsSync(fontPath)) {
    console.error(`Font not found at ${fontPath}`);
    process.exit(1);
  }

  const total = MONTAGE.reduce((sum, seg) => sum + (seg.end - seg.start), 0) + 10;
  console.log(
    `Rendering ${total}s clip from ${trailerPath} (CRF ${CRF}, ${W}x${H}) ...`,
  );
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      trailerPath,
      '-filter_complex',
      buildFilterGraph(),
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-level',
      '4.2',
      '-crf',
      String(CRF),
      '-preset',
      'medium',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      clipPath,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) {
    console.error(`Could not run ffmpeg: ${(result.error as Error).message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`ffmpeg failed with exit code ${result.status}`);
    process.exit(1);
  }
  console.log(`Clip rendered to ${clipPath} (${statSync(clipPath).size} bytes)`);
}

renderClip();

// Hand VIDEO.json over to the grader, as before.
const source = resolve(join(botDir, 'VIDEO.json'));
const target = resolve(join(outputDir, 'VIDEO.json'));

if (!existsSync(source)) {
  console.error(`VIDEO.json not found in ${botDir} (looked for ${source})`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

try {
  copyFileSync(source, target);
} catch (error) {
  console.error(`Could not copy VIDEO.json to ${target}: ${(error as Error).message}`);
  process.exit(1);
}

console.log(`VIDEO.json copied to ${target} (${statSync(target).size} bytes)`);
