// Colour grades and the film effects that go over them. A grade is two things: a per-channel curve that bends the
// photo's colour hard (teal shadows, hot pink midtones, gold highlights) and a set of washes — gradients composited
// over the art with overlay/screen — that put the sunset back into the picture. The effects after it (grain,
// vignette, edge aberration, light leak) are shared by every grade and are kept light so the photo still reads.

/** Builds a 256-entry lookup table from piecewise-linear control points. */
function curveTable(points) {
  const table = new Uint8ClampedArray(256);
  let segment = 0;
  for (let i = 0; i < 256; i++) {
    while (segment < points.length - 2 && i > points[segment + 1][0]) segment++;
    const [x0, y0] = points[segment];
    const [x1, y1] = points[segment + 1];
    const t = x1 === x0 ? 0 : (i - x0) / (x1 - x0);
    table[i] = y0 + (y1 - y0) * t;
  }
  return table;
}

const tableCache = new Map();

/** Caches the three channel tables of a grade, so a redraw does not rebuild them. */
function channelTables(id, curves) {
  let tables = tableCache.get(id);
  if (!tables) {
    tables = { r: curveTable(curves.r), g: curveTable(curves.g), b: curveTable(curves.b) };
    tableCache.set(id, tables);
  }
  return tables;
}

/**
 * Pushes every opaque pixel through the grade's channel curves, then its saturation and contrast.
 * Transparent pixels (the gutters between panels) are left alone.
 */
export function applyColorCurves(ctx, w, h, id, curves, saturation, contrast) {
  const { r: tr, g: tg, b: tb } = channelTables(id, curves);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = tr[data[i]];
    let g = tg[data[i + 1]];
    let b = tb[data[i + 2]];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + (r - luma) * saturation;
    g = luma + (g - luma) * saturation;
    b = luma + (b - luma) * saturation;
    data[i] = (r - 128) * contrast + 128;
    data[i + 1] = (g - 128) * contrast + 128;
    data[i + 2] = (b - 128) * contrast + 128;
  }
  ctx.putImageData(image, 0, 0);
}

/** Reads a colour out of a stop list at `t` (0..1), mixing the two stops either side of it. */
function sampleStops(stops, t) {
  let index = 0;
  while (index < stops.length - 2 && t > stops[index + 1][0]) index++;
  const [x0, c0] = stops[index];
  const [x1, c1] = stops[index + 1];
  const k = x1 === x0 ? 0 : (t - x0) / (x1 - x0);
  const a = parseInt(c0.slice(1), 16);
  const b = parseInt(c1.slice(1), 16);
  return [
    ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k,
    ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k,
    (a & 255) + ((b & 255) - (a & 255)) * k,
  ];
}

const toneCache = new Map();

/** A 256-step tone map: for each level of brightness, the colour that level should take, at that brightness. */
function toneMap(id, stops) {
  let map = toneCache.get(id);
  if (map) return map;
  map = new Float32Array(256 * 3);
  for (let level = 0; level < 256; level++) {
    const [r, g, b] = sampleStops(stops, level / 255);
    const tintLuma = Math.max(1, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    const scale = level / tintLuma;
    map[level * 3] = r * scale;
    map[level * 3 + 1] = g * scale;
    map[level * 3 + 2] = b * scale;
  }
  toneCache.set(id, map);
  return map;
}

/**
 * Split tones the art: every pixel is pulled towards the colour its own brightness is given by the grade's
 * palette — teal in the shadows, hot pink through the middle, gold in the highlights — and kept at the brightness
 * it already had, so faces stay faces instead of going flat under a filter.
 */
export function applySplitTone(ctx, w, h, id, stops, amount) {
  const map = toneMap(id, stops);
  const keep = 1 - amount;
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const level = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
    const at = level * 3;
    data[i] = r * keep + map[at] * amount;
    data[i + 1] = g * keep + map[at + 1] * amount;
    data[i + 2] = b * keep + map[at + 2] * amount;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * A linear gradient wash across the art, composited in `mode` at `alpha`. With mode 'color' this is the grade's
 * main move: the photo keeps its own light and shade while its hue and saturation are pulled onto the gradient —
 * teal at the top, hot pink through the middle, gold at the foot.
 */
export function washLinear(ctx, w, h, mode, from, to, stops, alpha = 1) {
  const gradient = ctx.createLinearGradient(from[0] * w, from[1] * h, to[0] * w, to[1] * h);
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** A radial wash — a sun, a neon spill, a corner light — composited in `mode`. */
export function washRadial(ctx, w, h, mode, cx, cy, radius, stops) {
  const long = Math.max(w, h);
  const gradient = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, radius * long);
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Default. Teal shadows, hot pink and tangerine midtones, gold highlights, a sunset rising from the bottom. */
export function gradeViceSunset(ctx, w, h) {
  applyColorCurves(ctx, w, h, 'vice', {
    r: [[0, 6], [60, 78], [128, 178], [200, 242], [255, 255]],
    g: [[0, 8], [60, 46], [128, 112], [200, 190], [255, 242]],
    b: [[0, 32], [60, 72], [128, 108], [200, 148], [255, 198]],
  }, 1.4, 1.24);
  applySplitTone(ctx, w, h, 'vice', [
    [0, '#07394f'],
    [0.3, '#6d2585'],
    [0.56, '#ff4878'],
    [0.8, '#ff9b36'],
    [1, '#ffeab4'],
  ], 0.3);
  washLinear(ctx, w, h, 'overlay', [0, 0], [0, 1], [
    [0, 'rgba(0, 160, 190, 0.3)'],
    [0.45, 'rgba(255, 70, 160, 0.1)'],
    [1, 'rgba(255, 110, 24, 0.38)'],
  ]);
  washRadial(ctx, w, h, 'screen', 0.76, 0.86, 0.68, [
    [0, 'rgba(255, 140, 55, 0.22)'],
    [0.55, 'rgba(255, 60, 140, 0.1)'],
    [1, 'rgba(255, 60, 140, 0)'],
  ]);
}

/** Deep purple and indigo, magenta and cyan neon on the edges, crushed blacks. */
export function gradeNeonNight(ctx, w, h) {
  applyColorCurves(ctx, w, h, 'neon', {
    r: [[0, 4], [48, 34], [128, 126], [200, 208], [255, 252]],
    g: [[0, 2], [48, 24], [128, 96], [200, 176], [255, 238]],
    b: [[0, 36], [48, 90], [128, 170], [200, 222], [255, 255]],
  }, 1.3, 1.22);
  applySplitTone(ctx, w, h, 'neon', [
    [0, '#0d0730'],
    [0.3, '#4a16a0'],
    [0.58, '#ff2bd0'],
    [0.84, '#4fe4ff'],
    [1, '#eaf7ff'],
  ], 0.38);
  washLinear(ctx, w, h, 'overlay', [0, 0], [1, 1], [
    [0, 'rgba(255, 43, 208, 0.34)'],
    [0.5, 'rgba(70, 10, 120, 0.22)'],
    [1, 'rgba(49, 231, 255, 0.34)'],
  ]);
  washRadial(ctx, w, h, 'screen', 0.5, 1.02, 0.62, [
    [0, 'rgba(255, 43, 208, 0.30)'],
    [1, 'rgba(255, 43, 208, 0)'],
  ]);
}

/** Red-orange combustion with magenta in the shadows. */
export function gradeHeatWave(ctx, w, h) {
  applyColorCurves(ctx, w, h, 'heat', {
    r: [[0, 32], [64, 116], [128, 198], [200, 246], [255, 255]],
    g: [[0, 10], [64, 50], [128, 110], [200, 180], [255, 236]],
    b: [[0, 40], [64, 60], [128, 84], [200, 122], [255, 188]],
  }, 1.22, 1.16);
  applySplitTone(ctx, w, h, 'heat', [
    [0, '#360820'],
    [0.34, '#a3122f'],
    [0.64, '#ff4a16'],
    [0.88, '#ffb53c'],
    [1, '#fff0c6'],
  ], 0.34);
  washLinear(ctx, w, h, 'overlay', [0, 1], [0, 0], [
    [0, 'rgba(255, 60, 30, 0.42)'],
    [0.6, 'rgba(255, 150, 40, 0.18)'],
    [1, 'rgba(180, 30, 110, 0.26)'],
  ]);
}

/** Cold teal and steel with a pink accent light from one side. */
export function gradeChromeTeal(ctx, w, h) {
  applyColorCurves(ctx, w, h, 'chrome', {
    r: [[0, 8], [64, 54], [128, 112], [200, 186], [255, 244]],
    g: [[0, 24], [64, 78], [128, 142], [200, 208], [255, 252]],
    b: [[0, 38], [64, 96], [128, 154], [200, 216], [255, 255]],
  }, 1.1, 1.2);
  applySplitTone(ctx, w, h, 'chrome', [
    [0, '#061a26'],
    [0.34, '#135a70'],
    [0.64, '#49bcc6'],
    [0.86, '#ff86b8'],
    [1, '#f4fcff'],
  ], 0.32);
  washLinear(ctx, w, h, 'overlay', [0, 0], [0, 1], [
    [0, 'rgba(30, 90, 120, 0.30)'],
    [1, 'rgba(10, 40, 70, 0.34)'],
  ]);
  washRadial(ctx, w, h, 'screen', 0.08, 0.2, 0.6, [
    [0, 'rgba(255, 95, 168, 0.32)'],
    [1, 'rgba(255, 95, 168, 0)'],
  ]);
}

/** Warm film gold with a soft, lifted fade in the shadows. */
export function gradeGoldenHour(ctx, w, h) {
  applyColorCurves(ctx, w, h, 'golden', {
    r: [[0, 42], [64, 110], [128, 182], [200, 232], [255, 252]],
    g: [[0, 34], [64, 90], [128, 156], [200, 212], [255, 244]],
    b: [[0, 50], [64, 84], [128, 120], [200, 168], [255, 214]],
  }, 1.12, 1.02);
  applySplitTone(ctx, w, h, 'golden', [
    [0, '#2b1708'],
    [0.34, '#8d5020'],
    [0.66, '#e59c40'],
    [0.88, '#ffd78e'],
    [1, '#fff4da'],
  ], 0.32);
  washLinear(ctx, w, h, 'overlay', [0, 0], [0, 1], [
    [0, 'rgba(255, 214, 140, 0.26)'],
    [1, 'rgba(190, 110, 50, 0.3)'],
  ]);
}

/** The grades the left rail lists, with the board colours and accents the poster chrome borrows from each. */
export const GRADES = [
  {
    id: 'vice', name: 'Vice Sunset', apply: gradeViceSunset, leak: true,
    swatch: 'linear-gradient(120deg, #0fb6c8, #ff2d95 52%, #ffa43c)',
    theme: { board: ['#f8ede1', '#e8d4bd'], ink: '#160d1b', accent: '#ff2d95', accent2: '#14d8d2', shadow: '#2a0520' },
  },
  {
    id: 'neon', name: 'Neon Night', apply: gradeNeonNight, leak: false,
    swatch: 'linear-gradient(120deg, #2b0a50, #ff2bd0 55%, #31e7ff)',
    theme: { board: ['#efe6f5', '#d5c8e6'], ink: '#120a22', accent: '#ff2bd0', accent2: '#31e7ff', shadow: '#15032c' },
  },
  {
    id: 'heat', name: 'Heat Wave', apply: gradeHeatWave, leak: true,
    swatch: 'linear-gradient(120deg, #7a0d48, #ff3a1f 55%, #ffb03a)',
    theme: { board: ['#f9e9d6', '#ebcbae'], ink: '#1d0a0a', accent: '#ff2a4d', accent2: '#ffbf3c', shadow: '#2b0608' },
  },
  {
    id: 'chrome', name: 'Chrome Teal', apply: gradeChromeTeal, leak: false,
    swatch: 'linear-gradient(120deg, #0b2a38, #2f9fb5 55%, #ff5fa8)',
    theme: { board: ['#eaeff2', '#ccd8de'], ink: '#09161c', accent: '#ff5fa8', accent2: '#4ff0e0', shadow: '#04161e' },
  },
  {
    id: 'golden', name: 'Golden Hour', apply: gradeGoldenHour, leak: true,
    swatch: 'linear-gradient(120deg, #5e3a12, #e9a03a 55%, #ffe3ad)',
    theme: { board: ['#faf0dd', '#eed9b6'], ink: '#1d1408', accent: '#ff7a3c', accent2: '#ffd27a', shadow: '#2a1604' },
  },
];

/** Looks a grade up by id, falling back to the sunset. */
export function findGrade(gradeId) {
  return GRADES.find((grade) => grade.id === gradeId) ?? GRADES[0];
}

/** The board colours and accents the poster chrome uses under a grade. */
export function gradeTheme(gradeId) {
  return findGrade(gradeId).theme;
}

/** Runs a grade over the art layer, clipped to the photo panels so the gutters stay the board's colour. */
export function applyGrade(ctx, w, h, gradeId, panels) {
  const grade = findGrade(gradeId);
  ctx.save();
  ctx.beginPath();
  for (const panel of panels) ctx.rect(panel.x, panel.y, panel.w, panel.h);
  ctx.clip();
  grade.apply(ctx, w, h);
  ctx.restore();
}

let grainTile = null;

/** Builds the 128 x 128 noise tile the grain is stamped from, once per page. */
function filmGrainTile() {
  if (grainTile) return grainTile;
  const size = 128;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = 128 + (Math.random() - 0.5) * 150;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  grainTile = tile;
  return tile;
}

/** Modest procedural film grain over the whole poster. */
export function applyFilmGrain(ctx, w, h, strength = 0.09) {
  const pattern = ctx.createPattern(filmGrainTile(), 'repeat');
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = strength;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** A soft vignette that pulls the corners down. */
export function applyVignette(ctx, w, h, strength = 0.34) {
  const long = Math.max(w, h);
  const gradient = ctx.createRadialGradient(w / 2, h * 0.46, long * 0.16, w / 2, h / 2, long * 0.78);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(0.68, `rgba(12, 4, 16, ${strength * 0.28})`);
  gradient.addColorStop(1, `rgba(10, 2, 14, ${strength})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Very slight chromatic aberration, and only in the outer ring — red pushed out, blue pulled in. */
export function applyChromaticEdges(ctx, w, h, strength = 0.0032) {
  const image = ctx.getImageData(0, 0, w, h);
  const source = new Uint8ClampedArray(image.data);
  const data = image.data;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.hypot(cx, cy);
  const shift = Math.max(w, h) * strength;
  const start = 0.62;
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / maxRadius;
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / maxRadius;
      const radius = Math.hypot(dx, dy);
      if (radius < start) continue;
      const weight = Math.min(1, (radius - start) / (1 - start)) ** 2;
      const offset = shift * weight;
      const nx = dx / (radius || 1);
      const ny = dy / (radius || 1);
      const i = (y * w + x) * 4;
      if (source[i + 3] === 0) continue;
      const rx = Math.min(w - 1, Math.max(0, Math.round(x + nx * offset)));
      const ry = Math.min(h - 1, Math.max(0, Math.round(y + ny * offset)));
      const bx = Math.min(w - 1, Math.max(0, Math.round(x - nx * offset)));
      const by = Math.min(h - 1, Math.max(0, Math.round(y - ny * offset)));
      const red = (ry * w + rx) * 4;
      const blue = (by * w + bx) * 4;
      if (source[red + 3] !== 0) data[i] = source[red];
      if (source[blue + 3] !== 0) data[i + 2] = source[blue + 2];
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** A light leak / sun flare in one corner, for the warm grades. */
export function applyLightLeak(ctx, w, h, corner = 'top-right') {
  const cx = corner === 'top-left' ? 0.04 : 0.96;
  washRadial(ctx, w, h, 'screen', cx, 0.04, 0.46, [
    [0, 'rgba(255, 210, 150, 0.3)'],
    [0.35, 'rgba(255, 120, 70, 0.14)'],
    [1, 'rgba(255, 90, 60, 0)'],
  ]);
}
