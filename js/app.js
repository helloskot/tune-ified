'use strict';

// tune·fied: make things for a Tuneshine's 64×64 LEDs and send them to it.
// Five modes (camera, picture, text, clock, library) each draw a 64×64
// frame; the preview shows it, and it goes to the Tuneshine live (camera,
// clock) or as one WebP, still or animated, that it plays by itself.

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ui = {};
for (const id of [
  'logoDot', 'conn', 'connDot', 'host', 'connectBtn', 'led', 'liveBtn', 'sendBtn', 'saveBtn', 'status',
  'bright', 'brightOut', 'clearBtn', 'sourceSeg', 'thumb', 'video', 'crop', 'startBtn', 'zoom', 'zoomOut',
  'mirror', 'videoFile', 'liveMode', 'fps', 'fpsOut', 'loopSecs', 'drop', 'pictureFile', 'pictureInfo',
  'fitSeg', 'pzoom', 'pzoomOut', 'pspeed', 'pspeedOut', 'lookBox', 'lookReset', 'style', 'grid',
  'matchField', 'match', 'contrast', 'contrastOut', 'lbright', 'lbrightOut', 'sat', 'satOut', 'blankField',
  'blank', 'topo', 'levelsField', 'levels', 'levelsOut', 'msg', 'fontSeg', 'motion', 'speedField', 'speed',
  'speedOut', 'textColor', 'textBg', 'clockStyle', 'hourSeg', 'clockColor', 'library', 'libCount',
]) ui[id] = document.getElementById(id);

const lctx = ui.led.getContext('2d');
// Frames being sent are drawn here, so the preview can carry on.
const work = document.createElement('canvas');
work.width = work.height = LED;
const wctx = work.getContext('2d');

function status(text, tone = '') {
  ui.status.textContent = text;
  ui.status.className = `status ${tone}`;
}

// ---- Settings, remembered in this browser ---------------------------------------

const store = {
  get(k, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(`tunefied.${k}`));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`tunefied.${k}`, JSON.stringify(v));
    } catch {}
  },
};

// Segmented buttons: one pressed at a time. Returns a getter.
function segmented(box, key, initial, onChange) {
  const buttons = [...box.querySelectorAll('button')];
  let value = initial;
  const show = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[key] === value)));
  buttons.forEach((b) => b.addEventListener('click', () => {
    value = b.dataset[key];
    show();
    onChange?.(value);
  }));
  show();
  return { get: () => value, set: (v) => { value = v; show(); } };
}

const COLORS = [
  ['#fffaf0', 'White'], ['#ffd23f', 'Sunflower'], ['#ff8a3d', 'Tangerine'], ['#ff6f91', 'Bubblegum'],
  ['#c38bff', 'Lilac'], ['#5cb8ff', 'Sky'], ['#6fe3a5', 'Mint'], ['rainbow', 'Rainbow'],
];
const BACKGROUNDS = [['#000000', 'Black'], ['#0b1640', 'Midnight'], ['#2a0f3a', 'Plum'], ['#0b2a18', 'Forest'], ['#3a0d14', 'Cherry']];

// Colour dots, one chosen at a time. Returns a getter.
function swatches(box, list, initial, onChange) {
  let value = initial;
  for (const [color, name] of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.title = name;
    b.setAttribute('aria-label', name);
    b.style.setProperty('--c', color === 'rainbow' ? 'conic-gradient(#ff5e5e, #ffd23f, #6fe3a5, #5cb8ff, #c38bff, #ff5e5e)' : color);
    b.dataset.color = color;
    b.addEventListener('click', () => {
      value = color;
      show();
      onChange?.(value);
    });
    box.append(b);
  }
  const show = () => box.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === value)));
  show();
  return { get: () => value };
}

// A colour for column x (rainbows run across the screen, and shift with t).
function inkAt(color, x, t = 0) {
  return color === 'rainbow' ? `hsl(${(x * 5 + t * 0.12) % 360} 95% 62%)` : color;
}

// Range labels.
function showRange(input, out, fmt) {
  const paint = () => {
    out.textContent = fmt(+input.value);
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--p', `${p}%`);
  };
  input.addEventListener('input', paint);
  paint();
  return paint;
}

// ---- Looks (camera and picture each keep their own) ------------------------------

const LOOK_DEFAULTS = {
  camera: { style: 'emoji:everything', grid: '12', match: 'color', contrast: '1.2', lbright: '0', sat: '1.3', blank: true, topo: 'off', levels: '8' },
  picture: { style: 'pixels', grid: '64', match: 'color', contrast: '1', lbright: '0', sat: '1.1', blank: false, topo: 'off', levels: '8' },
};
const LOOK_KEYS = ['style', 'grid', 'match', 'contrast', 'lbright', 'sat', 'blank', 'topo', 'levels'];
const looks = { camera: { ...LOOK_DEFAULTS.camera, ...store.get('look.camera', {}) }, picture: { ...LOOK_DEFAULTS.picture, ...store.get('look.picture', {}) } };
const lookPainters = [];

function lookFor(m) {
  const v = looks[m];
  return { style: v.style, grid: +v.grid, match: v.match, contrast: +v.contrast, bright: +v.lbright, sat: +v.sat, blank: v.blank, topo: v.topo, levels: +v.levels };
}

// Put a mode's look into the controls.
function showLook(m) {
  const v = looks[m];
  for (const k of LOOK_KEYS) {
    if (ui[k].type === 'checkbox') ui[k].checked = v[k];
    else ui[k].value = v[k];
  }
  lookPainters.forEach((p) => p());
  const emoji = v.style.startsWith('emoji:');
  ui.matchField.hidden = !emoji;
  ui.blankField.hidden = !emoji;
  ui.levelsField.hidden = v.topo === 'off';
}

for (const k of LOOK_KEYS) {
  ui[k].addEventListener(ui[k].tagName === 'SELECT' || ui[k].type === 'checkbox' ? 'change' : 'input', () => {
    const m = mode === 'picture' ? 'picture' : 'camera';
    looks[m][k] = ui[k].type === 'checkbox' ? ui[k].checked : ui[k].value;
    if (k === 'style' && ui.style.value.startsWith('emoji:') && looks[m].grid === '64') looks[m].grid = '12';
    if (k === 'style') looks[m].match = ui.style.value === 'emoji:faces' ? 'brightness' : 'color';
    store.set(`look.${m}`, looks[m]);
    showLook(m);
  });
}
lookPainters.push(
  showRange(ui.contrast, ui.contrastOut, (v) => v.toFixed(2)),
  showRange(ui.lbright, ui.lbrightOut, (v) => (v > 0 ? '+' : '') + v.toFixed(2)),
  showRange(ui.sat, ui.satOut, (v) => v.toFixed(2)),
  showRange(ui.levels, ui.levelsOut, (v) => String(v)),
);
ui.lookReset.addEventListener('click', () => {
  const m = mode === 'picture' ? 'picture' : 'camera';
  looks[m] = { ...LOOK_DEFAULTS[m] };
  store.set(`look.${m}`, looks[m]);
  showLook(m);
});

const styleName = (m) => ui.style.querySelector(`option[value="${looks[m].style}"]`)?.textContent || looks[m].style;

// ---- 📷 Camera: camera, video file or shared screen --------------------------------

const cam = { stream: null, fileUrl: null };
const sourceSeg = segmented(ui.sourceSeg, 'source', 'camera', (src) => {
  stopSource();
  ui.startBtn.textContent = { camera: 'Start the camera', file: 'Choose a video', screen: 'Share a screen or tab' }[src];
});

function stopSource() {
  cam.stream?.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  if (cam.fileUrl) URL.revokeObjectURL(cam.fileUrl);
  cam.fileUrl = null;
  ui.video.srcObject = null;
  ui.video.removeAttribute('src');
  ui.video.load();
  ui.startBtn.hidden = false;
  ui.thumb.classList.remove('on');
}

async function startSource() {
  const src = sourceSeg.get();
  if (src === 'file') return ui.videoFile.click();
  try {
    const stream = src === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      : await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    stopSource();
    cam.stream = stream;
    ui.video.srcObject = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', stopSource);
    await ui.video.play().catch(() => {});
    sourceOn();
  } catch (err) {
    status(src === 'screen' ? 'Screen sharing was cancelled.' : `Couldn’t start the camera: ${err.message}`, 'bad');
  }
}

function sourceOn() {
  ui.startBtn.hidden = true;
  ui.thumb.classList.add('on');
  ui.thumb.classList.toggle('mirrored', ui.mirror.checked && sourceSeg.get() === 'camera');
  fitCrop();
}

ui.startBtn.addEventListener('click', startSource);
ui.videoFile.addEventListener('change', () => {
  const f = ui.videoFile.files[0];
  if (!f) return;
  stopSource();
  cam.fileUrl = URL.createObjectURL(f);
  ui.video.src = cam.fileUrl;
  ui.video.loop = true;
  ui.video.play().catch(() => {});
  sourceOn();
  ui.videoFile.value = '';
});
ui.video.addEventListener('loadedmetadata', fitCrop);
ui.mirror.addEventListener('change', () => ui.thumb.classList.toggle('mirrored', ui.mirror.checked && sourceSeg.get() === 'camera'));

// Outline the square that's used, over the video thumbnail.
function fitCrop() {
  const w = ui.video.videoWidth, h = ui.video.videoHeight;
  if (!w || !h) return;
  ui.thumb.style.aspectRatio = `${w} / ${h}`;
  const side = Math.min(w, h) / +ui.zoom.value;
  ui.crop.style.width = `${(side / w) * 100}%`;
  ui.crop.style.height = `${(side / h) * 100}%`;
}
showRange(ui.zoom, ui.zoomOut, (v) => `${v.toFixed(1)}×`);
ui.zoom.addEventListener('input', fitCrop);
showRange(ui.fps, ui.fpsOut, (v) => `${v} fps`);

const camReady = () => ui.video.readyState >= 2 && ui.video.videoWidth > 0;
function renderCamera(c) {
  drawLook(c, ui.video, ui.video.videoWidth, ui.video.videoHeight, lookFor('camera'), {
    fit: 'fill', zoom: +ui.zoom.value, mirror: ui.mirror.checked && sourceSeg.get() === 'camera', settle: true,
  });
}

// ---- 🖼 Picture: any image, animated ones too ----------------------------------------

const MAX_FRAMES = 300;
const pic = { frames: [], name: '', total: 0 };
const fitSeg = segmented(ui.fitSeg, 'fit', 'fill');
showRange(ui.pzoom, ui.pzoomOut, (v) => `${v.toFixed(1)}×`);
showRange(ui.pspeed, ui.pspeedOut, (v) => `${v}×`);

async function loadPicture(file) {
  if (!file || !file.type.startsWith('image/')) return status('That isn’t a picture.', 'bad');
  ui.pictureInfo.textContent = 'Loading…';
  pic.frames.forEach((f) => f.bmp.close());
  pic.frames = [];
  const fit = (w, h) => {
    const k = Math.min(1, 512 / Math.max(w, h));
    return { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: 'high' };
  };
  try {
    if ('ImageDecoder' in window && (await ImageDecoder.isTypeSupported(file.type))) {
      const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
      await dec.tracks.ready;
      const n = Math.min(dec.tracks.selectedTrack.frameCount, MAX_FRAMES);
      for (let i = 0; i < n; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        const bmp = await createImageBitmap(image, fit(image.displayWidth, image.displayHeight));
        // GIFs that say 0 ms mean "as fast as you like": browsers use 100.
        const ms = image.duration ? image.duration / 1000 : 0;
        pic.frames.push({ bmp, ms: ms >= 20 ? ms : 100 });
        image.close();
      }
      dec.close();
    } else {
      const bmp0 = await createImageBitmap(file);
      pic.frames.push({ bmp: await createImageBitmap(bmp0, fit(bmp0.width, bmp0.height)), ms: 100 });
      bmp0.close();
    }
  } catch (err) {
    ui.pictureInfo.textContent = 'Couldn’t read that picture.';
    return status(`Couldn’t read that picture: ${err.message}`, 'bad');
  }
  pic.name = file.name.replace(/\.[^.]+$/, '');
  pic.total = pic.frames.reduce((n, f) => n + f.ms, 0);
  const f0 = pic.frames[0].bmp;
  ui.pictureInfo.textContent = pic.frames.length > 1
    ? `${pic.name} · ${pic.frames.length} frames · ${(pic.total / 1000).toFixed(1)} s`
    : `${pic.name} · ${f0.width} × ${f0.height}`;
  ui.sendBtn.textContent = '📤 Send';
}

ui.pictureFile.addEventListener('change', () => {
  loadPicture(ui.pictureFile.files[0]);
  ui.pictureFile.value = '';
});
for (const ev of ['dragenter', 'dragover']) ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) ui.drop.addEventListener(ev, () => ui.drop.classList.remove('over'));
ui.drop.addEventListener('drop', (e) => {
  e.preventDefault();
  loadPicture(e.dataTransfer.files[0]);
});
// Dropping anywhere on the page works too.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  if (e.target.closest?.('#drop')) return;
  e.preventDefault();
  if (e.dataTransfer.files[0]?.type.startsWith('image/')) {
    setMode('picture');
    loadPicture(e.dataTransfer.files[0]);
  }
});

function picFrameAt(t) {
  if (pic.frames.length === 1) return pic.frames[0];
  let tt = (t * +ui.pspeed.value) % pic.total;
  for (const f of pic.frames) {
    if (tt < f.ms) return f;
    tt -= f.ms;
  }
  return pic.frames[pic.frames.length - 1];
}

function renderPicture(c, t, f = picFrameAt(t)) {
  drawLook(c, f.bmp, f.bmp.width, f.bmp.height, lookFor('picture'), { fit: fitSeg.get(), zoom: +ui.pzoom.value, mirror: false, settle: false });
}

// ---- 🔤 Text ------------------------------------------------------------------------

const text = store.get('text', { msg: 'HELLO 👋', font: 'big', motion: 'scroll', speed: 24, color: 'rainbow', bg: '#000000' });
ui.msg.value = text.msg;
ui.motion.value = text.motion;
ui.speed.value = text.speed;
const saveText = () => store.set('text', { msg: ui.msg.value, font: fontSeg.get(), motion: ui.motion.value, speed: +ui.speed.value, color: textColor.get(), bg: textBg.get() });
const fontSeg = segmented(ui.fontSeg, 'font', text.font, saveText);
const textColor = swatches(ui.textColor, COLORS, text.color, saveText);
const textBg = swatches(ui.textBg, BACKGROUNDS, text.bg, saveText);
showRange(ui.speed, ui.speedOut, (v) => `${v} px/s`);
for (const el of [ui.msg, ui.motion, ui.speed]) el.addEventListener('input', saveText);
ui.motion.addEventListener('change', () => (ui.speedField.hidden = ui.motion.value === 'still'));
ui.speedField.hidden = ui.motion.value === 'still';

const ROUND_FONT = "800 26px 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif";

// Measure the message as it'll be drawn: one line when scrolling, else up
// to four lines.
function textLayout() {
  const font = fontSeg.get();
  const raw = ui.msg.value.trim() || ' ';
  const motion = ui.motion.value;
  const lines = motion === 'scroll' ? [raw.replace(/\s*\n\s*/g, '   ')] : raw.split('\n').slice(0, 4);
  if (font === 'round') {
    lctx.save();
    lctx.font = ROUND_FONT;
    const widths = lines.map((l) => lctx.measureText(l).width);
    lctx.restore();
    return { font, lines, widths, lineH: 28, w: Math.max(...widths) };
  }
  let scale = font === 'big' ? 2 : 1;
  let pieces = lines.map(pixelPieces);
  // Still text that's too big drops to small letters before it overflows.
  if (motion !== 'scroll' && scale === 2 && (pieces.some((p) => pixelWidth(p, 2) > LED) || lines.length * 16 > LED)) scale = 1;
  const widths = pieces.map((p) => pixelWidth(p, scale));
  return { font, lines, pieces, widths, scale, lineH: 9 * scale, w: Math.max(...widths) };
}

// Does it move along, or sit still (bouncing in place)?
const textScrolls = (L) => ui.motion.value === 'scroll' || L.w > LED;

function renderText(c, t, L = textLayout()) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = textBg.get();
  c.fillRect(0, 0, LED, LED);
  const color = textColor.get();
  const scrolls = textScrolls(L);
  const bounce = ui.motion.value === 'bounce';
  const speed = +ui.speed.value;
  const cycle = L.w + LED;
  const x0 = scrolls ? LED - ((t / 1000) * speed) % cycle : 0;
  const blockH = L.lines.length * L.lineH - (L.font === 'round' ? 0 : L.scale * 2);
  const top = Math.round((LED - blockH) / 2);
  L.lines.forEach((line, li) => {
    const x = scrolls ? x0 : Math.round((LED - L.widths[li]) / 2);
    const y = top + li * L.lineH;
    if (L.font === 'round') {
      c.save();
      c.font = ROUND_FONT;
      c.textBaseline = 'top';
      if (color === 'rainbow') {
        const g = c.createLinearGradient(x, 0, x + L.widths[li], 0);
        for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(i * 60 + (scrolls ? 0 : t * 0.12)) % 360} 95% 62%)`);
        c.fillStyle = g;
      } else c.fillStyle = color;
      const bob = bounce ? Math.sin((t / 1000) * Math.PI * 2) * 4 : 0;
      c.fillText(line, x, y + 1 + bob);
      c.restore();
    } else {
      // Rainbow colours ride with the letters when scrolling (so a loop
      // has no seam), and flow through them when still.
      const ink = (i, px) => inkAt(color, scrolls ? px - x : px, scrolls ? 0 : t);
      const dy = bounce ? (i) => Math.sin((t / 1000) * Math.PI * 2 + i * 0.7) * 2 * L.scale : undefined;
      drawPixelText(c, L.pieces[li], x, y, L.scale, ink, dy);
    }
  });
}

// ---- 🕐 Clock -----------------------------------------------------------------------

const clock = store.get('clock', { style: 'digital', hours: '12', color: '#ffd23f' });
ui.clockStyle.value = clock.style;
const saveClock = () => store.set('clock', { style: ui.clockStyle.value, hours: hourSeg.get(), color: clockColor.get() });
const hourSeg = segmented(ui.hourSeg, 'hours', clock.hours, saveClock);
const clockColor = swatches(ui.clockColor, COLORS, clock.color, saveClock);
ui.clockStyle.addEventListener('change', saveClock);

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function clockParts(now = new Date()) {
  const h24 = now.getHours(), m = now.getMinutes();
  const h = hourSeg.get() === '24' ? h24 : h24 % 12 || 12;
  const hh = hourSeg.get() === '24' ? String(h).padStart(2, '0') : String(h);
  return { time: `${hh}:${String(m).padStart(2, '0')}`, ampm: h24 < 12 ? 'AM' : 'PM', h24, m, now };
}

// What's on the clock face; a new picture goes out when this changes.
const clockKey = () => `${clockParts().time}|${ui.clockStyle.value}|${hourSeg.get()}|${clockColor.get()}`;

function renderClock(c) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#000';
  c.fillRect(0, 0, LED, LED);
  const P = clockParts();
  const color = clockColor.get();
  const twelve = hourSeg.get() === '12';
  const draw = (str, scale, y) => {
    const pieces = pixelPieces(str);
    const w = pixelWidth(pieces, scale);
    const x = Math.round((LED - w) / 2);
    drawPixelText(c, pieces, x, y, scale, (i, px) => inkAt(color, px - x));
  };
  const style = ui.clockStyle.value;
  if (style === 'emoji') {
    // The clock emoji nearest the time: 🕐 … 🕛, 🕜 … 🕧 for half past.
    const h12 = P.h24 % 12 || 12;
    const half = P.m >= 15 && P.m < 45;
    const hour = P.m >= 45 ? (h12 % 12) + 1 : h12;
    const face = String.fromCodePoint((half ? 0x1f55c : 0x1f550) + hour - 1);
    c.font = `40px ${EMOJI_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(face, 32, 25);
    draw(twelve ? `${P.time} ${P.ampm}` : P.time, 1, 51);
  } else if (style === 'date') {
    draw(P.time, 2, 12);
    draw(`${DAYS[P.now.getDay()]} ${P.now.getDate()} ${MONTHS[P.now.getMonth()]}`, 1, 38);
    if (twelve) draw(P.ampm, 1, 50);
  } else {
    draw(P.time, 2, twelve ? 20 : 25);
    if (twelve) draw(P.ampm, 1, 42);
  }
}

// ---- 💾 Library (IndexedDB, in this browser) ---------------------------------------

const LIB_MAX = 80;
// The preview plays the selected loop's frames itself: a canvas only ever
// draws the first frame of an animated image.
const lib = { items: [], urls: new Map(), selected: null, frames: [], total: 0 };
let dbp = null;
function db() {
  dbp ||= new Promise((res, rej) => {
    const rq = indexedDB.open('tunefied', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
async function dbDo(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('items', mode);
    const rq = fn(tx.objectStore('items'));
    tx.oncomplete = () => res(rq?.result);
    tx.onerror = () => rej(tx.error);
  });
}

async function libAdd(item) {
  try {
    await dbDo('readwrite', (s) => s.add({ ...item, created: Date.now() }));
    const all = await dbDo('readonly', (s) => s.getAll());
    // Keep the newest LIB_MAX.
    for (const old of all.sort((a, b) => b.created - a.created).slice(LIB_MAX)) await dbDo('readwrite', (s) => s.delete(old.id));
    await libRefresh();
  } catch (err) {
    status(`Couldn’t save it to the library: ${err.message}`, 'bad');
  }
}

async function libRefresh() {
  try {
    lib.items = (await dbDo('readonly', (s) => s.getAll())).sort((a, b) => b.created - a.created);
  } catch {
    lib.items = [];
  }
  ui.libCount.textContent = lib.items.length ? `${lib.items.length} saved` : '';
  const urlOf = (it) => {
    if (!lib.urls.has(it.id)) lib.urls.set(it.id, URL.createObjectURL(it.blob));
    return lib.urls.get(it.id);
  };
  if (!lib.items.length) {
    ui.library.innerHTML = '<p class="empty">Nothing yet. Loops you send or save show up here.</p>';
    return;
  }
  ui.library.replaceChildren(...lib.items.map((it) => {
    const card = document.createElement('figure');
    card.className = `card${lib.selected?.id === it.id ? ' on' : ''}`;
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'card-show';
    show.title = 'Show it on the Tuneshine';
    const img = document.createElement('img');
    img.src = urlOf(it);
    img.alt = it.name;
    show.append(img);
    show.addEventListener('click', () => libSend(it));
    const cap = document.createElement('figcaption');
    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = it.name;
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    meta.textContent = `${it.frames > 1 ? `${(it.ms / 1000).toFixed(1)} s` : 'still'} · ${Math.max(1, Math.round(it.blob.size / 1024))} KB`;
    cap.append(name, meta);
    const tools = document.createElement('div');
    tools.className = 'card-tools';
    const dl = document.createElement('a');
    dl.href = urlOf(it);
    dl.download = `${it.name.replace(/[^\w\- ]+/g, '').trim() || 'tunefied'}.webp`;
    dl.textContent = '⬇';
    dl.title = 'Download';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', async () => {
      await dbDo('readwrite', (s) => s.delete(it.id));
      URL.revokeObjectURL(lib.urls.get(it.id));
      lib.urls.delete(it.id);
      if (lib.selected?.id === it.id) {
        lib.selected = null;
        lib.frames = [];
      }
      libRefresh();
    });
    tools.append(dl, del);
    card.append(show, cap, tools);
    return card;
  }));
}

// Decode a loop's frames for the preview.
async function libFrames(it) {
  lib.frames.forEach((f) => f.bmp.close());
  lib.frames = [];
  try {
    const dec = new ImageDecoder({ data: await it.blob.arrayBuffer(), type: 'image/webp' });
    await dec.tracks.ready;
    const frames = [];
    for (let i = 0; i < dec.tracks.selectedTrack.frameCount; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      frames.push({ bmp: await createImageBitmap(image), ms: image.duration ? image.duration / 1000 : 100 });
      image.close();
    }
    dec.close();
    if (lib.selected === it) {
      lib.frames = frames;
      lib.total = frames.reduce((n, f) => n + f.ms, 0);
    } else frames.forEach((f) => f.bmp.close());
  } catch (err) {
    console.warn('library preview:', err);
  }
}

function libFrameAt(t) {
  let tt = t % lib.total;
  for (const f of lib.frames) {
    if (tt < f.ms) return f;
    tt -= f.ms;
  }
  return lib.frames[lib.frames.length - 1];
}

async function libSend(it) {
  lib.selected = it;
  libRefresh();
  libFrames(it);
  if (!TS.connected) return status(`Showing “${it.name}” here. Connect your Tuneshine to send it.`);
  stopLive();
  status(`Sending “${it.name}”…`);
  try {
    await tsUpload(it.blob, it.name);
    status(`“${it.name}” is on the Tuneshine.`, 'good');
  } catch (err) {
    status(`Couldn’t send it: ${err.message}`, 'bad');
  }
}

// ---- Modes --------------------------------------------------------------------------

let mode = 'camera';
const MODES = {
  camera: { ready: camReady, render: renderCamera, live: '▶ Go live', send: '📤 Send a loop', save: '💾 Save a loop', notReady: 'Start the camera first.' },
  picture: { ready: () => pic.frames.length > 0, render: renderPicture, send: '📤 Send', save: '💾 Save', notReady: 'Choose a picture first.' },
  text: { ready: () => true, render: renderText, send: '📤 Send', save: '💾 Save' },
  clock: { ready: () => true, render: renderClock, live: '▶ Start the clock' },
  library: { ready: () => lib.frames.length > 0, render: (c, t) => { c.imageSmoothingEnabled = false; c.drawImage(libFrameAt(t).bmp, 0, 0, LED, LED); } },
};

function setMode(m) {
  mode = m;
  document.querySelectorAll('.tabs [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== m));
  ui.lookBox.hidden = m !== 'camera' && m !== 'picture';
  if (!ui.lookBox.hidden) showLook(m);
  syncActions();
  if (m === 'library') libRefresh();
  store.set('mode', m);
}
document.querySelectorAll('.tabs [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

function syncActions() {
  const M = MODES[mode];
  const liveHere = engine.on && engine.mode === mode;
  ui.liveBtn.hidden = !M.live && !engine.on;
  ui.liveBtn.setAttribute('aria-pressed', String(engine.on));
  ui.liveBtn.textContent = engine.on ? (liveHere ? '■ Stop' : `■ Stop the ${engine.mode === 'clock' ? 'clock' : 'live camera'}`) : M.live || '';
  ui.sendBtn.hidden = !M.send;
  ui.sendBtn.textContent = M.send || '';
  ui.saveBtn.hidden = !M.save;
  ui.saveBtn.textContent = M.save || '';
}

// The preview: whatever the current mode draws, about 30 times a second.
let lastPreview = 0;
function preview(now) {
  requestAnimationFrame(preview);
  if (now - lastPreview < 32 || document.hidden) return;
  lastPreview = now;
  const M = MODES[mode];
  if (M.ready()) M.render(lctx, now);
  else idle(now);
}

// Waiting for something to show: a hint in tiny letters.
function idle(now) {
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.fillStyle = '#000';
  lctx.fillRect(0, 0, LED, LED);
  const lines = { camera: ['START', 'THE', 'CAMERA'], picture: ['DROP A', 'PICTURE', 'HERE'], library: ['PICK A', 'LOOP'] }[mode] || [''];
  lines.forEach((l, i) => {
    const p = pixelPieces(l);
    const x = Math.round((LED - pixelWidth(p, 1)) / 2);
    drawPixelText(lctx, p, x, 32 - lines.length * 5 + i * 10, 1, (j, px) => `hsl(${(px * 4 + now * 0.05) % 360} 80% 60%)`);
  });
}

// ---- Live: camera streaming, or the clock --------------------------------------------

const engine = { on: false, gen: 0, mode: null, sent: 0, sends: 0, sendMs: 0, rateAt: 0, rateSent: 0, fails: 0 };
const CLIP_S = 0.5; // Smooth mode: how much each clip holds

function delivered(frames, ms) {
  engine.fails = 0;
  engine.sent += frames;
  engine.sends++;
  engine.sendMs += ms;
  const now = performance.now();
  if (!engine.rateAt) Object.assign(engine, { rateAt: now, rateSent: engine.sent, sends: 0, sendMs: 0 });
  else if (now - engine.rateAt >= 1000) {
    const fps = ((engine.sent - engine.rateSent) * 1000) / (now - engine.rateAt);
    status(`Live · ${fps.toFixed(1)} fps · ${Math.round(engine.sendMs / Math.max(1, engine.sends))} ms per send`, 'good');
    Object.assign(engine, { rateAt: now, rateSent: engine.sent, sends: 0, sendMs: 0 });
  }
}

function failed(err) {
  console.warn('tuneshine send failed:', err);
  if (++engine.fails < 3) return false;
  stopLive();
  status('Lost the Tuneshine. Check it’s on and try again.', 'bad');
  return true;
}

// Instant: one picture per request, the next once the last has arrived.
async function instantLoop(gen) {
  while (engine.on && gen === engine.gen) {
    const t0 = performance.now();
    try {
      renderCamera(wctx);
      await tsUpload(new Blob([await webpBytes(work, false)], { type: 'image/webp' }), 'Live camera');
      delivered(1, performance.now() - t0);
    } catch (err) {
      if (failed(err)) return;
    }
    const wait = 1000 / +ui.fps.value - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
  }
}

// Smooth: frames captured at full speed, sent as half-second animated clips
// while the next one records, so the Tuneshine plays every frame. If
// sending falls behind, the clip waiting is replaced by the newer one.
async function smoothLoop(gen) {
  let frames = [], pending = null, sending = false;
  const send = async () => {
    sending = true;
    while (pending && engine.on && gen === engine.gen) {
      const clip = pending;
      pending = null;
      const t0 = performance.now();
      try {
        await tsUpload(new Blob([animatedWebp(clip.frames, LED, LED, clip.ms, 1)], { type: 'image/webp' }), 'Live camera');
        delivered(clip.frames.length, performance.now() - t0);
      } catch (err) {
        if (failed(err)) break;
      }
    }
    sending = false;
  };
  let next = performance.now();
  while (engine.on && gen === engine.gen) {
    const fps = +ui.fps.value;
    renderCamera(wctx);
    frames.push(await webpBytes(work, false));
    if (frames.length >= Math.max(2, Math.round(fps * CLIP_S))) {
      pending = { frames, ms: Math.round(1000 / fps) };
      frames = [];
      if (!sending) send();
    }
    next += 1000 / fps;
    const wait = next - performance.now();
    if (wait > 0) await sleep(wait);
    else next = performance.now();
  }
}

// The clock: a new still whenever the face changes (once a minute).
async function clockLoop(gen) {
  let shown = '';
  while (engine.on && gen === engine.gen) {
    const key = clockKey();
    if (key !== shown) {
      try {
        renderClock(wctx);
        await tsUpload(new Blob([await webpBytes(work, true)], { type: 'image/webp' }), 'Clock');
        shown = key;
        engine.fails = 0;
        status(`The clock is on the Tuneshine · ${clockParts().time}`, 'good');
      } catch (err) {
        if (failed(err)) return;
      }
    }
    await sleep(1000);
  }
}

function startLive() {
  if (!TS.connected) return status('Connect your Tuneshine first.', 'bad');
  if (!MODES[mode].ready()) return status(MODES[mode].notReady, 'bad');
  engine.on = true;
  engine.mode = mode;
  engine.gen++;
  Object.assign(engine, { sent: 0, sends: 0, sendMs: 0, rateAt: 0, fails: 0 });
  status(mode === 'clock' ? 'Starting the clock…' : 'Going live…');
  if (mode === 'clock') clockLoop(engine.gen);
  else (ui.liveMode.value === 'smooth' ? smoothLoop : instantLoop)(engine.gen);
  syncActions();
}

function stopLive() {
  if (!engine.on) return;
  engine.on = false;
  engine.gen++;
  syncActions();
  status('Stopped. The last picture stays on the Tuneshine.');
}

ui.liveBtn.addEventListener('click', () => (engine.on ? stopLive() : startLive()));
ui.liveMode.addEventListener('change', () => engine.on && engine.mode === 'camera' && (stopLive(), startLive()));

// ---- Send and save: one WebP, still or animated ---------------------------------------

let busy = false;

// Make the current mode's picture: { frames, durations, title }.
async function bake() {
  const M = MODES[mode];
  if (!M.ready()) throw new Error(M.notReady);
  const frames = [], durations = [];
  const grab = async (lossless, ms) => {
    frames.push(await webpBytes(work, lossless));
    durations.push(ms);
  };
  if (mode === 'camera') {
    // Record it as it happens, up to 60 frames.
    const secs = +ui.loopSecs.value;
    const fps = Math.min(+ui.fps.value, 60 / secs);
    const ms = 1000 / fps, n = Math.round(secs * fps), t0 = performance.now();
    const lossless = looks.camera.style === 'pixels';
    for (let i = 0; i < n; i++) {
      status(`Recording… ${Math.ceil((secs * (n - i)) / n)} s`);
      renderCamera(wctx);
      await grab(lossless, ms);
      const wait = t0 + (i + 1) * ms - performance.now();
      if (wait > 0) await sleep(wait);
    }
    return { frames, durations, title: `Camera · ${styleName('camera')}` };
  }
  if (mode === 'picture') {
    const lossless = looks.picture.style === 'pixels';
    const speed = +ui.pspeed.value;
    // Long animations keep every other frame (or fewer), up to 150.
    const step = Math.ceil(pic.frames.length / 150);
    for (let i = 0; i < pic.frames.length; i += step) {
      renderPicture(wctx, 0, pic.frames[i]);
      const ms = pic.frames.slice(i, i + step).reduce((n, f) => n + f.ms, 0) / speed;
      await grab(lossless, ms);
    }
    return { frames, durations, title: pic.name || 'Picture' };
  }
  if (mode === 'text') {
    const L = textLayout();
    const title = ui.msg.value.trim().split('\n')[0].slice(0, 40) || 'Text';
    const color = textColor.get();
    let times, ms;
    if (textScrolls(L)) {
      // One trip across, a pixel a frame (or a few, for very long text).
      const speed = +ui.speed.value, cycle = L.w + LED;
      const px = Math.max(1, Math.ceil(cycle / 300));
      ms = (1000 * px) / speed;
      times = Array.from({ length: Math.ceil(cycle / px) }, (_, i) => i * ms);
    } else if (ui.motion.value === 'bounce') {
      ms = 50;
      times = Array.from({ length: 20 }, (_, i) => i * ms);
    } else if (color === 'rainbow') {
      ms = 100;
      times = Array.from({ length: 30 }, (_, i) => i * ms);
    } else {
      ms = 1000;
      times = [0];
    }
    for (const t of times) {
      renderText(wctx, t, L);
      await grab(true, ms);
    }
    return { frames, durations, title };
  }
  throw new Error('Nothing to send here');
}

async function sendOrSave(send) {
  if (busy) return;
  if (send && !TS.connected) return status('Connect your Tuneshine first.', 'bad');
  busy = true;
  ui.sendBtn.disabled = ui.saveBtn.disabled = true;
  try {
    if (send) stopLive();
    const { frames, durations, title } = await bake();
    const blob = new Blob([animatedWebp(frames, LED, LED, durations)], { type: 'image/webp' });
    const ms = durations.reduce((n, d) => n + d, 0);
    if (send) {
      status('Sending…');
      await tsUpload(blob, title);
      status(`On the Tuneshine${frames.length > 1 ? `: ${frames.length} frames, ${(ms / 1000).toFixed(1)} s, playing by itself` : ''}. Kept in your library.`, 'good');
    } else status('Saved to your library.', 'good');
    await libAdd({ name: title, mode, blob, frames: frames.length, ms });
  } catch (err) {
    status(err.message, 'bad');
  } finally {
    busy = false;
    ui.sendBtn.disabled = ui.saveBtn.disabled = false;
  }
}
ui.sendBtn.addEventListener('click', () => sendOrSave(true));
ui.saveBtn.addEventListener('click', () => sendOrSave(false));

// ---- The Tuneshine: connect, brightness, give it back ---------------------------------

function connected(on, msg, tone) {
  ui.connDot.className = `conn-dot ${on ? 'on' : tone === 'bad' ? 'bad' : ''}`;
  ui.connectBtn.textContent = on ? 'Reconnect' : 'Connect';
  document.body.classList.toggle('connected', on);
  if (msg) status(msg, tone);
}

async function connect() {
  const host = ui.host.value.trim();
  store.set('host', host);
  stopLive();
  connected(false, 'Looking for your Tuneshine…');
  ui.connectBtn.disabled = true;
  try {
    const who = await tsConnect(host);
    connected(true, `Connected to ${who}.`, 'good');
  } catch (err) {
    connected(false, err.message, 'bad');
  } finally {
    ui.connectBtn.disabled = false;
  }
}
ui.conn.addEventListener('submit', (e) => {
  e.preventDefault();
  connect();
});

ui.bright.value = store.get('bright', 60);
showRange(ui.bright, ui.brightOut, (v) => `${v}%`);
let brightTimer = 0;
ui.bright.addEventListener('input', () => {
  store.set('bright', +ui.bright.value);
  clearTimeout(brightTimer);
  if (TS.connected) brightTimer = setTimeout(() => tsBrightness(+ui.bright.value), 250);
});

ui.clearBtn.addEventListener('click', async () => {
  stopLive();
  if (!TS.connected) return status('Connect your Tuneshine first.', 'bad');
  const ok = await tsClear();
  status(ok ? 'Handed back to the music.' : 'The Tuneshine won’t let web pages clear it: clear it in the Tuneshine app.', ok ? 'good' : 'bad');
});

// ---- The logo's dot keeps changing its mind ---------------------------------------------

const DOTS = ['🎵', '📟', '🎶', '🌈', '🎧', '✨', '💿', '🪩'];
setInterval(() => {
  if (document.hidden) return;
  const d = ui.logoDot;
  d.textContent = DOTS[(DOTS.indexOf(d.textContent) + 1) % DOTS.length];
  d.classList.remove('pop');
  void d.offsetWidth;
  d.classList.add('pop');
}, 4000);

// ---- Start ----------------------------------------------------------------------------

setMode(store.get('mode', 'camera') === 'library' ? 'camera' : store.get('mode', 'camera'));
requestAnimationFrame(preview);
libRefresh();
ui.host.value = store.get('host', '');
if (ui.host.value) connect(); // straight back to your Tuneshine
window.tunefiedReady = true;
