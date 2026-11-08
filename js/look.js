'use strict';

// A look: how a picture (camera, video, image, GIF frame) becomes the 64×64
// frame. The picture is cropped square, sampled to an N×N grid, adjusted,
// optionally read as a topo map, then drawn as emoji, LED dots or plain
// pixels.

const LED = 64;
const lookSample = document.createElement('canvas');
const lookCtx = lookSample.getContext('2d', { willReadFrequently: true });

// Contrast, brightness and saturation, in place.
function adjustPixels(d, contrast, bright, sat) {
  const add = bright * 255;
  for (let p = 0; p < d.length; p += 4) {
    let r = d[p], g = d[p + 1], b = d[p + 2];
    const l = luma(r, g, b);
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;
    d[p] = (r - 128) * contrast + 128 + add;
    d[p + 1] = (g - 128) * contrast + 128 + add;
    d[p + 2] = (b - 128) * contrast + 128 + add;
  }
}

// ---- Topo map (from emoji·fied) ----------------------------------------------
// Brightness read as height: smoothed into hills, cut into contour bands,
// painted as a map, neon contour lines or a paper survey. Every fifth line
// is an index contour, drawn stronger.

// Height (0-1) to colour, as stops; the map is coloured in flat bands.
const TOPO_MAP = [
  [0, 13, 47, 94], [0.18, 37, 98, 168], [0.27, 104, 170, 222], [0.3, 236, 222, 164],
  [0.4, 146, 198, 108], [0.55, 63, 143, 69], [0.67, 166, 160, 90], [0.78, 154, 106, 62],
  [0.88, 139, 133, 128], [1, 248, 247, 240],
];
const TOPO_PAPER = [240, 230, 206];
const TOPO_INK = [150, 88, 40];
const topo = { elev: null, buf: null, tmp: null, band: null, w: 0, h: 0 };

function topoTint(t) {
  let i = 1;
  while (i < TOPO_MAP.length - 1 && TOPO_MAP[i][0] < t) i++;
  const [t0, r0, g0, b0] = TOPO_MAP[i - 1], [t1, r1, g1, b1] = TOPO_MAP[i];
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
}

// Box blur in place (a running sum along rows, then columns).
function topoBlur(e, tmp, w, h, r) {
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = e[o] * (r + 1);
    for (let x = 1; x <= r; x++) sum += e[o + Math.min(w - 1, x)];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = sum / n;
      sum += e[o + Math.min(w - 1, x + r + 1)] - e[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = tmp[x] * (r + 1);
    for (let y = 1; y <= r; y++) sum += tmp[Math.min(h - 1, y) * w + x];
    for (let y = 0; y < h; y++) {
      e[y * w + x] = sum / n;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

function topoPixels(d, w, h, levels, mode, settle) {
  const n = w * h;
  if (!topo.buf || topo.buf.length < n) {
    topo.buf = new Float32Array(n);
    topo.tmp = new Float32Array(n);
    topo.band = new Uint8Array(n);
  }
  let e = topo.buf;
  for (let i = 0, p = 0; i < n; i++, p += 4) e[i] = luma(d[p], d[p + 1], d[p + 2]) / 255;
  // Smooth hills, at any detail: the blur grows with the grid.
  const r = Math.max(1, Math.round(w / 64));
  topoBlur(e, topo.tmp, w, h, r);
  topoBlur(e, topo.tmp, w, h, r);
  // Live, the land settles over a few frames, so camera noise doesn't make
  // the contours crawl.
  if (settle) {
    if (topo.elev && topo.w === w && topo.h === h) {
      const el = topo.elev;
      for (let i = 0; i < n; i++) el[i] += (e[i] - el[i]) * 0.45;
    } else Object.assign(topo, { elev: e.slice(0, n), w, h });
    e = topo.elev;
  }

  // Each band's colour, plain, on a contour and on an index contour.
  const L = levels;
  const cols = new Uint8ClampedArray(L * 9);
  for (let b = 0; b < L; b++) {
    const t = b / (L - 1);
    let set;
    if (mode === 'lines') {
      // Neon: blue valleys round the rainbow to red peaks.
      const hue = ((1 - t) * 240) / 360;
      set = [[0, 0, 0], hslToRgb(hue, 1, 0.56), hslToRgb(hue, 1, 0.72)];
    } else if (mode === 'paper') {
      set = [TOPO_PAPER, TOPO_INK, TOPO_INK.map((v) => v * 0.6)];
    } else {
      const c = topoTint(t);
      set = [c, c.map((v) => v * 0.6), c.map((v) => v * 0.38)];
    }
    set.forEach((c, k) => cols.set(c, (b * 3 + k) * 3));
  }

  const band = topo.band;
  for (let i = 0; i < n; i++) band[i] = Math.min(L - 1, (e[i] * L) | 0);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const b = band[i];
      // A contour runs along the top edge of each band: wherever a
      // neighbour is lower.
      const line = (x > 0 && band[i - 1] < b) || (x < w - 1 && band[i + 1] < b) ||
        (y > 0 && band[i - w] < b) || (y < h - 1 && band[i + w] < b);
      const q = (b * 3 + (line ? (b % 5 === 0 ? 2 : 1) : 0)) * 3, p = i * 4;
      d[p] = cols[q];
      d[p + 1] = cols[q + 1];
      d[p + 2] = cols[q + 2];
    }
  }
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

// ---- Drawing ------------------------------------------------------------------

// Draw `src` (sw × sh) into the 64×64 context `c` with look `L`:
// { style: 'emoji:<set>' | 'dots' | 'pixels', grid, match, contrast, bright,
//   sat, blank, topo: 'off' | 'map' | 'lines' | 'paper', levels }
// and framing { fit: 'fill' | 'fit', zoom, mirror, settle } (settle: smooth
// the topo map over frames, for live pictures).
function drawLook(c, src, sw, sh, L, frame) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#000';
  c.fillRect(0, 0, LED, LED);
  if (!sw || !sh) return;
  const N = L.style === 'pixels' ? Math.min(LED, L.grid) : L.grid;
  if (lookSample.width !== N) lookSample.width = lookSample.height = N;
  const s = lookCtx;
  s.save();
  s.fillStyle = '#000';
  s.fillRect(0, 0, N, N);
  s.imageSmoothingEnabled = true;
  s.imageSmoothingQuality = 'high';
  if (frame.mirror) {
    s.translate(N, 0);
    s.scale(-1, 1);
  }
  const zoom = frame.zoom || 1;
  if (frame.fit === 'fit') {
    // The whole picture, letterboxed.
    const k = (N / Math.max(sw, sh)) * zoom;
    s.drawImage(src, (N - sw * k) / 2, (N - sh * k) / 2, sw * k, sh * k);
  } else {
    // Fill the square: crop the middle (closer in with zoom).
    const side = Math.min(sw, sh) / zoom;
    s.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, N, N);
  }
  s.restore();
  const img = s.getImageData(0, 0, N, N);
  const d = img.data;
  adjustPixels(d, L.contrast, L.bright, L.sat);
  if (L.topo !== 'off') topoPixels(d, N, N, L.levels, L.topo, frame.settle);

  const cell = LED / N;
  if (L.style === 'pixels') {
    s.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(lookSample, 0, 0, LED, LED);
    return;
  }
  if (L.style === 'dots') {
    // LED dots: bigger and brighter where the picture is, in its colour.
    for (let i = 0; i < N * N; i++) {
      const p = i * 4, l = luma(d[p], d[p + 1], d[p + 2]) / 255;
      if (l < 0.07) continue;
      const lift = (255 / Math.max(1, d[p], d[p + 1], d[p + 2])) * (0.3 + 0.7 * l);
      c.fillStyle = `rgb(${(d[p] * lift) | 0} ${(d[p + 1] * lift) | 0} ${(d[p + 2] * lift) | 0})`;
      c.beginPath();
      c.arc(((i % N) + 0.5) * cell, (((i / N) | 0) + 0.5) * cell, (cell / 2) * (0.35 + 0.65 * l), 0, Math.PI * 2);
      c.fill();
    }
    return;
  }
  // Emoji: the closest by colour (or brightness) in each cell.
  const pal = getPalette(EMOJI_SETS[L.style.slice(6)] || L.style.slice(6));
  if (!pal.entries.length) return;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  for (let i = 0; i < N * N; i++) {
    const p = i * 4, l = luma(d[p], d[p + 1], d[p + 2]);
    if (L.blank && l < 28) continue;
    const e = L.match === 'brightness'
      ? pal.byLum[Math.min(pal.byLum.length - 1, ((l / 256) * pal.byLum.length) | 0)]
      : nearestEmoji(pal, d[p], d[p + 1], d[p + 2]);
    c.drawImage(pal.atlas, e.sx, e.sy, pal.cw, pal.ch, (i % N) * cell, ((i / N) | 0) * cell, cell, cell);
  }
}
