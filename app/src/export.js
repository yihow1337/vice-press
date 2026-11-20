// Export. The poster is drawn once more onto a canvas that is already the post size — 1080 x 1080, 1080 x 1350 or
// 1920 x 1080 — and handed to the browser as a PNG download. No server, no upload: toBlob and an object URL.

import { SIZES, drawCover } from './cover.js';

/** Renders the poster onto a fresh canvas at one of the three post sizes. */
export function renderCoverAtSize(state, sizeId) {
  const size = SIZES[sizeId] ?? SIZES.wide;
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  drawCover(canvas, state, { quality: 'full' });
  return canvas;
}

/** A file name made from the caption and the size: vice-press-pink-heat-1920x1080.png. */
export function coverFileName(state, sizeId) {
  const size = SIZES[sizeId] ?? SIZES.wide;
  const slug = String(state.caption).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `vice-press-${slug || 'cover'}-${size.w}x${size.h}.png`;
}

/** Hands a blob to the browser as a download. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** The canvas as a PNG blob. */
export function canvasToPng(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Exports one size and saves it. Resolves with the file name written. */
export async function exportCoverPng(state, sizeId) {
  const blob = await canvasToPng(renderCoverAtSize(state, sizeId));
  const name = coverFileName(state, sizeId);
  downloadBlob(blob, name);
  return name;
}

/** Exports all three post sizes, one after another. */
export async function exportAllSizes(state) {
  const names = [];
  for (const sizeId of ['wide', 'portrait', 'square']) {
    names.push(await exportCoverPng(state, sizeId));
  }
  return names;
}
