'use strict';

// tune·fied: make things for a Tuneshine's 64×64 LEDs and send them to it.
// Four modes (album art, picture, text, library) each draw a 64×64 frame;
// the preview shows it, and it goes to the Tuneshine as one WebP, still or
// animated, that it plays by itself.

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ui = {};
for (const id of [
  'logoDot', 'conn', 'connDot', 'host', 'connectBtn', 'led', 'sendBtn', 'saveBtn', 'status',
  'bright', 'brightOut', 'clearBtn', 'backAfter', 'clearHelp', 'clearWhy', 'clearCmd', 'copyCmd', 'nowArt', 'nowTrack', 'nowArtist', 'nowBtn', 'follow', 'nowHint',
  'searchForm', 'q', 'results', 'remix', 'albumFile', 'drop', 'pictureFile', 'pictureInfo',
  'fitSeg', 'pzoom', 'pzoomOut', 'pspeed', 'pspeedOut', 'lookBox', 'lookReset', 'style', 'grid',
  'matchField', 'match', 'contrast', 'contrastOut', 'lbright', 'lbrightOut', 'sat', 'satOut', 'blankField',
  'blank', 'topo', 'levelsField', 'levels', 'levelsOut', 'msg', 'fontSeg', 'motion', 'speedField', 'speed',
  'speedOut', 'textColor', 'textBg', 'library', 'libCount',
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

// ---- Looks (album art and picture each keep their own) ---------------------------

const LOOK_DEFAULTS = {
  album: { style: 'emoji:everything', grid: '12', match: 'color', contrast: '1.15', lbright: '0', sat: '1.3', blank: false, topo: 'off', levels: '8' },
  picture: { style: 'pixels', grid: '64', match: 'color', contrast: '1', lbright: '0', sat: '1.1', blank: false, topo: 'off', levels: '8' },
};
const LOOK_KEYS = ['style', 'grid', 'match', 'contrast', 'lbright', 'sat', 'blank', 'topo', 'levels'];
const looks = { album: { ...LOOK_DEFAULTS.album, ...store.get('look.album', {}) }, picture: { ...LOOK_DEFAULTS.picture, ...store.get('look.picture', {}) } };
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
    const m = mode; // the look box only shows for album art and pictures
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
  const m = mode; // the look box only shows for album art and pictures
  looks[m] = { ...LOOK_DEFAULTS[m] };
  store.set(`look.${m}`, looks[m]);
  showLook(m);
});

const styleName = (m) => ui.style.querySelector(`option[value="${looks[m].style}"]`)?.textContent || looks[m].style;

// ---- 🎵 Album art remix ---------------------------------------------------------------
// The cover of whatever your Tuneshine is playing, remixed through a look
// (emoji, LED dots, topo map…), still or animated. The cover comes from the
// Tuneshine itself if it lets web pages ask (/state, /artwork), otherwise
// from a music catalogue (Apple's, then Deezer's), or you drop one in.
// Follow the music remixes and sends each new song as it starts.

const album = { bmp: null, meta: null, key: '', stamp: 0, following: false, timer: 0, remixKey: '' };
const coverCv = document.createElement('canvas');
coverCv.width = coverCv.height = LED;
const coverCtx = coverCv.getContext('2d');
const remixCv = document.createElement('canvas');
remixCv.width = remixCv.height = LED;
const remixCtx = remixCv.getContext('2d');
const nowArtCtx = ui.nowArt.getContext('2d');

// One loop of each animated remix, in ms (0: a still picture).
const REMIX_MS = { still: 0, morph: 4000, reveal: 4000, rainbow: 3000, breathe: 2000 };
ui.remix.value = store.get('remix', 'morph');
ui.remix.addEventListener('change', () => store.set('remix', ui.remix.value));

function setAlbum(bmp, meta) {
  album.bmp?.close?.();
  album.bmp = bmp;
  album.meta = meta;
  album.stamp++;
  // The cover itself, square and 64 pixels, for morphing to and from.
  const side = Math.min(bmp.width, bmp.height);
  coverCtx.imageSmoothingEnabled = true;
  coverCtx.imageSmoothingQuality = 'high';
  coverCtx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, LED, LED);
  nowArtCtx.drawImage(coverCv, 0, 0);
  ui.nowTrack.textContent = meta.track || meta.album || 'A cover';
  ui.nowArtist.textContent = [meta.artist, meta.track && meta.album ? meta.album : ''].filter(Boolean).join(' · ');
  ui.nowArt.closest('.now').classList.add('has');
}

const albumTitle = () => {
  const m = album.meta || {};
  return `${m.track || m.album || 'Album art'}${m.artist ? ` · ${m.artist}` : ''}`;
};

// The remix itself, redrawn only when the cover or the look changes.
function remixed() {
  const key = `${album.stamp}|${JSON.stringify(looks.album)}`;
  if (key !== album.remixKey) {
    drawLook(remixCtx, album.bmp, album.bmp.width, album.bmp.height, lookFor('album'), { fit: 'fill', zoom: 1, mirror: false, settle: false });
    album.remixKey = key;
  }
  return remixCv;
}

const ease = (x) => x * x * (3 - 2 * x);

function renderAlbum(c, t) {
  const r = remixed();
  const kind = ui.remix.value, P = REMIX_MS[kind];
  const p = P ? (t % P) / P : 0;
  // There and back, resting a moment at each end.
  const tri = p < 0.5 ? p * 2 : 2 - p * 2;
  const k = ease(Math.min(1, Math.max(0, (tri - 0.15) / 0.7)));
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.filter = 'none';
  c.globalAlpha = 1;
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#000';
  c.fillRect(0, 0, LED, LED);
  if (kind === 'morph') {
    // Cover ↔ remix.
    c.drawImage(coverCv, 0, 0);
    c.globalAlpha = k;
    c.drawImage(r, 0, 0);
    c.globalAlpha = 1;
  } else if (kind === 'reveal') {
    // The remix sweeps in cell by cell, corner to corner, and back out.
    c.drawImage(coverCv, 0, 0);
    const N = +looks.album.grid, cell = LED / N;
    c.save();
    c.beginPath();
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) if ((x + y) / Math.max(1, 2 * N - 2) < k * 1.02) c.rect(x * cell, y * cell, cell, cell);
    }
    c.clip();
    c.drawImage(r, 0, 0);
    c.restore();
  } else if (kind === 'rainbow') {
    c.filter = `hue-rotate(${Math.round(p * 360)}deg)`;
    c.drawImage(r, 0, 0);
    c.filter = 'none';
  } else if (kind === 'breathe') {
    const z = 1 + 0.08 * (0.5 - 0.5 * Math.cos(p * Math.PI * 2));
    c.imageSmoothingEnabled = true;
    c.setTransform(z, 0, 0, z, 32 * (1 - z), 32 * (1 - z));
    c.drawImage(r, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
  } else c.drawImage(r, 0, 0);
}

// ---- Where covers come from ----

// What the Tuneshine says is playing, skipping what we sent it ourselves.
// Throws if it won't tell web pages (no CORS).
async function nowPlaying() {
  const st = await (await tsFetch('/state', {}, { readable: true })).json();
  for (const m of [st.remoteMetadata, st.localMetadata, st.metadata]) {
    if (!m || typeof m !== 'object' || m.artistName === 'tune·fied' || m.serviceName === 'tune·fied') continue;
    if (!m.trackName && !m.albumName) continue;
    // Any picture address it includes (the name of the field isn't documented).
    const art = Object.entries(m).find(([k, v]) => typeof v === 'string' && /^https?:\/\//.test(v) && /art|image|cover|url/i.test(k))?.[1] || '';
    return { track: m.trackName || '', artist: m.artistName || '', album: m.albumName || '', service: m.serviceName || '', art };
  }
  return null;
}

// A picture from the web, readable by the page (it needs CORS too).
async function loadCover(url) {
  if (location.protocol === 'https:' && url.startsWith('http:')) url = `https:${url.slice(5)}`;
  const r = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return createImageBitmap(await r.blob());
}

// Music catalogues answer web pages through JSONP (a script that calls us
// back), since they don't send CORS headers for their search.
function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = `tunefied${Date.now()}${(Math.random() * 1e6) | 0}`;
    const s = document.createElement('script');
    const done = () => {
      clearTimeout(timer);
      delete window[cb];
      s.remove();
    };
    const timer = setTimeout(() => (done(), rej(new Error('no answer'))), 9000);
    window[cb] = (data) => (done(), res(data));
    s.onerror = () => (done(), rej(new Error('search failed')));
    s.src = `${url}&callback=${cb}`;
    document.head.append(s);
  });
}

async function searchAlbums(q) {
  const [apple, deezer] = await Promise.allSettled([
    jsonp(`https://itunes.apple.com/search?${new URLSearchParams({ term: q, media: 'music', entity: 'album', limit: 8 })}`),
    jsonp(`https://api.deezer.com/search/album?${new URLSearchParams({ q, limit: 8, output: 'jsonp' })}`),
  ]);
  const out = [];
  for (const r of apple.value?.results || []) {
    if (r.artworkUrl100) out.push({ album: r.collectionName, artist: r.artistName, thumb: r.artworkUrl100, art: r.artworkUrl100.replace('100x100bb', '600x600bb'), from: 'Apple' });
  }
  for (const r of deezer.value?.data || []) {
    if (r.cover_medium) out.push({ album: r.title, artist: r.artist?.name || '', thumb: r.cover_medium, art: r.cover_xl || r.cover_big || r.cover_medium, from: 'Deezer' });
  }
  return out;
}

// The cover for a song: the address the Tuneshine gave, its own /artwork
// (only while it's showing the music, not something we sent), then the
// catalogues. null if none can be read.
async function coverFor(meta) {
  const tries = [];
  if (meta.art) tries.push(() => loadCover(meta.art));
  if (!TS.ours) tries.push(async () => createImageBitmap(await (await tsFetch('/artwork', {}, { readable: true })).blob()));
  tries.push(async () => {
    for (const r of await searchAlbums(`${meta.artist} ${meta.album || meta.track}`)) {
      try {
        return await loadCover(r.art);
      } catch {}
    }
    throw new Error('no cover found');
  });
  for (const t of tries) {
    try {
      return await t();
    } catch (err) {
      console.warn('cover:', err.message);
    }
  }
  return null;
}

// "Get what's playing": find it and show the remix (sending is up to you).
async function getNowPlaying() {
  if (!TS.connected) return status('Connect your Tuneshine first, or find an album below.', 'bad');
  ui.nowBtn.disabled = true;
  status('Asking your Tuneshine what’s playing…');
  try {
    let meta;
    try {
      meta = await nowPlaying();
    } catch {
      ui.q.focus();
      return status('Your Tuneshine doesn’t tell web pages what’s playing. Find the album below instead.', 'bad');
    }
    if (!meta) return status('Nothing’s playing right now.');
    status(`Finding the cover for ${meta.track || meta.album}…`);
    const bmp = await coverFor(meta);
    if (!bmp) {
      ui.q.value = `${meta.artist} ${meta.album || meta.track}`.trim();
      searchUi();
      return status('Couldn’t get that cover. Pick one below, or drop a cover image here.', 'bad');
    }
    album.key = `${meta.track}|${meta.artist}|${meta.album}`;
    setAlbum(bmp, meta);
    status(`Remixed ${albumTitle()}. Send it when you like it.`, 'good');
  } finally {
    ui.nowBtn.disabled = false;
  }
}
ui.nowBtn.addEventListener('click', getNowPlaying);

// ---- Follow the music ----

async function followTick() {
  if (!album.following) return;
  try {
    let meta;
    try {
      meta = await nowPlaying();
    } catch {
      stopFollowing();
      return status('Your Tuneshine doesn’t tell web pages what’s playing, so it can’t be followed. Find albums below instead.', 'bad');
    }
    const key = meta ? `${meta.track}|${meta.artist}|${meta.album}` : '';
    if (meta && key !== album.key && !busy) {
      album.key = key;
      status(`New song: ${meta.track || meta.album}. Remixing…`);
      const bmp = await coverFor(meta);
      if (bmp && album.following) {
        setAlbum(bmp, meta);
        await sendOrSave(true, true);
      } else if (!bmp) status(`Couldn’t get the cover for ${meta.track || meta.album}. Still following.`, 'bad');
    }
  } finally {
    if (album.following) album.timer = setTimeout(followTick, 5000);
  }
}

function startFollowing() {
  if (!TS.connected) {
    ui.follow.checked = false;
    return status('Connect your Tuneshine first.', 'bad');
  }
  clearTimeout(backTimer); // no countdown while following
  album.following = true;
  album.key = ''; // send the current song straight away
  status('Following the music: each new song gets remixed and sent.', 'good');
  followTick();
}

function stopFollowing() {
  if (!album.following) return;
  album.following = false;
  ui.follow.checked = false;
  clearTimeout(album.timer);
}
ui.follow.addEventListener('change', () => (ui.follow.checked ? startFollowing() : (stopFollowing(), status('Stopped following. The last remix stays until you press ⏹ Back to the music.'))));

// ---- Find an album ----

async function searchUi() {
  const q = ui.q.value.trim();
  if (!q) return;
  ui.results.innerHTML = '<p class="hint">Searching…</p>';
  const found = await searchAlbums(q);
  if (!found.length) {
    ui.results.innerHTML = '<p class="hint">Nothing found (or the catalogues didn’t answer).</p>';
    return;
  }
  ui.results.replaceChildren(...found.map((r) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'result';
    b.title = `${r.album} · ${r.artist} (${r.from})`;
    const img = document.createElement('img');
    img.src = r.thumb;
    img.alt = '';
    img.loading = 'lazy';
    const name = document.createElement('span');
    name.textContent = r.album;
    const by = document.createElement('small');
    by.textContent = r.artist;
    b.append(img, name, by);
    b.addEventListener('click', async () => {
      status(`Getting the cover for ${r.album}…`);
      try {
        setAlbum(await loadCover(r.art), { album: r.album, artist: r.artist });
        stopFollowing();
        status(`Remixed ${albumTitle()}. Send it when you like it.`, 'good');
      } catch {
        status(`${r.from} won’t let web pages remix that cover. Try another result, or save the cover and drop it here.`, 'bad');
      }
    });
    return b;
  }));
}
ui.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  searchUi();
});

// A cover image of your own.
async function albumFromFile(f) {
  try {
    setAlbum(await createImageBitmap(f), { album: f.name.replace(/\.[^.]+$/, '') });
    status(`Remixed ${albumTitle()}. Send it when you like it.`, 'good');
  } catch {
    status('Couldn’t read that picture.', 'bad');
  }
}
ui.albumFile.addEventListener('change', () => {
  if (ui.albumFile.files[0]) albumFromFile(ui.albumFile.files[0]);
  ui.albumFile.value = '';
});

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
  const f = e.dataTransfer.files[0];
  if (!f?.type.startsWith('image/')) return;
  if (mode === 'album') return albumFromFile(f);
  setMode('picture');
  loadPicture(f);
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
  stopFollowing();
  status(`Sending “${it.name}”…`);
  try {
    await tsUpload(it.blob, it.name);
    status(`“${it.name}” is on the Tuneshine.${armBack()}`, 'good');
  } catch (err) {
    status(`Couldn’t send it: ${err.message}`, 'bad');
  }
}

// ---- Modes --------------------------------------------------------------------------

let mode = 'album';
const MODES = {
  album: { ready: () => !!album.bmp, render: renderAlbum, send: '📤 Send the remix', save: '💾 Save', notReady: 'Get what’s playing, or find an album first.' },
  picture: { ready: () => pic.frames.length > 0, render: renderPicture, send: '📤 Send', save: '💾 Save', notReady: 'Choose a picture first.' },
  text: { ready: () => true, render: renderText, send: '📤 Send', save: '💾 Save' },
  library: { ready: () => lib.frames.length > 0, render: (c, t) => { c.imageSmoothingEnabled = false; c.drawImage(libFrameAt(t).bmp, 0, 0, LED, LED); } },
};

function setMode(m) {
  mode = m;
  document.querySelectorAll('.tabs [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== m));
  ui.lookBox.hidden = m !== 'album' && m !== 'picture';
  if (!ui.lookBox.hidden) showLook(m);
  syncActions();
  if (m === 'library') libRefresh();
  store.set('mode', m);
}
document.querySelectorAll('.tabs [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

function syncActions() {
  const M = MODES[mode];
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
  const lines = { album: ['PLAY SOME', 'MUSIC'], picture: ['DROP A', 'PICTURE', 'HERE'], library: ['PICK A', 'LOOP'] }[mode] || [''];
  lines.forEach((l, i) => {
    const p = pixelPieces(l);
    const x = Math.round((LED - pixelWidth(p, 1)) / 2);
    drawPixelText(lctx, p, x, 32 - lines.length * 5 + i * 10, 1, (j, px) => `hsl(${(px * 4 + now * 0.05) % 360} 80% 60%)`);
  });
}

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
  if (mode === 'album') {
    // One loop of the remix (a single picture when it's still).
    const P = REMIX_MS[ui.remix.value];
    const lossless = looks.album.style === 'pixels';
    const ms = 80, n = P ? Math.round(P / ms) : 1;
    for (let i = 0; i < n; i++) {
      renderAlbum(wctx, i * ms);
      await grab(lossless, P ? ms : 1000);
    }
    return { frames, durations, title: albumTitle() };
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

// `auto`: sent by Follow the music, which keeps it out of the library and
// doesn't start the countdown back to the music.
async function sendOrSave(send, auto = false) {
  if (busy) return false;
  if (send && !TS.connected) return status('Connect your Tuneshine first.', 'bad');
  busy = true;
  ui.sendBtn.disabled = ui.saveBtn.disabled = true;
  try {
    // Sending something else stops following (it'd be replaced next song).
    if (send && !auto && mode !== 'album') stopFollowing();
    const { frames, durations, title } = await bake();
    const blob = new Blob([animatedWebp(frames, LED, LED, durations)], { type: 'image/webp' });
    const ms = durations.reduce((n, d) => n + d, 0);
    if (send) {
      status('Sending…');
      await tsUpload(blob, title);
      if (auto) {
        status(`Now on the Tuneshine: ${title}.`, 'good');
        return true;
      }
      status(`On the Tuneshine${frames.length > 1 ? `: ${frames.length} frames, ${(ms / 1000).toFixed(1)} s, playing by itself` : ''}. Kept in your library.${album.following ? ' Following the music.' : armBack()}`, 'good');
    } else status('Saved to your library.', 'good');
    await libAdd({ name: title, mode, blob, frames: frames.length, ms });
    return true;
  } catch (err) {
    status(err.message, 'bad');
    return false;
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
  stopFollowing();
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

// ---- Back to the music --------------------------------------------------------------
// ⏹ clears what we sent so the Tuneshine shows your music again, or it can
// happen by itself a while after sending. Following the music stops first,
// and the clear waits for anything still on its way (see tsClear).

let backTimer = 0, backAt = 0;

async function backToMusic(auto = false) {
  clearTimeout(backTimer);
  backAt = 0;
  stopFollowing();
  if (!TS.connected) return status('Connect your Tuneshine first.', 'bad');
  status(auto ? 'Time’s up: handing it back to the music…' : 'Handing it back to the music…');
  const r = await tsClear();
  ui.clearHelp.hidden = r.ok;
  if (r.ok) return status(r.already ? 'It’s already showing your music.' : 'Back to the music.', 'good');
  ui.clearWhy.textContent = r.http ? ` (it answered ${r.http})` : '';
  ui.clearCmd.textContent = tsClearCommand();
  status('Couldn’t clear it from here: see below.', 'bad');
}

// After a send, start the countdown (if one's chosen). Returns a note for
// the status line.
function armBack() {
  clearTimeout(backTimer);
  const min = +ui.backAfter.value;
  backAt = min ? Date.now() + min * 60000 : 0;
  if (!min) return '';
  backTimer = setTimeout(() => backToMusic(true), min * 60000);
  return ` Back to the music in ${min === 60 ? '1 hour' : `${min} min`}.`;
}

ui.clearBtn.addEventListener('click', () => backToMusic());
ui.backAfter.value = String(store.get('backAfter', 0));
ui.backAfter.addEventListener('change', () => {
  store.set('backAfter', +ui.backAfter.value);
  if (backAt) status(armBack().trim() || 'It’ll stay until you press ⏹.');
});
ui.copyCmd.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ui.clearCmd.textContent);
    ui.copyCmd.textContent = 'Copied';
  } catch {
    getSelection().selectAllChildren(ui.clearCmd);
    ui.copyCmd.textContent = 'Press ⌘C';
  }
  setTimeout(() => (ui.copyCmd.textContent = 'Copy'), 1600);
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

setMode(MODES[store.get('mode')] && store.get('mode') !== 'library' ? store.get('mode') : 'album');
requestAnimationFrame(preview);
libRefresh();
ui.host.value = store.get('host', '');
if (ui.host.value) connect(); // straight back to your Tuneshine
window.tunefiedReady = true;
