# Disk Braid Simulator · 盘编模拟器

Preview a kumihimo (組み紐) disk braid before you braid it. Colour the strands on
the disk, choose how the strands move, pick a length, and see the finished cord
in 3D (turn it any way, zoom in, or coil the whole rope up), plus a flat,
unrolled chart of its whole surface.

## Run it

It's a static page with no build step. The only dependency is three.js, loaded
from cdnjs for the 3D view; without it (or without WebGL) the page falls back
to a simpler 2D cord view.

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
4. **Movement rule (编织动作):** pick a rule or build your own. Each move is
   *take this strand* (top-left, top-right, bottom-left or bottom-right),
   *go this way* (clockwise or counter-clockwise), *this far* (next dot, skip one
   dot, … opposite dot), and whether to *stop at the pair* it reaches or *lay it
   past the pair*, crossing over it. After the moves, turn the disk. A rule can have several
   different steps that repeat in order, each done once, a few times, or once
   per dot. The editor says how many strands each move passes over, and warns
   when a move never crosses anything (it won't lock into the braid), finds its
   pair empty, or when some strands never move at all (they'd be buried inside
   the cord, so their colour wouldn't show; they're circled on the disk).
5. **Walk through it:** under the disk, ▶ does the next step: the strands move
   along numbered arrows and the disk turns, with the instructions written out.
   Play keeps going; ◀ and ⏮ go back. Follow along on a real disk to check the
   rule matches what your hands do.
6. **Preview:** drag the cord to turn it any way, scroll or pinch to zoom.
   *Close-up* starts at the newest end, *Whole rope* stands the full length
   upright, and *Coiled* lays it in a flat spiral so a long rope (up to 150
   rounds) fits on screen. *Look along the cord* slides the close-up along it. *Copy pattern* copies a link (or, when the
   page is embedded, a short code) that *Load pattern* reads back, so you can
   send a design to someone. *Save image* shows the cord as a PNG to save.

Strands are labelled the way hand-written notes usually do it. The disk is split
into a left and a right half. R1 is the first strand clockwise from 12 o'clock
and L1 is the first counter-clockwise, counting down each side, so Li and Ri
are mirror images.

## What it simulates

Strands sit in pairs, one pair per dot. The standard rule is **Kongo Gumi**
(金剛組), the usual round braid on a 32-slot disk:

1. Take the bottom-right strand up to the right of the top pair.
2. Take the top-left strand down to the left of the bottom pair.
3. Turn the disk so the next pair is at the top.

Other presets: the mirrored version (spirals the other way), *next dot*, *skip
one dot*, and rules that switch between two kinds of move each round. Any rule
can be edited.

A moved strand lands on the side of its new pair it arrives from, unless the
move says to lay it past the pair. Each move
lays one visible stitch on the cord, on the side the strand travelled past. The
simulator follows every strand through every move, so it knows which colour
each stitch is, and where and when it was laid. That colour sequence is exact.

The picture is a model. Each spot on the cord shows the stitch nearest to it,
with stitches stacked along the line of earlier stitches laid at the same place.
How steeply they lean depends on materials and tension, so it's adjustable under
**Advanced → Cord twist**. The default is set so the classic beginner layout
(colour A on the N and S dots, B on E and W) comes out as the familiar
two-colour spiral. If a real braid spirals more or less steeply than the
preview, change the twist to match it. Twist moves stitches around the cord; it
never changes their colours. Rules other than Kongo Gumi haven't been checked
against real braids yet.

## Code

| File | What's in it |
| --- | --- |
| `src/braid.js` | Disk geometry, strand layout and labels, colour presets |
| `src/rules.js` | Movement rules: presets, simulation, plain-language descriptions |
| `src/pattern.js` | Shareable pattern codes |
| `src/render.js` | Surface texture (colour, height, normals) and the flat chart |
| `src/cord3d.js` | WebGL 3D view (three.js r128 from cdnjs), with a 2D fallback in `render.js` |
| `src/app.js` | UI wiring: disk editor, rule editor, palette, controls |
| `test/` | Engine tests (`npm test`, Node 18+) |

New preset rules go in `RULE_PRESETS` in `src/rules.js`; a test checks every
preset at every strand count for empty pairs and moves that cross nothing.
