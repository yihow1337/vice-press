// The lettering. The caption is set in the display face (Anton, shipped under the SIL Open Font License in
// app/fonts/) as huge tight capitals auto-fitted to its band, with a magenta offset, a teal ghost and a dark
// outline so it holds up over any photo. The tagline and the small studio mark use the condensed face (Oswald).

export const DISPLAY_FACE = 'ViceDisplay';
export const CONDENSED_FACE = 'ViceCondensed';

const LINE_STEP = 0.92;    // distance between caption baselines, as a share of the em
const capRatios = new Map();

/** Sets the context's font and letter spacing together, in one place. */
function setFont(ctx, family, size, weight, tracking) {
  ctx.font = `${weight} ${size}px "${family}", sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(tracking * size).toFixed(2)}px`;
}

/** Clears any letter spacing left on the context. */
function clearTracking(ctx) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

/** How tall this face's capitals really are, as a share of the em — measured from the font, not guessed. */
export function capHeight(ctx, family, weight = 400) {
  const key = `${family}:${weight}`;
  if (capRatios.has(key)) return capRatios.get(key);
  ctx.save();
  ctx.font = `${weight} 100px "${family}", sans-serif`;
  const metrics = ctx.measureText('HEIGHT');
  ctx.restore();
  const ratio = (metrics.actualBoundingBoxAscent || 73) / 100;
  if (document.fonts?.check?.(`${weight} 100px "${family}"`)) capRatios.set(key, ratio);
  return ratio;
}

/** The width of `text` at 1px of font size, with tracking — widths scale linearly, so one measure is enough. */
function unitWidth(ctx, text, family, weight, tracking) {
  setFont(ctx, family, 100, weight, tracking);
  const width = ctx.measureText(text).width;
  clearTracking(ctx);
  return width / 100;
}

/**
 * Breaks `words` into exactly `count` lines so that the widest line is as narrow as it can be — the arrangement
 * that lets the display type be set largest. Captions are short, so the split is searched exhaustively.
 */
export function wrapToLines(ctx, words, count, family, weight, tracking) {
  if (count <= 1) return [words.join(' ')];
  const spans = new Map();
  const span = (from, to) => {
    const key = `${from}:${to}`;
    if (!spans.has(key)) spans.set(key, unitWidth(ctx, words.slice(from, to + 1).join(' '), family, weight, tracking));
    return spans.get(key);
  };
  const memo = new Map();
  const solve = (from, parts) => {
    const key = `${from}:${parts}`;
    if (memo.has(key)) return memo.get(key);
    let best;
    if (parts === 1) {
      best = { widest: span(from, words.length - 1), breaks: [words.length] };
    } else {
      for (let cut = from; cut <= words.length - parts; cut++) {
        const rest = solve(cut + 1, parts - 1);
        const widest = Math.max(span(from, cut), rest.widest);
        if (!best || widest < best.widest) best = { widest, breaks: [cut + 1, ...rest.breaks] };
      }
    }
    memo.set(key, best);
    return best;
  };
  const { breaks } = solve(0, Math.min(count, words.length));
  const lines = [];
  let start = 0;
  for (const end of breaks) {
    lines.push(words.slice(start, end).join(' '));
    start = end;
  }
  return lines;
}

/**
 * Finds the biggest display size that fits `text` inside `box`, trying one line, then two, then more, and keeps
 * the arrangement that sets the largest type. Returns the lines, the font size and the line step.
 */
export function fitDisplayType(ctx, text, box, options = {}) {
  const family = options.family ?? DISPLAY_FACE;
  const weight = options.weight ?? 400;
  const tracking = options.tracking ?? -0.02;
  const maxLines = options.maxLines ?? 2;
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], fontSize: 0, lineStep: 0, blockHeight: 0 };
  const cap = capHeight(ctx, family, weight);
  let best = null;
  for (let count = 1; count <= Math.min(maxLines, words.length); count++) {
    const lines = wrapToLines(ctx, words, count, family, weight, tracking);
    const widest = Math.max(...lines.map((line) => unitWidth(ctx, line, family, weight, tracking)));
    const byWidth = box.w / widest;
    const byHeight = box.h / ((lines.length - 1) * LINE_STEP + cap);
    const fontSize = Math.min(byWidth, byHeight);
    if (!best || fontSize > best.fontSize) {
      best = {
        lines,
        fontSize,
        cap,
        lineStep: fontSize * LINE_STEP,
        blockHeight: fontSize * ((lines.length - 1) * LINE_STEP + cap),
        family,
        weight,
        tracking,
      };
    }
  }
  return best;
}

/** The x anchor and canvas textAlign for an alignment inside a box. */
function anchor(box, align, size, tracking) {
  if (align === 'left') return { x: box.x, textAlign: 'left' };
  if (align === 'right') return { x: box.x + box.w - size * tracking, textAlign: 'right' };
  return { x: box.x + box.w / 2 - (size * tracking) / 2, textAlign: 'center' };
}

/**
 * Draws the caption filling `box`: a magenta offset, a teal ghost behind it, a dark outline and a cream-to-gold
 * fill on top. `scale` shrinks the band the type is fitted to, so the type never leaves the poster.
 */
export function drawCaption(ctx, text, box, options = {}) {
  const scale = options.scale ?? 1;
  const align = options.align ?? 'center';
  const theme = options.theme;
  const inner = { x: box.x, y: box.y, w: box.w * scale * 0.94, h: box.h * scale };
  if (align === 'center') inner.x = box.x + (box.w - inner.w) / 2;
  if (align === 'right') inner.x = box.x + (box.w - inner.w);
  const fit = fitDisplayType(ctx, text, inner, { maxLines: options.maxLines ?? 2 });
  if (!fit || !fit.lines.length) return null;
  const size = fit.fontSize;
  const offset = size * 0.052;
  const top = options.anchor === 'bottom'
    ? box.y + box.h - fit.blockHeight
    : box.y + (box.h - fit.blockHeight) / 2;
  const { x, textAlign } = anchor(inner, align, size, fit.tracking);
  const fill = ctx.createLinearGradient(0, top, 0, top + fit.blockHeight);
  fill.addColorStop(0, '#fffaf0');
  fill.addColorStop(0.62, '#ffeccd');
  fill.addColorStop(1, '#ffcf8a');

  ctx.save();
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'alphabetic';
  fit.lines.forEach((line, index) => {
    const baseline = top + fit.fontSize * fit.cap + index * fit.lineStep;
    setFont(ctx, fit.family, size, fit.weight, fit.tracking);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = theme?.accent2 ?? '#14d8d2';
    ctx.fillText(line, x - offset * 0.65, baseline - offset * 0.5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme?.accent ?? '#ff2d95';
    ctx.fillText(line, x + offset, baseline + offset);
    ctx.shadowColor = 'rgba(12, 2, 18, 0.55)';
    ctx.shadowBlur = size * 0.16;
    ctx.shadowOffsetY = size * 0.02;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.035;
    ctx.strokeStyle = 'rgba(14, 4, 18, 0.92)';
    ctx.strokeText(line, x, baseline);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = fill;
    ctx.fillText(line, x, baseline);
  });
  clearTracking(ctx);
  ctx.restore();
  return { top, height: fit.blockHeight, fontSize: size };
}

/** Draws the tagline in the condensed face: small, widely tracked capitals between two short rules. */
export function drawTagline(ctx, text, box, options = {}) {
  const words = String(text).toUpperCase().trim();
  if (!words) return;
  const align = options.align ?? 'center';
  const theme = options.theme;
  const tracking = 0.3;
  const unit = unitWidth(ctx, words, CONDENSED_FACE, 600, tracking);
  const size = Math.min(box.h, (box.w * 0.7) / unit);
  const width = unit * size;
  const baseline = box.y + size * 0.82;
  let left = box.x + (box.w - width) / 2;
  if (align === 'left') left = box.x;
  if (align === 'right') left = box.x + box.w - width;

  ctx.save();
  setFont(ctx, CONDENSED_FACE, size, 600, tracking);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(10, 2, 16, 0.75)';
  ctx.shadowBlur = size * 0.7;
  ctx.fillStyle = '#fff3e2';
  ctx.fillText(words, left, baseline);
  ctx.restore();
  clearTracking(ctx);

  const ruleY = baseline - size * 0.32;
  const gap = size * 1.1;
  const rule = size * 2.6;
  ctx.save();
  ctx.strokeStyle = theme?.accent ?? '#ff2d95';
  ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.beginPath();
  if (left - gap - rule > box.x - 1) {
    ctx.moveTo(left - gap - rule, ruleY);
    ctx.lineTo(left - gap, ruleY);
  }
  if (left + width + gap + rule < box.x + box.w + 1) {
    ctx.moveTo(left + width + gap, ruleY);
    ctx.lineTo(left + width + gap + rule, ruleY);
  }
  ctx.stroke();
  ctx.restore();
}

/** The small studio mark — a pink bar and the words, never a logo lifted from anywhere. */
export function drawStudioMark(ctx, x, y, size, theme, label = 'VICE PRESS') {
  ctx.save();
  ctx.fillStyle = theme?.accent ?? '#ff2d95';
  ctx.fillRect(x, y - size * 0.1, size * 0.34, size * 1.08);
  setFont(ctx, CONDENSED_FACE, size, 600, 0.22);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(8, 2, 14, 0.75)';
  ctx.shadowBlur = size * 0.6;
  ctx.fillStyle = '#fff4e6';
  ctx.fillText(label, x + size * 0.72, y + size * 0.78);
  ctx.restore();
  clearTracking(ctx);
}

/** Loads the two shipped OFL faces as FontFace objects. Nothing is drawn until these resolve. */
export async function loadStudioFonts() {
  const faces = [
    new FontFace(DISPLAY_FACE, 'url(./fonts/Anton-Regular.ttf)', { weight: '400', style: 'normal' }),
    new FontFace(CONDENSED_FACE, 'url(./fonts/Oswald-Variable.ttf)', { weight: '200 700', style: 'normal' }),
  ];
  const loaded = await Promise.all(faces.map((face) => face.load()));
  for (const face of loaded) document.fonts.add(face);
  return loaded;
}
