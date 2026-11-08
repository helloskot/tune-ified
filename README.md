# tune·fied

Make things for your **Tuneshine** (the 64×64 LED display that shows album
art) and send them to it: your camera as emoji, pictures and GIFs, scrolling
pixel text, a clock, and a library of everything you've made. A sibling of
[emoji·fied](https://helloskot.github.io/emoji-fied/), sharing its emoji
palettes, topo map and look.

Live at **https://helloskot.github.io/tune-ified/** (once GitHub Pages is on).

## What you need

- A Tuneshine with firmware **2.3.0 or later** (that's when it got a local
  API), on your Wi-Fi.
- **Chrome or Edge on a computer** on the same Wi-Fi. The page is https and
  the Tuneshine is plain http on your network. Chrome and Edge allow that
  after asking to reach devices on your local network. Safari, Firefox,
  iPhone and iPad don't.
- On a Mac, Chrome also needs to be on in **System Settings → Privacy &
  Security → Local Network**.

## Connecting

Type the Tuneshine's address at the top and press **Connect**. Its name
works best, because it survives the router handing out a new IP. To find
it on a Mac, in Terminal:

```
dns-sd -B _tuneshine._tcp                      # lists it, e.g. "Tuneshine 20B4" (Ctrl-C to stop)
dns-sd -L "Tuneshine 20B4" _tuneshine._tcp     # "…can be reached at tuneshine-20b4.local.:80"
```

The address is remembered, and the page reconnects by itself next time.

## Modes

- **📷 Camera**: your camera, a video file or a shared screen or tab,
  cropped square (with zoom). **▶ Go live** streams it. **Smooth** (the
  default) sends half-second animated clips while the next one records, so
  the Tuneshine plays every frame, about half a second behind. **Instant**
  sends one picture at a time, the next as soon as the last arrives: less
  delay, but the round trip limits the frame rate. Speed goes up to
  30 fps. **📤 Send a loop** records 2–8 seconds (up to 60 frames) that
  keep playing on the Tuneshine after you close the page.
- **🖼 Picture**: drop any image or GIF (animated WebP and PNG too). Fill
  the square or fit it all in, zoom, and set the animation speed.
  Animations keep their own timing, up to 150 frames.
- **Look** (camera and picture each keep their own):
  - **Style:** emoji (Everything, Rainbow, Faces, Food, Nature, Animals,
    Hearts, Terrain), **LED dots**, or plain **pixels**.
  - **Grid:** 8 × 8 big emoji up to 64 × 64, every LED.
  - **Tuning:** match emoji by colour or brightness; contrast, brightness
    and saturation.
  - **🗺 Topo map:** the picture as a landscape. Sea, land and snow, neon
    contour lines, or a paper survey.
- **🔤 Text**: a message in a crisp **5×7 pixel font**, normal or big, or
  a rounded font. Emoji are welcome. It can scroll, stay still or bounce,
  with 8 colours (rainbow too) and 5 backgrounds. Sending it bakes one
  seamless loop. Still, single-colour text goes as a single picture.
- **🕐 Clock**: digital, digital with the date, or the emoji clock face
  for the time (🕐 … 🕧); 12- or 24-hour, 8 colours. **▶ Start the clock**
  sends a new picture each minute while the page is open.
- **💾 Library**: everything you send or save, kept in this browser (the
  newest 80). Click one to show it on the Tuneshine, ⬇ to download the
  `.webp`, ✕ to delete it.

**Brightness** sets the Tuneshine's brightness.

## Back to the music

A picture you send stays on the Tuneshine until it's cleared.
**⏹ Back to the music** clears it, and the Tuneshine goes back to showing
your music.

- **How it clears:** it stops live sending first and waits for anything
  still on its way to land, so a late clip can't put the picture back.
  Then it sends `DELETE /image` with `{"preserveImage": false}`, so the
  picture isn't kept on screen dimmed.
- **By itself:** set it to go back 1, 5 or 15 minutes, or an hour, after
  sending, or after you stop live. Starting live cancels the countdown,
  and the page needs to stay open.
- **If it can't:** a web page can only send a `DELETE` if the Tuneshine
  allows it (CORS). If it doesn't, the page says so and gives you a
  one-line Terminal command (with a Copy button) that does the same thing.
  Clearing it in the Tuneshine app works too:

```
curl -X DELETE -H 'Content-Type: application/json' -d '{"preserveImage":false}' http://tuneshine-20b4.local/image
```

## How it works

- **Sending:** frames are drawn on a 64×64 canvas and turned into WebP with
  `canvas.toBlob`. That's lossless for text, clocks and pixel art; photos
  are smaller lossy. Animated WebP is put together in JS: a VP8X header
  with the animation flag, an ANIM chunk, and an ANMF chunk per frame. It
  goes to the Tuneshine as `POST /image` (multipart: `image` plus
  `metadata`).
- **Network:** every request says `targetAddressSpace: 'local'`, which
  Chrome needs before an https page may reach an http device on your
  network. Chrome refuses a mismatch outright, so a request is retried once
  without it.
- **Without CORS:** if the Tuneshine doesn't send CORS headers, uploads
  still get through as opaque requests. Clearing it (`DELETE /image`) needs
  CORS; without it, the page tells you to clear it in the Tuneshine app.
- **Files:** no build step, just static files.
  - `js/glyphs.js`: emoji palettes and colour matching, from emoji·fied.
  - `js/look.js`: square crop, adjustments, topo map, emoji, dots and
    pixels.
  - `js/pixelfont.js`: the 5×7 font.
  - `js/tuneshine.js`: the device API and the WebP muxer.
  - `js/app.js`: the modes, live sending, sending and saving, and the
    library.

## Run it

```
python3 -m http.server 8000
```

Then open http://localhost:8000 in Chrome.

Fonts: Bricolage Grotesque and DM Mono (SIL Open Font License), in `fonts/`.
