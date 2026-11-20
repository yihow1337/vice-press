// VICE PRESS — the gta6-cover-art-01 entry's hand-in program (Node 22, standard library only, no network).
//
// The entry itself is the app/ folder beside this file: plain static files a desktop browser opens offline —
// app/index.html, its ES modules, the two SIL Open Font License faces in app/fonts/ and the sample photos. VICE
// PRESS is a multi-panel poster studio: drop your own photos in, they are dealt out to the panels of a layout
// (banner, hero stack, quad, triptych, magazine, full bleed), a colour grade is run over them, a caption is set in
// huge capitals, and the poster is exported as a PNG at 1080x1080, 1080x1350 or 1920x1080. Nothing leaves the
// machine: the photos are read as object URLs and drawn straight onto a canvas.
//
// This program copies app/ and screenshots/ into the output directory and writes dossier.json — the summary the
// judge reads — using the vendored make.fun library, which is kept byte-identical to the kit.
//
// Try it locally:   node serve.ts            then open http://localhost:8080
// Build the entry:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Retake the shots: node serve.ts --port 8123 &  then  node shoot.ts --port 8123

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps (reference/gate.json). They are not loosened here: text_max_bytes is the size of the
// source text the dossier carries, and the rest make this program refuse what the scorer would refuse — more than
// 4 screenshots or one over 256 KiB, more than 993 files or 48 MiB under app/, or a path over 1,000 bytes.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

/** Copies a directory of the entry into the output directory, making it even when there is nothing to copy. */
function handIn(name: string) {
  const from = join(here, name);
  const to = join(out, name);
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
  return to;
}

/** Counts the files and bytes under a directory, so the caps can be checked before the dossier is written. */
function weigh(directory: string) {
  let files = 0;
  let bytes = 0;
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      files++;
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else bytes += statSync(full).size;
    }
  };
  if (existsSync(directory)) walk(directory);
  return { files, bytes };
}

mkdirSync(out, { recursive: true });
const app = handIn('app');
const screenshots = handIn('screenshots');

const appWeight = weigh(app);
if (appWeight.files > CAPS.app_max_files) throw new Error(`app/ holds ${appWeight.files} entries, over ${CAPS.app_max_files}`);
if (appWeight.bytes > CAPS.app_max_bytes) throw new Error(`app/ is ${appWeight.bytes} bytes, over ${CAPS.app_max_bytes}`);

const shots = existsSync(screenshots) ? readdirSync(screenshots).sort() : [];
if (shots.length > CAPS.screenshots.max) throw new Error(`${shots.length} screenshots, over ${CAPS.screenshots.max}`);
for (const shot of shots) {
  const size = statSync(join(screenshots, shot)).size;
  if (size > CAPS.screenshots.max_bytes) throw new Error(`${shot} is ${size} bytes, over ${CAPS.screenshots.max_bytes}`);
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, CAPS));

console.log(`VICE PRESS handed in to ${out}`);
console.log(`  app/          ${appWeight.files} entries, ${appWeight.bytes} bytes`);
console.log(`  screenshots/  ${shots.join(', ') || 'none'}`);
