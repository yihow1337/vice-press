// Panel geometry for the poster layouts. Every layout takes the poster's inner frame (the area inside the board
// margin) and the gutter in pixels, and gives back the photo panels to fill, plus an optional type column: a panel
// that holds lettering instead of a photo. Gutters are thick on purpose — this is a printed photo strip, not a CSS
// grid, so the board colour shows between the panels.

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

/** Rounds a rectangle to whole pixels so gutters stay even at every export size. */
function rect(x, y, w, h) {
  const left = Math.round(x);
  const top = Math.round(y);
  return { x: left, y: top, w: Math.round(x + w) - left, h: Math.round(y + h) - top };
}

/** One tall hero panel on the left, two stacked panels on the right. */
export function layoutHeroStack(frame, gutter) {
  const heroWidth = (frame.w - gutter) * 0.62;
  const sideWidth = frame.w - gutter - heroWidth;
  const sideHeight = (frame.h - gutter) / 2;
  const sideX = frame.x + heroWidth + gutter;
  return {
    panels: [
      rect(frame.x, frame.y, heroWidth, frame.h),
      rect(sideX, frame.y, sideWidth, sideHeight),
      rect(sideX, frame.y + sideHeight + gutter, sideWidth, sideHeight),
    ],
    column: null,
  };
}

/** A 2 x 2 grid of equal panels. */
export function layoutQuad(frame, gutter) {
  const cellWidth = (frame.w - gutter) / 2;
  const cellHeight = (frame.h - gutter) / 2;
  const panels = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      panels.push(rect(frame.x + col * (cellWidth + gutter), frame.y + row * (cellHeight + gutter), cellWidth, cellHeight));
    }
  }
  return { panels, column: null };
}

/** Three vertical strips of equal width, full height. */
export function layoutTriptych(frame, gutter) {
  const stripWidth = (frame.w - gutter * 2) / 3;
  const panels = [0, 1, 2].map((i) => rect(frame.x + i * (stripWidth + gutter), frame.y, stripWidth, frame.h));
  return { panels, column: null };
}

/** A wide cinematic panel across the top, two smaller panels under it. Built for 16:9. */
export function layoutBanner(frame, gutter) {
  const bannerHeight = (frame.h - gutter) * 0.62;
  const lowerHeight = frame.h - gutter - bannerHeight;
  const lowerY = frame.y + bannerHeight + gutter;
  const lowerWidth = (frame.w - gutter) / 2;
  return {
    panels: [
      rect(frame.x, frame.y, frame.w, bannerHeight),
      rect(frame.x, lowerY, lowerWidth, lowerHeight),
      rect(frame.x + lowerWidth + gutter, lowerY, lowerWidth, lowerHeight),
    ],
    column: null,
  };
}

/** An editorial type column on the left, two stacked photo panels on the right. Built for 4:5. */
export function layoutMagazine(frame, gutter) {
  const columnWidth = (frame.w - gutter) * 0.4;
  const photoX = frame.x + columnWidth + gutter;
  const photoWidth = frame.w - columnWidth - gutter;
  const upperHeight = (frame.h - gutter) * 0.56;
  return {
    panels: [
      rect(photoX, frame.y, photoWidth, upperHeight),
      rect(photoX, frame.y + upperHeight + gutter, photoWidth, frame.h - upperHeight - gutter),
    ],
    column: rect(frame.x, frame.y, columnWidth, frame.h),
  };
}

/** One photo over the whole frame — still a poster, with the board border and the caption band. */
export function layoutFullBleed(frame) {
  return { panels: [rect(frame.x, frame.y, frame.w, frame.h)], column: null };
}

/** Every layout the studio offers, in the order the left rail shows them. */
export const LAYOUTS = [
  { id: 'banner', name: 'Banner', panels: 3, build: layoutBanner },
  { id: 'hero', name: 'Hero stack', panels: 3, build: layoutHeroStack },
  { id: 'quad', name: 'Quad', panels: 4, build: layoutQuad },
  { id: 'triptych', name: 'Triptych', panels: 3, build: layoutTriptych },
  { id: 'magazine', name: 'Magazine', panels: 2, build: layoutMagazine },
  { id: 'full', name: 'Full bleed', panels: 1, build: layoutFullBleed },
];

/** Looks a layout up by id, falling back to the banner. */
export function findLayout(layoutId) {
  return LAYOUTS.find((layout) => layout.id === layoutId) ?? LAYOUTS[0];
}

/** The panels and type column of `layoutId` inside `frame`. */
export function panelsFor(layoutId, frame, gutter) {
  return findLayout(layoutId).build(frame, gutter);
}

/** How many photo panels a layout has. */
export function panelCount(layoutId) {
  return findLayout(layoutId).panels;
}

/** Paints the little preview icon the left rail shows for a layout, from that layout's own geometry. */
export function drawLayoutIcon(canvas, layoutId, active = false) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const pad = Math.round(w * 0.1);
  const frame = { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 };
  const { panels, column } = panelsFor(layoutId, frame, Math.max(2, Math.round(w * 0.055)));
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = active ? 'rgba(255, 240, 228, 0.95)' : 'rgba(255, 238, 220, 0.42)';
  for (const panel of panels) ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  if (column) {
    ctx.fillStyle = active ? '#ff2d95' : 'rgba(255, 45, 149, 0.7)';
    ctx.fillRect(column.x, column.y, column.w, column.h);
  }
}
