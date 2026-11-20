// Deterministic scenes for the screenshots. `?shot=cover` paints the poster alone, filling the window at exactly
// the screenshot's pixel size, so the picture taken is the app's own drawing of the cover it would export.
// `?shot=editor` leaves the studio chrome up with photos already loaded. window.__shotReady goes true once the
// fonts and the photos are in and two frames have been painted.

import { SIZES, coverGeometry } from './cover.js';
import { panelCount } from './layouts.js';
import { assignPhotosToPanels, loadSamplePhoto, resizePanels } from './photos.js';

const SIZE_IDS = { wide: 'wide', landscape: 'wide', portrait: 'portrait', square: 'square' };
const LAYOUT_IDS = {
  banner: 'banner', hero: 'hero', herostack: 'hero', quad: 'quad',
  triptych: 'triptych', magazine: 'magazine', full: 'full', fullbleed: 'full',
};
const GRADE_IDS = { vice: 'vice', sunset: 'vice', neon: 'neon', heat: 'heat', chrome: 'chrome', golden: 'golden' };

/** Reads a scene out of the query string, falling back to the landscape hero scene. */
export function readShotScene(query) {
  const pick = (table, value, fallback) => table[String(value ?? '').toLowerCase()] ?? fallback;
  return {
    shot: query.get('shot') === 'editor' ? 'editor' : 'cover',
    size: pick(SIZE_IDS, query.get('size'), 'wide'),
    layout: pick(LAYOUT_IDS, query.get('layout'), 'banner'),
    grade: pick(GRADE_IDS, query.get('grade'), 'vice'),
    photos: (query.get('photo') ?? 'boulevard,pier')
      .split(',')
      .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
      .filter(Boolean),
    caption: query.get('caption') ?? 'PINK HEAT',
    tagline: query.get('tagline') ?? '',
    align: ['left', 'center', 'right'].includes(query.get('align')) ? query.get('align') : 'center',
    typeScale: Number(query.get('scale') ?? 100) / 100,
    select: Number(query.get('select') ?? 0),
  };
}

/** Puts a scene into the state: size, layout, grade, lettering, and the sample photos across the panels. */
export async function applyShotScene(state, scene) {
  state.size = SIZES[scene.size];
  state.layout = scene.layout;
  state.grade = scene.grade;
  state.caption = scene.caption;
  state.tagline = scene.tagline;
  state.align = scene.align;
  state.typeScale = Number.isFinite(scene.typeScale) ? Math.min(1, Math.max(0.6, scene.typeScale)) : 1;
  state.selected = -1;
  resizePanels(state, panelCount(scene.layout));
  const ids = [];
  for (const name of scene.photos) ids.push(await loadSamplePhoto(state, name));
  assignPhotosToPanels(state, ids, coverGeometry(state, state.size.w, state.size.h).panels);
  if (scene.shot === 'editor' && scene.select > 0) state.selected = scene.select - 1;
  return state;
}

/** Runs a scene and flags the page as ready for the camera. */
export async function runShot(state, query, hooks) {
  const scene = readShotScene(query);
  document.body.classList.add(scene.shot === 'cover' ? 'shot-cover' : 'shot-editor');
  await applyShotScene(state, scene);
  hooks.syncControls();
  await document.fonts.ready;
  hooks.draw('full');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__shotReady = true;
  }));
  return scene;
}
