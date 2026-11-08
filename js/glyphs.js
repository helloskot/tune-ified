'use strict';

// Emoji palettes: every emoji in a set is drawn once into a sprite atlas and
// measured for its average colour, so each cell of the picture can be
// matched to the emoji that looks most like it. (From emoji·fied.)

const EMOJI_SETS = {
  rainbow:
    '🟥🟧🟨🟩🟦🟪🟫⬛⬜🔴🟠🟡🟢🔵🟣🟤⚫⚪❤️🧡💛💚💙💜🤎🖤🤍🔶🔷💠🌈',
  faces:
    '😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😋😛😜🤪🤨🧐🤓😎🥸🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿👹👺🤡💩👻💀👽👾🤖🎃',
  food:
    '🍎🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🫑🌽🥕🧄🧅🥔🍠🥐🥯🍞🥖🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🌮🌯🥗🍝🍜🍣🍤🍙🍚🍘🍥🥮🍡🍦🍧🍨🍩🍪🎂🍰🧁🥧🍫🍬🍭🍮🍯🥛☕🍵🧃🥤🧋🍺🍷',
  nature:
    '🌲🌳🌴🌵🌾🌿☘️🍀🍁🍂🍃🌸🌺🌻🌼🌷🌹🥀🍄🌰🐚🪨🌊💧🔥⭐🌟✨🌙☀️☁️⛅🌈❄️⚡🌍🌕🌑🪐',
  animals:
    '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🦆🦅🦉🐺🐗🐴🦄🐝🐛🦋🐌🐞🐢🐍🦎🐙🦑🦐🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦛🦏🐪🦒🦘🐃🐄🐎🐖🐏🐑🦙🐐🦌🐕🐩🐈🐓🦃🦚🦜🦢🦩🕊️🐇🦝🦨🦡🦫🦦🦥🐁🐀🐿️🦔',
  hearts: '❤️🧡💛💚💙💜🤎🖤🤍🩷🩵🩶💖💗💓💞💕💘💝❣️',
};
EMOJI_SETS.everything = Object.values(EMOJI_SETS).join('');
// Map pieces, for the topo map (not part of Everything).
EMOJI_SETS.terrain = '🌊💧🐳🏝️🏖️🌾🌿🍀🌳🌲🌴🍂🪵🪨🏜️⛰️🏔️🗻❄️☁️🤍';

// Sets where colour matching would collapse to a single hue.
const PREFERS_BRIGHTNESS = new Set(['faces']);

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const segmenter = 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
function graphemes(str) {
  return segmenter ? Array.from(segmenter.segment(str), (s) => s.segment) : Array.from(str);
}

// Built at runtime: an unsupported \p{...} in a regex literal is a parse-time
// SyntaxError that would stop the whole script from loading.
const EMOJI_RE = (() => {
  try {
    return new RegExp('\\p{Extended_Pictographic}|\\p{Regional_Indicator}', 'u');
  } catch {
    return /[☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/;
  }
})();

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Draw each emoji into an atlas and measure it. Colour is the emoji's
// average over black, i.e. what its cell looks like from a distance.
function buildEmojiPalette(chars) {
  const glyphs = [...new Set(graphemes(chars).filter((g) => g.trim()))];
  const cw = 48, ch = 48;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(glyphs.length)));
  const measure = document.createElement('canvas');
  measure.width = perRow * cw;
  measure.height = Math.ceil(glyphs.length / perRow) * ch;
  const a = measure.getContext('2d', { willReadFrequently: true });
  a.textAlign = 'center';
  a.textBaseline = 'middle';
  a.font = `${Math.round(ch * 0.82)}px ${EMOJI_FONT}`;
  let entries = glyphs.map((glyph, i) => {
    const sx = (i % perRow) * cw, sy = Math.floor(i / perRow) * ch;
    a.fillText(glyph, sx + cw / 2, sy + ch / 2 + ch * 0.04);
    const d = a.getImageData(sx, sy, cw, ch).data;
    let r = 0, g = 0, b = 0, cov = 0;
    for (let p = 0; p < d.length; p += 4) {
      const al = d[p + 3] / 255;
      r += d[p] * al;
      g += d[p + 1] * al;
      b += d[p + 2] * al;
      cov += al;
    }
    const n = cw * ch;
    r /= n; g /= n; b /= n;
    return { glyph, sx, sy, r, g, b, lum: luma(r, g, b), density: cov / n };
  });
  // Drop emoji this computer can't draw.
  entries = entries.filter((e) => e.density > 0.02);
  // Draw from a normal canvas: one read back for measuring is slow to draw from.
  const atlas = document.createElement('canvas');
  atlas.width = measure.width;
  atlas.height = measure.height;
  atlas.getContext('2d').drawImage(measure, 0, 0);
  return {
    atlas, cw, ch, entries,
    byLum: [...entries].sort((x, y) => x.lum - y.lum),
    lut: new Int16Array(1 << 15).fill(-1),
  };
}

const palettes = new Map();
function getPalette(chars) {
  if (!palettes.has(chars)) palettes.set(chars, buildEmojiPalette(chars));
  return palettes.get(chars);
}

// Weighted RGB distance ("redmean"), cheap and perceptually decent.
function colorDist(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

// The nearest emoji by colour, remembered on a 15-bit quantised RGB key.
function nearestEmoji(pal, r, g, b) {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  let idx = pal.lut[key];
  if (idx >= 0) return pal.entries[idx];
  const qr = ((r >> 3) << 3) + 4, qg = ((g >> 3) << 3) + 4, qb = ((b >> 3) << 3) + 4;
  let best = Infinity;
  pal.entries.forEach((e, i) => {
    const d = colorDist(qr, qg, qb, e.r, e.g, e.b);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  pal.lut[key] = idx;
  return pal.entries[idx];
}
