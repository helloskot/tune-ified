'use strict';

// Talking to a Tuneshine (a 64×64 LED display) over its local HTTP API,
// firmware 2.3.0 and later: GET /state and /health, POST /image with a 64×64
// WebP (an animated one plays by itself), DELETE /image to hand the screen
// back to the music, POST /brightness.
//
// This page is https and the Tuneshine is plain http on the Wi-Fi, which
// only Chrome and Edge allow, after asking to reach local devices. If the
// Tuneshine doesn't let web pages read its answers (no CORS headers),
// uploads still get through as opaque requests; clearing it can't.

const TS = {
  base: '',
  connected: false,
  name: '',
  cors: null, // does it answer web pages? null until known
  tas: null, // does targetAddressSpace work here? null until known
};

// Accepts "192.168.1.42", "tuneshine-20b4.local", "http://…/" and so on.
function tsBase(raw) {
  const host = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return host ? `http://${host}` : '';
}

// fetch, saying the Tuneshine is on the local network (Chrome needs that
// before an https page may reach a plain http device). Chrome refuses the
// request outright if the address is in another space, or an older version
// doesn't know the option, so then it's tried without.
async function tsNet(url, opts) {
  if (TS.tas !== false) {
    try {
      const r = await fetch(url, { ...opts, targetAddressSpace: 'local' });
      TS.tas = true;
      return r;
    } catch (err) {
      if (err.name !== 'TypeError' || TS.tas === true) throw err;
    }
  }
  const r = await fetch(url, opts);
  TS.tas = false;
  return r;
}

// A request to the device: a normal one if it answers web pages, otherwise
// an opaque one (which can deliver but not be checked). `readable` requests
// need a real answer and never fall back.
async function tsFetch(path, opts = {}, { readable = false, timeout = 8000 } = {}) {
  const url = TS.base + path;
  const o = { cache: 'no-store', ...opts };
  if (TS.cors !== false || readable) {
    try {
      const r = await tsNet(url, { ...o, signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { http: r.status });
      TS.cors = true;
      return r;
    } catch (err) {
      if (err.http || readable || TS.cors === true) throw err;
      TS.cors = false;
    }
  }
  return tsNet(url, { ...o, mode: 'no-cors', signal: AbortSignal.timeout(timeout) });
}

// Connect: returns a message for the status line, or throws a friendly error.
async function tsConnect(raw) {
  const base = tsBase(raw);
  if (!base) throw new Error('Type the Tuneshine’s address first');
  Object.assign(TS, { base, connected: false, name: '', cors: null, tas: null });
  try {
    const st = await (await tsFetch('/state', {}, { readable: true })).json();
    TS.connected = true;
    TS.name = st.name || 'your Tuneshine';
    return `${TS.name}${st.firmwareVersion ? ` · firmware ${st.firmwareVersion}` : ''}`;
  } catch {
    try {
      await tsNet(`${base}/health`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      TS.cors = false;
      TS.connected = true;
      TS.name = raw.trim();
      return `${TS.name} (it doesn’t share its name with web pages)`;
    } catch {
      const chromium = !!navigator.userAgentData?.brands?.some((b) => /Chrom|Edge/.test(b.brand));
      throw new Error(chromium
        ? 'Couldn’t reach it. Check the address, that this computer is on the same Wi-Fi, that you allowed local network access, and that Chrome is on in System Settings → Privacy & Security → Local Network.'
        : 'Couldn’t reach it. This browser blocks local devices: use Chrome or Edge on a computer.');
    }
  }
}

// Uploads still on their way, so clearing can wait for them: one landing
// just after the clear would put the picture straight back.
const tsInflight = new Set();

function tsUpload(blob, title = 'tune·fied') {
  const fd = new FormData();
  fd.append('image', blob, 'tunefied.webp');
  fd.append('metadata', new Blob([JSON.stringify({ trackName: title, artistName: 'tune·fied', serviceName: 'tune·fied' })], { type: 'application/json' }));
  const p = tsFetch('/image', { method: 'POST', body: fd });
  tsInflight.add(p);
  p.catch(() => {}).finally(() => tsInflight.delete(p));
  return p;
}

// Hand the screen back to the music: after any uploads in flight land,
// DELETE /image, asking it not to keep the picture dimmed (preserveImage
// false), then plainly. A web page can only send a DELETE if the Tuneshine
// allows it (CORS), so this returns { ok, already, http }.
async function tsClear() {
  await Promise.allSettled([...tsInflight]);
  let http = 0;
  for (const opts of [
    { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preserveImage: false }) },
    { method: 'DELETE' },
  ]) {
    try {
      await tsFetch('/image', opts, { readable: true });
      return { ok: true };
    } catch (err) {
      // Nothing of ours on it: it's already showing the music.
      if (err.http === 404 || err.http === 409) return { ok: true, already: true };
      http = err.http || 0;
    }
  }
  // No status at all: the browser blocked it (no CORS), the usual case.
  return { ok: false, http };
}

// The same clear, as a Terminal command, for when a web page can't.
const tsClearCommand = () => `curl -X DELETE -H 'Content-Type: application/json' -d '{"preserveImage":false}' ${TS.base}/image`;

async function tsBrightness(v) {
  const body = JSON.stringify({ active: v });
  try {
    await tsFetch('/brightness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, { readable: true });
  } catch {
    // Without CORS a JSON request can't be sent; plain text gets through,
    // if the Tuneshine reads it as JSON anyway.
    tsNet(`${TS.base}/brightness`, { method: 'POST', mode: 'no-cors', body }).catch(() => {});
  }
}

// ---- WebP ---------------------------------------------------------------------

// One frame as WebP bytes. Lossless (quality 1) keeps text and pixel art
// crisp and is smaller for flat colours; photos are smaller lossy.
async function webpBytes(canvas, lossless) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', lossless ? 1 : 0.9));
  if (blob?.type !== 'image/webp') throw new Error('this browser can’t make WebP');
  return new Uint8Array(await blob.arrayBuffer());
}

// Mux still WebP frames (as canvas.toBlob makes them) into one animated
// WebP: a VP8X header with the animation flag, an ANIM chunk, then one ANMF
// chunk per frame wrapping that frame's image chunks. `durations` is ms per
// frame (or one number for all); `loops` 0 repeats forever.
function animatedWebp(frames, w, h, durations, loops = 0) {
  if (frames.length === 1) return frames[0];
  const enc = new TextEncoder();
  const u24 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const cat = (parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const chunk = (id, data) => cat([enc.encode(id), new Uint8Array(u32(data.length)), data, new Uint8Array(data.length & 1)]);
  // Keep a still's image data (ALPH, VP8, VP8L); drop its own VP8X and ICCP.
  const imageChunks = (f) => {
    const keep = [];
    for (let o = 12; o + 8 <= f.length;) {
      const id = String.fromCharCode(...f.subarray(o, o + 4));
      const len = f[o + 4] | (f[o + 5] << 8) | (f[o + 6] << 16) | (f[o + 7] << 24);
      const end = o + 8 + len + (len & 1);
      if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') keep.push(f.subarray(o, end));
      o = end;
    }
    return cat(keep);
  };
  const ms = (i) => Math.max(20, Math.round(Array.isArray(durations) ? durations[i] : durations));
  const vp8x = chunk('VP8X', new Uint8Array([0x02, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]));
  const anim = chunk('ANIM', new Uint8Array([0, 0, 0, 255, loops & 255, loops >> 8]));
  // Each frame: at 0,0, full size, its duration, no blending, no disposal.
  const anmf = frames.map((f, i) => chunk('ANMF', cat([new Uint8Array([...u24(0), ...u24(0), ...u24(w - 1), ...u24(h - 1), ...u24(ms(i)), 0x02]), imageChunks(f)])));
  const body = cat([enc.encode('WEBP'), vp8x, anim, ...anmf]);
  return cat([enc.encode('RIFF'), new Uint8Array(u32(body.length)), body]);
}
