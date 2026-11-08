'use strict';

// A classic 5×7 pixel font (ASCII 32-126), for text that stays crisp on
// 64×64 LEDs. Each character is five columns, top row in the lowest bit.
// Emoji in the text are drawn as emoji, one line tall.

const FONT5x7 = [
  '0000000000', '00005f0000', '0007000700', '147f147f14', '242a7f2a12', '2313086462', '3649552250', '0005030000',
  '001c224100', '0041221c00', '14083e0814', '08083e0808', '0050300000', '0808080808', '0060600000', '2010080402',
  '3e5149453e', '00427f4000', '4261514946', '2141454b31', '1814127f10', '2745454539', '3c4a494930', '0171090503',
  '3649494936', '064949291e', '0036360000', '0056360000', '0814224100', '1414141414', '0041221408', '0201510906',
  '324979413e', '7e1111117e', '7f49494936', '3e41414122', '7f4141221c', '7f49494941', '7f09090901', '3e4149497a',
  '7f0808087f', '00417f4100', '2040413f01', '7f08142241', '7f40404040', '7f020c027f', '7f0408107f', '3e4141413e',
  '7f09090906', '3e4151215e', '7f09192946', '4649494931', '01017f0101', '3f4040403f', '1f2040201f', '3f4038403f',
  '6314081463', '0708700807', '6151494543', '007f414100', '0204081020', '0041417f00', '0402010204', '4040404040',
  '0001020400', '2054545478', '7f48444438', '3844444420', '384444487f', '3854545418', '087e090102', '0c5252523e',
  '7f08040478', '00447d4000', '2040443d00', '007f102844', '00417f4000', '7c04180478', '7c08040478', '3844444438',
  '7c14141408', '081414187c', '7c08040408', '4854545420', '043f444020', '3c4040207c', '1c2040201c', '3c4030403c',
  '4428102844', '0c5050503c', '4464544c44', '0008364100', '00007f0000', '0041360800', '0201020402',
].map((h) => Array.from({ length: 5 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16)));

const PIXEL_EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

// Letters with accents fall back to the plain letter; anything else unknown
// becomes '?'.
function pixelGlyph(ch) {
  let c = ch.charCodeAt(0);
  if (ch.length === 1 && c >= 32 && c <= 126) return FONT5x7[c - 32];
  const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  c = plain.charCodeAt(0);
  if (plain.length === 1 && c >= 32 && c <= 126) return FONT5x7[c - 32];
  return null;
}

// Split text into pieces: { glyph } for font characters, { emoji } for the
// rest, each with its width in font pixels (before scaling).
function pixelPieces(text) {
  const parts = typeof graphemes === 'function' ? graphemes(text) : Array.from(text);
  return parts.map((ch) => {
    const glyph = pixelGlyph(ch);
    if (glyph) return { ch, glyph, w: 6 };
    if (EMOJI_RE.test(ch)) return { ch, emoji: true, w: 9 };
    return { ch, glyph: FONT5x7['?'.charCodeAt(0) - 32], w: 6 };
  });
}

const pixelWidth = (pieces, scale) => Math.max(0, pieces.reduce((n, p) => n + p.w, 0) - 1) * scale;

// Draw at (x, y) = top-left, `scale` pixels per font pixel. `color(i, px)`
// gives the colour for piece i at canvas column px (for rainbows and
// waves); `dy(i)` lifts a piece (for bouncing letters).
function drawPixelText(c, pieces, x, y, scale, color, dy = () => 0) {
  let px = Math.round(x);
  pieces.forEach((p, i) => {
    const oy = Math.round(y + dy(i));
    if (px > c.canvas.width || px + p.w * scale < 0) {
      px += p.w * scale;
      return;
    }
    if (p.emoji) {
      const size = 8 * scale;
      c.save();
      c.font = `${Math.round(size * 0.92)}px ${PIXEL_EMOJI_FONT}`;
      c.textBaseline = 'middle';
      c.textAlign = 'center';
      c.fillText(p.ch, px + size / 2, oy + 3.5 * scale + 0.5);
      c.restore();
    } else {
      for (let col = 0; col < 5; col++) {
        const bits = p.glyph[col];
        if (!bits) continue;
        c.fillStyle = color(i, px + col * scale);
        for (let row = 0; row < 7; row++) {
          if (bits & (1 << row)) c.fillRect(px + col * scale, oy + row * scale, scale, scale);
        }
      }
    }
    px += p.w * scale;
  });
}
