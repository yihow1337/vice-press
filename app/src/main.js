// Wiring. Holds the one state object the poster is drawn from, builds the rail's pickers, takes photos from the
// file picker or a drop, pans and zooms the panel you click, and keeps the live preview in step. A ?shot= query
// hands over to src/shots.js instead, which sets a fixed scene for a screenshot.

import { SIZES, coverGeometry, drawCover } from './cover.js';
import { exportAllSizes, exportCoverPng } from './export.js';
import { GRADES } from './grade.js';
import { LAYOUTS, drawLayoutIcon, panelCount } from './layouts.js';
import {
  assignPhotosToPanels, fillPanel, fitPanel, loadPhotoFiles, loadSamplePhoto, newPanel, panPanel,
  panelIndexAt, panelPlacement, resizePanels, resolveAutoPan, zoomPanel,
} from './photos.js';
import { loadStudioFonts } from './type.js';

/** Everything a poster is made of. drawCover(canvas, state) is a pure function of this. */
export const state = {
  size: SIZES.wide,
  layout: 'banner',
  grade: 'vice',
  caption: 'PINK HEAT',
  tagline: 'EST. AFTER DARK',
  align: 'center',
  typeScale: 1,
  panels: [newPanel(), newPanel(), newPanel()],
  photos: {},
  photoNames: {},
  photoOrder: [],
  selected: -1,
};

const SAMPLES = [{ name: 'boulevard', label: 'Boulevard' }, { name: 'pier', label: 'Pier' }];

const layoutIcons = new Map();

const dom = {
  preview: document.getElementById('preview'),
  previewWrap: document.getElementById('preview-wrap'),
  sizePills: document.getElementById('size-pills'),
  layouts: document.getElementById('layouts'),
  grades: document.getElementById('grades'),
  samples: document.getElementById('samples'),
  thumbs: document.getElementById('thumbs'),
  dropzone: document.getElementById('drop'),
  fileInput: document.getElementById('file-input'),
  caption: document.getElementById('caption'),
  tagline: document.getElementById('tagline'),
  align: document.getElementById('align'),
  typeScale: document.getElementById('type-scale'),
  panelTools: document.getElementById('panel-tools'),
  panelLabel: document.getElementById('panel-label'),
  panelFill: document.getElementById('panel-fill'),
  panelFit: document.getElementById('panel-fit'),
  exportButton: document.getElementById('export'),
  exportAll: document.getElementById('export-all'),
  status: document.getElementById('status'),
};

let pendingFrame = 0;
let pendingQuality = 'full';
let lastGeometry = null;

/** Writes a line into the status strip under the deck. */
export function setStatus(message) {
  dom.status.textContent = message;
}

/** The pixel size the preview canvas should have: the poster's aspect, fitted to the stage. */
function previewPixels() {
  if (document.body.classList.contains('shot-cover')) {
    return { cssW: window.innerWidth, cssH: window.innerHeight, w: window.innerWidth, h: window.innerHeight };
  }
  const box = dom.previewWrap.getBoundingClientRect();
  const aspect = state.size.w / state.size.h;
  let cssW = Math.max(120, box.width);
  let cssH = cssW / aspect;
  if (cssH > box.height) {
    cssH = Math.max(120, box.height);
    cssW = cssH * aspect;
  }
  const density = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.min(state.size.w, Math.round(cssW * density));
  return { cssW, cssH, w, h: Math.round(w / aspect) };
}

/** Paints the preview now, at the given quality ('fast' skips the slower film effects while dragging). */
export function draw(quality = 'full') {
  const size = previewPixels();
  if (dom.preview.width !== size.w || dom.preview.height !== size.h) {
    dom.preview.width = size.w;
    dom.preview.height = size.h;
  }
  dom.preview.style.width = `${Math.round(size.cssW)}px`;
  dom.preview.style.height = `${Math.round(size.cssH)}px`;
  lastGeometry = drawCover(dom.preview, state, { quality });
  paintSelection(lastGeometry);
}

/** Marks the selected panel on the preview only — the exported poster never shows it. */
function paintSelection(geometry) {
  const rect = geometry.panels[state.selected];
  if (!rect || document.body.classList.contains('shot-cover')) return;
  const ctx = dom.preview.getContext('2d');
  const unit = Math.max(2, geometry.short * 0.007);
  ctx.save();
  ctx.strokeStyle = '#ff2d95';
  ctx.lineWidth = unit;
  ctx.setLineDash([unit * 3, unit * 2]);
  ctx.strokeRect(rect.x + unit / 2, rect.y + unit / 2, rect.w - unit, rect.h - unit);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff2d95';
  const handle = unit * 3.4;
  for (const [cx, cy] of [[rect.x, rect.y], [rect.x + rect.w - handle, rect.y],
    [rect.x, rect.y + rect.h - handle], [rect.x + rect.w - handle, rect.y + rect.h - handle]]) {
    ctx.fillRect(cx, cy, handle, handle);
  }
  ctx.restore();
}

/** Asks for one repaint on the next frame. */
export function requestDraw(quality = 'full') {
  pendingQuality = quality === 'fast' && pendingQuality === 'fast' ? 'fast' : quality;
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    const quality = pendingQuality;
    pendingQuality = 'full';
    draw(quality);
  });
}

/** The panel rectangles at the exported size — what the photos are matched against when they are handed out. */
export function exportPanels() {
  return coverGeometry(state, state.size.w, state.size.h).panels;
}

/** Keeps the panel list the length the layout wants, and makes sure every panel has a photo to show. */
export function refreshPanels(reassign = false) {
  resizePanels(state, panelCount(state.layout));
  if (!state.photoOrder.length) return;
  if (reassign || state.panels.some((panel) => !panel.photoId)) {
    assignPhotosToPanels(state, undefined, exportPanels());
  }
}

/** Marks the pressed button in a group of controls. */
function press(container, isOn) {
  for (const button of container.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(isOn(button)));
  }
}

function buildSizePills() {
  for (const size of [SIZES.square, SIZES.portrait, SIZES.wide]) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.dataset.size = size.id;
    pill.textContent = size.label;
    pill.title = size.name;
    pill.addEventListener('click', () => {
      state.size = size;
      syncControls();
      requestDraw();
      setStatus(`Size ${size.w} × ${size.h}`);
    });
    dom.sizePills.append(pill);
  }
}

function buildLayoutPicker() {
  for (const layout of LAYOUTS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'layout-option';
    option.dataset.layout = layout.id;
    const icon = document.createElement('canvas');
    icon.width = 58;
    icon.height = 38;
    option.append(icon, document.createTextNode(layout.name));
    option.addEventListener('click', () => {
      state.layout = layout.id;
      state.selected = -1;
      refreshPanels(true);
      syncControls();
      requestDraw();
      setStatus(`${layout.name} · ${layout.panels} panel${layout.panels > 1 ? 's' : ''}`);
    });
    dom.layouts.append(option);
    layoutIcons.set(layout.id, icon);
    drawLayoutIcon(icon, layout.id, layout.id === state.layout);
  }
}

function buildGradePicker() {
  for (const grade of GRADES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'grade-option';
    option.dataset.grade = grade.id;
    const swatch = document.createElement('span');
    swatch.className = 'grade-swatch';
    swatch.style.background = grade.swatch;
    option.append(swatch, document.createTextNode(grade.name));
    option.addEventListener('click', () => {
      state.grade = grade.id;
      syncControls();
      requestDraw();
      setStatus(`Grade · ${grade.name}`);
    });
    dom.grades.append(option);
  }
}

function buildAlignPicker() {
  for (const [value, label] of [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.align = value;
    button.textContent = label;
    button.addEventListener('click', () => {
      state.align = value;
      syncControls();
      requestDraw();
    });
    dom.align.append(button);
  }
}

function buildSampleRow() {
  for (const sample of SAMPLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample';
    button.style.backgroundImage = `url(./samples/${sample.name}.jpg)`;
    button.textContent = sample.label;
    button.addEventListener('click', () => useSample(sample.name));
    dom.samples.append(button);
  }
}

/** Redraws the photo thumbnails in the rail. */
export function renderThumbs() {
  dom.thumbs.replaceChildren();
  for (const id of state.photoOrder) {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'thumb';
    thumb.style.backgroundImage = `url(${state.photos[id].src})`;
    thumb.title = state.photoNames[id];
    thumb.setAttribute('aria-pressed', String(state.panels.some((panel) => panel.photoId === id)));
    thumb.addEventListener('click', () => {
      const index = state.selected >= 0 ? state.selected : 0;
      state.panels[index].photoId = id;
      state.selected = index;
      syncControls();
      requestDraw();
      setStatus(`${state.photoNames[id]} → panel ${index + 1}`);
    });
    dom.thumbs.append(thumb);
  }
}

/** Puts the controls back in step with the state. */
export function syncControls() {
  press(dom.sizePills, (button) => button.dataset.size === state.size.id);
  press(dom.layouts, (button) => button.dataset.layout === state.layout);
  for (const [id, icon] of layoutIcons) drawLayoutIcon(icon, id, id === state.layout);
  press(dom.grades, (button) => button.dataset.grade === state.grade);
  press(dom.align, (button) => button.dataset.align === state.align);
  dom.caption.value = state.caption;
  dom.tagline.value = state.tagline;
  dom.typeScale.value = String(Math.round(state.typeScale * 100));
  const panel = state.panels[state.selected];
  dom.panelTools.classList.toggle('active', Boolean(panel));
  dom.panelLabel.textContent = panel ? `Panel ${state.selected + 1}` : 'Panel';
  dom.panelFill.setAttribute('aria-pressed', String(Boolean(panel) && panel.mode === 'fill'));
  dom.panelFit.setAttribute('aria-pressed', String(Boolean(panel) && panel.mode === 'fit'));
  renderThumbs();
}

/** Loads one of the shipped sample photos and spreads the photos over the panels. */
export async function useSample(name) {
  await loadSamplePhoto(state, name);
  assignPhotosToPanels(state, undefined, exportPanels());
  state.selected = -1;
  syncControls();
  requestDraw();
  setStatus(`${name} loaded · ${state.photoOrder.length} photo${state.photoOrder.length > 1 ? 's' : ''}`);
}

/** Takes photos from the picker or a drop and fills the panels with them. */
export async function addPhotos(files) {
  const ids = await loadPhotoFiles(state, files);
  if (!ids.length) {
    setStatus('No image files in that drop');
    return;
  }
  assignPhotosToPanels(state, undefined, exportPanels());
  syncControls();
  requestDraw();
  setStatus(`${ids.length} photo${ids.length > 1 ? 's' : ''} added · ${state.photoOrder.length} in the tray`);
}

/** Turns a pointer event into poster coordinates on the preview canvas. */
function posterPoint(event) {
  const box = dom.preview.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * dom.preview.width,
    y: ((event.clientY - box.top) / box.height) * dom.preview.height,
    scale: dom.preview.width / box.width,
  };
}

/** The panel rectangles as the preview is currently drawing them. */
function previewGeometry() {
  return lastGeometry ?? coverGeometry(state, dom.preview.width, dom.preview.height);
}

function wirePreview() {
  let dragging = null;
  dom.preview.addEventListener('pointerdown', (event) => {
    const point = posterPoint(event);
    const geometry = previewGeometry();
    const index = panelIndexAt(geometry.panels, point.x, point.y);
    state.selected = index;
    syncControls();
    if (index < 0) {
      requestDraw();
      setStatus('Click a panel to crop it');
      return;
    }
    const panel = state.panels[index];
    resolveAutoPan(panel, state.photos[panel.photoId], geometry.panels[index]);
    dragging = { index, x: point.x, y: point.y, scale: point.scale, rect: geometry.panels[index] };
    dom.preview.setPointerCapture(event.pointerId);
    dom.preview.classList.add('dragging');
    setStatus(`Panel ${index + 1} · drag to pan, wheel to zoom`);
    requestDraw();
  });

  dom.preview.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const point = posterPoint(event);
    const panel = state.panels[dragging.index];
    const image = state.photos[panel.photoId];
    if (image) {
      const place = panelPlacement(image, panel, dragging.rect);
      panPanel(
        panel,
        place.slackX > 0.5 ? (point.x - dragging.x) / place.slackX : 0,
        place.slackY > 0.5 ? (point.y - dragging.y) / place.slackY : 0,
      );
    }
    dragging.x = point.x;
    dragging.y = point.y;
    requestDraw('fast');
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = null;
    dom.preview.classList.remove('dragging');
    if (event.pointerId !== undefined && dom.preview.hasPointerCapture?.(event.pointerId)) {
      dom.preview.releasePointerCapture(event.pointerId);
    }
    requestDraw();
  };
  dom.preview.addEventListener('pointerup', endDrag);
  dom.preview.addEventListener('pointercancel', endDrag);

  dom.preview.addEventListener('wheel', (event) => {
    const point = posterPoint(event);
    const geometry = previewGeometry();
    const index = panelIndexAt(geometry.panels, point.x, point.y);
    if (index < 0) return;
    event.preventDefault();
    state.selected = index;
    zoomPanel(state.panels[index], Math.exp(-event.deltaY * 0.0014));
    syncControls();
    requestDraw('fast');
    setStatus(`Panel ${index + 1} · zoom ${Math.round(state.panels[index].zoom * 100)}%`);
  }, { passive: false });
}

function wireDeck() {
  dom.caption.addEventListener('input', () => {
    state.caption = dom.caption.value;
    requestDraw();
  });
  dom.tagline.addEventListener('input', () => {
    state.tagline = dom.tagline.value;
    requestDraw();
  });
  dom.typeScale.addEventListener('input', () => {
    state.typeScale = Number(dom.typeScale.value) / 100;
    requestDraw('fast');
  });
  dom.panelFill.addEventListener('click', () => {
    if (state.selected < 0) return;
    fillPanel(state.panels[state.selected]);
    syncControls();
    requestDraw();
  });
  dom.panelFit.addEventListener('click', () => {
    if (state.selected < 0) return;
    fitPanel(state.panels[state.selected]);
    syncControls();
    requestDraw();
  });
}

function wirePhotoInput() {
  dom.dropzone.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', (event) => {
    if (event.target.files?.length) addPhotos(event.target.files);
    event.target.value = '';
  });
  for (const type of ['dragenter', 'dragover']) {
    document.addEventListener(type, (event) => {
      event.preventDefault();
      dom.dropzone.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'dragend']) {
    document.addEventListener(type, () => dom.dropzone.classList.remove('over'));
  }
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    dom.dropzone.classList.remove('over');
    if (event.dataTransfer?.files?.length) addPhotos(event.dataTransfer.files);
  });
}

function wireExport() {
  dom.exportButton.addEventListener('click', async () => {
    dom.exportButton.disabled = true;
    setStatus(`Rendering ${state.size.w} × ${state.size.h}…`);
    try {
      setStatus(`Saved ${await exportCoverPng(state, state.size.id)}`);
    } finally {
      dom.exportButton.disabled = false;
    }
  });
  dom.exportAll.addEventListener('click', async () => {
    dom.exportAll.disabled = true;
    setStatus('Rendering all three sizes…');
    try {
      const names = await exportAllSizes(state);
      setStatus(`Saved ${names.length} PNGs · 1920×1080, 1080×1350, 1080×1080`);
    } finally {
      dom.exportAll.disabled = false;
    }
  });
}

/** Builds the page, loads the shipped faces, and either runs a screenshot scene or opens the studio. */
async function start() {
  buildSizePills();
  buildLayoutPicker();
  buildGradePicker();
  buildAlignPicker();
  buildSampleRow();
  wirePreview();
  wireDeck();
  wirePhotoInput();
  wireExport();
  window.addEventListener('resize', () => requestDraw());
  await loadStudioFonts();

  const query = new URLSearchParams(location.search);
  if (query.get('shot')) {
    const { runShot } = await import('./shots.js');
    await runShot(state, query, { syncControls, draw, refreshPanels });
    return;
  }
  refreshPanels();
  syncControls();
  draw();
  setStatus('Drop photos, or click a sample to start');
}

window.__vicePress = { state, draw, requestDraw };
start();
