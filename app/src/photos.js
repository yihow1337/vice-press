// The person's photos: loading them from a file picker or a drop, handing them out to the panels, and the
// pan / zoom crop each panel keeps. Nothing is uploaded anywhere — a photo becomes an object URL in this tab and
// is drawn straight onto the canvas.

/** Where an automatically framed panel centres the photo, as a share of its height: a little above the middle,
 *  which is where faces and horizons live. */
const AUTO_FOCUS_Y = 0.3;

/** A fresh panel: no photo yet, filling its rectangle, framed automatically until the person drags it. */
export function newPanel() {
  return { photoId: null, panX: 0, panY: 0, zoom: 1, mode: 'fill', auto: true };
}

/** Crops for the second, third and fourth time a photo is used, so a repeated photo is never the same picture. */
const VARIED_CROPS = [
  { zoom: 1, panX: 0 },
  { zoom: 1.78, panX: -0.66 },
  { zoom: 1.42, panX: 0.58 },
  { zoom: 1.2, panX: 0.3 },
];

/** Loads an image from a URL, resolving once it can be drawn. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

let nextPhotoId = 0;

/** Puts an image into the state's photo set under a new id. */
export function addPhoto(state, image, name) {
  const id = `p${++nextPhotoId}`;
  state.photos[id] = image;
  state.photoNames[id] = name;
  state.photoOrder.push(id);
  return id;
}

/** Loads the image files a person picked or dropped, in name order, and returns their new ids. */
export async function loadPhotoFiles(state, files) {
  const images = [...files].filter((file) => file.type.startsWith('image/'));
  const ids = [];
  for (const file of images) {
    const image = await loadImage(URL.createObjectURL(file));
    ids.push(addPhoto(state, image, file.name));
  }
  return ids;
}

/** Loads one of the two photos that ship with the studio, so a first poster is one click away. */
export async function loadSamplePhoto(state, name) {
  const existing = state.photoOrder.find((id) => state.photoNames[id] === name);
  if (existing) return existing;
  const image = await loadImage(`./samples/${name}.jpg`);
  return addPhoto(state, image, name);
}

/** Grows or trims the panel list when the layout changes, keeping the crops already set. */
export function resizePanels(state, count) {
  while (state.panels.length < count) state.panels.push(newPanel());
  state.panels.length = count;
  return state.panels;
}

/**
 * Hands the photos out to the panels. One photo fills them all, each panel with its own crop; several photos are
 * paired with the panels that suit their shape — when `rects` is given, the widest photo goes to the widest panel,
 * so a portrait never has to stretch across a cinematic banner.
 */
export function assignPhotosToPanels(state, order, rects) {
  const ids = (order ?? state.photoOrder).filter((id) => state.photos[id]);
  if (!ids.length) return;
  const taken = state.panels.map((panel, index) => ids[index % ids.length]);
  if (rects && ids.length > 1 && rects.length === state.panels.length) {
    const aspect = (id) => state.photos[id].naturalWidth / state.photos[id].naturalHeight;
    const photos = [...taken].sort((a, b) => aspect(b) - aspect(a));
    const panels = rects.map((rect, index) => ({ index, shape: rect.w / rect.h })).sort((a, b) => b.shape - a.shape);
    panels.forEach((panel, place) => { taken[panel.index] = photos[place]; });
  }
  const uses = new Map();
  state.panels.forEach((panel, index) => {
    const id = taken[index];
    const seen = uses.get(id) ?? 0;
    uses.set(id, seen + 1);
    const crop = VARIED_CROPS[seen % VARIED_CROPS.length];
    panel.photoId = id;
    panel.mode = 'fill';
    panel.auto = true;
    panel.panY = 0;
    panel.zoom = crop.zoom;
    panel.panX = crop.panX;
  });
}

/** The scale at which a photo covers (or fits inside) a panel, before the panel's own zoom. */
function baseScale(image, panel, rect) {
  const byWidth = rect.w / image.naturalWidth;
  const byHeight = rect.h / image.naturalHeight;
  return panel.mode === 'fit' ? Math.min(byWidth, byHeight) : Math.max(byWidth, byHeight);
}

/** The vertical pan an automatically framed panel wants: the window sits over the top third of the photo. */
export function autoPanY(height, slackY) {
  if (slackY <= 0.5) return 0;
  return Math.max(-1, Math.min(1, (height * (0.5 - AUTO_FOCUS_Y)) / slackY));
}

/** Where a panel's photo lands inside its rectangle, after the crop. */
export function panelPlacement(image, panel, rect) {
  const scale = baseScale(image, panel, rect) * panel.zoom;
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  const slackX = Math.max(0, w - rect.w) / 2;
  const slackY = Math.max(0, h - rect.h) / 2;
  const panY = panel.auto === false ? panel.panY : autoPanY(h, slackY);
  return {
    x: rect.x + (rect.w - w) / 2 + panel.panX * slackX,
    y: rect.y + (rect.h - h) / 2 + panY * slackY,
    w,
    h,
    slackX,
    slackY,
    panY,
  };
}

/** Freezes an automatically framed panel at the crop it is showing, so a drag starts from what is on screen. */
export function resolveAutoPan(panel, image, rect) {
  if (panel.auto === false || !image) return panel;
  panel.panY = panelPlacement(image, panel, rect).panY;
  panel.auto = false;
  return panel;
}

/** Draws one panel's photo, clipped to the panel. Panels with no photo get a graded placeholder wash. */
export function drawPanelPhoto(ctx, rect, image, panel) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.fillStyle = '#1a0e22';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (image) {
    const place = panelPlacement(image, panel, rect);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, place.x, place.y, place.w, place.h);
  } else {
    const wash = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    wash.addColorStop(0, '#39123f');
    wash.addColorStop(0.5, '#6d1a55');
    wash.addColorStop(1, '#13394a');
    ctx.fillStyle = wash;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

/** The index of the panel under a point, or -1. */
export function panelIndexAt(panels, x, y) {
  for (let index = panels.length - 1; index >= 0; index--) {
    const panel = panels[index];
    if (x >= panel.x && x <= panel.x + panel.w && y >= panel.y && y <= panel.y + panel.h) return index;
  }
  return -1;
}

/** Drags a panel's photo by a distance in panel widths, clamped so the photo keeps covering the panel. */
export function panPanel(panel, fractionX, fractionY) {
  panel.auto = false;
  panel.panX = Math.max(-1, Math.min(1, panel.panX + fractionX));
  panel.panY = Math.max(-1, Math.min(1, panel.panY + fractionY));
  return panel;
}

/** Zooms a panel's photo about its centre, within sane bounds. */
export function zoomPanel(panel, factor) {
  panel.zoom = Math.max(0.35, Math.min(5, panel.zoom * factor));
  if (panel.mode === 'fit' && panel.zoom > 1) panel.mode = 'fill';
  return panel;
}

/** Fits the whole photo inside the panel (letterboxed against the panel's dark mat). */
export function fitPanel(panel) {
  panel.mode = 'fit';
  panel.zoom = 1;
  panel.panX = 0;
  panel.panY = 0;
  panel.auto = false;
  return panel;
}

/** Fills the panel with the photo, cropping the overflow. */
export function fillPanel(panel) {
  panel.mode = 'fill';
  panel.zoom = 1;
  panel.panX = 0;
  panel.panY = 0;
  panel.auto = true;
  return panel;
}
