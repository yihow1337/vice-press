// drawCover paints a whole poster at the canvas's own pixel size: the board, the photo panels with their colour
// grade, the sunset scrim, the lettering, the film effects and the printed edge. The on-screen preview and the
// exported PNG call this same function — the export is only a bigger canvas.

import { panelsFor } from './layouts.js';
import {
  applyChromaticEdges, applyFilmGrain, applyGrade, applyLightLeak, applyVignette, findGrade, gradeTheme,
} from './grade.js';
import { drawPanelPhoto } from './photos.js';
import { CONDENSED_FACE, drawCaption, drawStudioMark, drawTagline } from './type.js';

/** The three post sizes the studio exports. */
export const SIZES = {
  square: { id: 'square', w: 1080, h: 1080, label: '1:1', name: 'Square 1080 x 1080' },
  portrait: { id: 'portrait', w: 1080, h: 1350, label: '4:5', name: 'Portrait 1080 x 1350' },
  wide: { id: 'wide', w: 1920, h: 1080, label: '16:9', name: 'Wide 1920 x 1080' },
};

/** Turns a hex colour into an rgba() string at `alpha`. */
function rgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

const scratch = new Map();

/** A cleared offscreen canvas of this size, reused between redraws so typing does not churn memory. */
function scratchCanvas(w, h) {
  const key = `${w}x${h}`;
  let canvas = scratch.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    if (scratch.size > 3) scratch.clear();
    scratch.set(key, canvas);
  }
  canvas.getContext('2d').clearRect(0, 0, w, h);
  return canvas;
}

/**
 * The poster's geometry at a given pixel size: the board margin, the gutter (2.6% of the short side), the inner
 * frame, the panels and the type column. The editor uses it for hit testing, drawCover for painting.
 */
export function coverGeometry(state, w, h) {
  const short = Math.min(w, h);
  const margin = Math.round(short * 0.036);
  const gutter = Math.round(short * 0.026);
  const frame = { x: margin, y: margin, w: w - margin * 2, h: h - margin * 2 };
  const { panels, column } = panelsFor(state.layout, frame, gutter);
  return { short, margin, gutter, frame, panels, column };
}

/** The box the caption is fitted into: the band across the foot, or the type column of the magazine layout. */
export function captionBand(geometry, w, h) {
  const { frame, column, short } = geometry;
  const pad = Math.round(short * 0.038);
  if (column) {
    const inset = Math.round(short * 0.03);
    return { x: column.x + inset, y: column.y + column.h * 0.5, w: column.w - inset * 2, h: column.h * 0.42, inColumn: true };
  }
  const share = w > h ? 0.29 : w === h ? 0.26 : 0.225;
  const height = frame.h * share;
  return { x: frame.x + pad, y: frame.y + frame.h - height, w: frame.w - pad * 2, h: height - pad, inColumn: false };
}

/** The board the poster is printed on: a warm off-white sheet with a soft tone from top to bottom. */
export function paintBoard(ctx, w, h, theme) {
  const sheet = ctx.createLinearGradient(0, 0, w * 0.35, h);
  sheet.addColorStop(0, theme.board[0]);
  sheet.addColorStop(1, theme.board[1]);
  ctx.fillStyle = sheet;
  ctx.fillRect(0, 0, w, h);
}

/**
 * The art layer: every panel's photo drawn into its rectangle, then the grade, the light leak and the edge
 * aberration over the panels only. The gutters stay transparent so the board shows through them.
 */
export function paintArtLayer(state, geometry, w, h, quality) {
  const layer = scratchCanvas(w, h);
  const ctx = layer.getContext('2d');
  const grade = findGrade(state.grade);
  geometry.panels.forEach((rect, index) => {
    const panel = state.panels[index] ?? { photoId: null, panX: 0, panY: 0, zoom: 1, mode: 'fill' };
    drawPanelPhoto(ctx, rect, state.photos[panel.photoId] ?? null, panel);
  });
  applyGrade(ctx, w, h, state.grade, geometry.panels);
  if (grade.leak) {
    ctx.save();
    ctx.beginPath();
    for (const rect of geometry.panels) ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    applyLightLeak(ctx, w, h, 'top-right');
    ctx.restore();
  }
  if (quality === 'full') applyChromaticEdges(ctx, w, h);
  return layer;
}

/** The sunset scrim that rises into the caption band, so white lettering holds over any photo. */
export function paintCaptionScrim(ctx, geometry, band, theme) {
  const { frame } = geometry;
  const top = Math.max(frame.y, band.y - band.h * 0.7);
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.x, top, frame.w, frame.y + frame.h - top);
  ctx.clip();
  const scrim = ctx.createLinearGradient(0, top, 0, frame.y + frame.h);
  scrim.addColorStop(0, rgba(theme.shadow, 0));
  scrim.addColorStop(0.45, rgba(theme.shadow, 0.42));
  scrim.addColorStop(1, rgba(theme.shadow, 0.9));
  ctx.fillStyle = scrim;
  ctx.fillRect(frame.x, top, frame.w, frame.y + frame.h - top);
  ctx.globalCompositeOperation = 'overlay';
  const heat = ctx.createLinearGradient(0, top, 0, frame.y + frame.h);
  heat.addColorStop(0, rgba(theme.accent, 0));
  heat.addColorStop(1, rgba(theme.accent, 0.3));
  ctx.fillStyle = heat;
  ctx.fillRect(frame.x, top, frame.w, frame.y + frame.h - top);
  ctx.restore();
}

/** The magazine layout's type column: a printed block of colour that the caption is set into. */
export function paintTypeColumn(ctx, column, theme, short) {
  const block = ctx.createLinearGradient(column.x, column.y, column.x + column.w, column.y + column.h);
  block.addColorStop(0, theme.accent);
  block.addColorStop(0.45, '#6d0f5c');
  block.addColorStop(1, '#0d2733');
  ctx.save();
  ctx.fillStyle = block;
  ctx.fillRect(column.x, column.y, column.w, column.h);
  ctx.globalCompositeOperation = 'overlay';
  const sheen = ctx.createLinearGradient(column.x, column.y + column.h, column.x + column.w, column.y);
  sheen.addColorStop(0, rgba(theme.accent2, 0.35));
  sheen.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = sheen;
  ctx.fillRect(column.x, column.y, column.w, column.h);
  ctx.restore();

  const pad = short * 0.03;
  const step = short * 0.026;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 244, 230, 0.14)';
  for (let y = column.y + column.h * 0.16; y < column.y + column.h * 0.38; y += step) {
    for (let x = column.x + pad; x < column.x + column.w - pad; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, short * 0.0022), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const rule = column.y + column.h * 0.42;
  ctx.strokeStyle = 'rgba(255, 244, 230, 0.6)';
  ctx.lineWidth = Math.max(1, short * 0.0026);
  ctx.beginPath();
  ctx.moveTo(column.x + pad, rule);
  ctx.lineTo(column.x + column.w - pad, rule);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, short * 0.006);
  ctx.strokeStyle = 'rgba(255, 244, 230, 0.45)';
  ctx.beginPath();
  for (let tick = 0; tick < 5; tick++) {
    const x = column.x + pad + tick * step;
    ctx.moveTo(x, rule + short * 0.022);
    ctx.lineTo(x, rule + short * 0.05);
  }
  ctx.stroke();
  ctx.restore();
}

/** The printed edge: a hairline rule in the board margin, corner ticks and the size, set small. */
export function paintPosterEdge(ctx, geometry, w, h, theme) {
  const { margin, short } = geometry;
  const inset = margin * 0.44;
  ctx.save();
  ctx.strokeStyle = rgba(theme.ink, 0.26);
  ctx.lineWidth = Math.max(1, short * 0.0022);
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  const tick = short * 0.028;
  ctx.strokeStyle = rgba(theme.ink, 0.5);
  ctx.lineWidth = Math.max(1, short * 0.003);
  ctx.beginPath();
  for (const [cx, sx] of [[inset, 1], [w - inset, -1]]) {
    for (const [cy, sy] of [[inset, 1], [h - inset, -1]]) {
      ctx.moveTo(cx + sx * tick, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * tick);
    }
  }
  ctx.stroke();
  ctx.font = `600 ${Math.round(short * 0.0145)}px "${CONDENSED_FACE}", sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${short * 0.0038}px`;
  ctx.fillStyle = rgba(theme.ink, 0.5);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${w} × ${h}`, w - inset - tick * 1.2, h - margin * 0.5);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

/** Paints the finished poster onto `canvas`, at whatever pixel size the canvas already has. */
export function drawCover(canvas, state, options = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const quality = options.quality ?? 'full';
  const theme = gradeTheme(state.grade);
  const geometry = coverGeometry(state, w, h);
  const band = captionBand(geometry, w, h);

  paintBoard(ctx, w, h, theme);
  ctx.drawImage(paintArtLayer(state, geometry, w, h, quality), 0, 0);
  if (geometry.column) paintTypeColumn(ctx, geometry.column, theme, geometry.short);
  if (!band.inColumn) paintCaptionScrim(ctx, geometry, band, theme);

  const markSize = geometry.short * 0.021;
  if (band.inColumn) {
    drawStudioMark(ctx, geometry.column.x + geometry.short * 0.038, geometry.column.y + geometry.short * 0.05, markSize, theme);
  } else {
    drawStudioMark(ctx, geometry.frame.x + geometry.short * 0.032, geometry.frame.y + geometry.short * 0.042, markSize, theme);
  }

  const taglineHeight = state.tagline.trim() ? band.h * (band.inColumn ? 0.14 : 0.26) : 0;
  const align = band.inColumn ? 'left' : state.align;
  if (taglineHeight) {
    const taglineBox = band.inColumn
      ? { x: band.x, y: band.y + band.h + geometry.short * 0.028, w: band.w, h: taglineHeight * 0.62 }
      : { x: band.x, y: band.y, w: band.w, h: taglineHeight * 0.62 };
    drawTagline(ctx, state.tagline, taglineBox, { align, theme });
  }
  const captionBox = band.inColumn
    ? band
    : { x: band.x, y: band.y + taglineHeight, w: band.w, h: band.h - taglineHeight };
  drawCaption(ctx, state.caption, captionBox, {
    align,
    theme,
    scale: state.typeScale,
    maxLines: band.inColumn ? 3 : 2,
    anchor: band.inColumn ? 'bottom' : 'middle',
  });

  paintPosterEdge(ctx, geometry, w, h, theme);
  applyFilmGrain(ctx, w, h, quality === 'full' ? 0.1 : 0.06);
  ctx.save();
  ctx.beginPath();
  ctx.rect(geometry.frame.x, geometry.frame.y, geometry.frame.w, geometry.frame.h);
  ctx.clip();
  applyVignette(ctx, w, h);
  ctx.restore();
  return geometry;
}
