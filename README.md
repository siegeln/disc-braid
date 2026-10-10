# Disk Braid Simulator · 盘编模拟器

Preview a kumihimo (組み紐) disk braid before you braid it. Colour the strands on
the disk, pick a length, and see the finished round cord in 3D, plus a flat,
unrolled chart of its whole surface.

## Run it

It's a static page with no build step and no dependencies:

```sh
npm start            # or: python3 -m http.server 8000
# open http://localhost:8000
```

You need a local server because browsers won't load ES modules from `file://`.
Any static host works too (for example GitHub Pages).

## Using it

1. **Strands (股数):** 8 to 32, in multiples of 4. 8, 12, 16 and 24 are the
   usual counts.
2. **Paint strands:** pick a colour, then tap or drag across the strands on the
   disk. Tap a dot's number to paint both strands of that pair. Editing a
   swatch's colour changes it everywhere it's used.
3. **Layouts (布线):** start from a preset (spiral, single spiral line, split
   pairs, mirror stripes …). Colours **A** and **B** are the first two swatches.
   `Mirror R → L` copies R1…Rn onto L1…Ln for symmetric designs (镜像排布).
4. **Preview:** turn or spin the cord. *Copy pattern* copies a link (or, when the
   page is embedded, a short code) that *Load pattern* reads back, so you can
   send a design to someone. *Save image* shows the cord as a PNG to save.

Strands are labelled the way hand-written notes usually do it. The disk is split
into a left and a right half. R1 is the first strand clockwise from 12 o'clock
and L1 is the first counter-clockwise, counting down each side, so Li and Ri
are mirror images.

## What it simulates

**Kongo Gumi** (金剛組), the standard round braid on a 32-slot disk. Each step:

1. Take the bottom-right strand up to the right of the top pair.
2. Take the top-left strand down to the left of the bottom pair.
3. Turn the disk so the next pair is at the top.

Each move lays one visible stitch on the cord, on the side the strand crossed
over. The simulator follows every strand through every move, so it knows which
colour each stitch is, and where and when it was laid. That colour sequence
is exact. One consequence: strands at a dot only ever swap with the dot opposite.

How steeply the stitches lean on the finished cord depends on materials and
tension, so it's adjustable under **Advanced → Cord twist**. The default is set
so the classic beginner layout (colour A on the N and S dots, B on E and W)
comes out as the familiar two-colour spiral. If a real braid spirals more or
less steeply than the preview, change the twist to match it. Twist moves
stitches around the cord; it never changes their colours.

## Code

| File | What's in it |
| --- | --- |
| `src/braid.js` | Pure braid engine: moves, strand layout and labels, presets, share links |
| `src/render.js` | Canvas renderers: 3D cord and unrolled surface |
| `src/app.js` | UI wiring: disk editor, palette, controls |
| `test/` | Engine tests (`npm test`, Node 18+) |

Other braid structures (Yatsu Gumi, flat braids, Kongoh Gaeshi zig-zag …) can be
added as another `simulate…` function that returns stitches in the same format.
