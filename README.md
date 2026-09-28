# Tenebrae

A single-file browser studio for designing **two-shell perforated shadow lamps**: nested cylinders or spheres, turning around one LED, that project moiré patterns onto the ceiling and walls. It exports watertight STLs ready to print.

**[Open the studio](https://knnurl.github.io/tenebrae-studio/)**

**[Read the tutorial](https://knnurl.github.io/tenebrae-studio/tutorial.html)**

![Tenebrae showing a table uplight throwing radiating slot shadows across a ceiling](docs/img/hero.jpg)

Light reaches the room only where both shells are open along the ray from the LED, so the room sees the product of two masks. Detune the outer shell's count against the inner one and the room shows travelling moiré lobes; twist one shell by a few degrees and they sweep all the way round.

---

## Features

**Guided design**
- Sidebar in decision order: Lamp, Target, Light, Shells, Pattern, Moiré, Motion, Make. Each step's header shows its current choice.
- Basic level shows the 23 controls that shape the look; Advanced shows all of them.
- Decisions set their knock-on settings and say so: choosing a target sets the emitter direction and caps; choosing a mount sets the light height.
- The outer shell can be fitted automatically from the inner shell and one gap, around the wall and above the cap.

**Pattern engine**
- Five generators: slots and spirals, rings and waves (with bridges), phyllotaxis dots, Voronoi cells, superformula lattice.
- Linked mode copies the inner pattern to the outer shell with a count detune, and optional mirror.
- Patterned flat top caps. The cap can continue the wall pattern (spokes line up with slots, dots keep their spacing) or carry its own.
- Randomize with per-slider locks and undo. It keeps the first of up to ten variations that passes the print checks.
- Thirteen presets, grouped into table uplights, other targets and studies.

**Room preview**
- WebGL2 ray test through all four shell faces and both caps, per pixel.
- Emitter models: ideal point, LED die, filament, frosted bulb, facing all round, up or down. Soft shadows refine progressively.
- Room, wall, ceiling and lamp views, with orbit, pan and zoom. The view re-frames when the lamp or room changes.

**Motion**
- Manual twist with bookmarks and the twist period after which the look repeats.
- Motor mode with per-shell rpm and the resulting speed of the room pattern.

**Fabrication checks**
- Holes cut along rays from the light centre, so wall thickness never narrows the beam.
- Islands with no path to a rim are removed. A pattern that cuts a shell into rings is blocked.
- Thin webs found by morphological opening; holes too small to print anywhere are filled.
- Clearance between shells, radially and between caps; the emitter must fit inside the inner shell.
- FDM and SLS profiles. Spheres can be split at the equator with a solid seam band.

**Export**
- One zip: an STL per shell (or per half), `design.json`, `interface.json` for CAD, `checks.txt`.
- Every mesh is checked edge-manifold, with genus matching its hole count, before it is packed.

---

## Usage

No server and no install at runtime.

```
open index.html
```

Or serve locally if your browser restricts local files:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/
```

The [tutorial](tutorial.html) walks one lamp from the first decision to print files.

---

## Workflow

1. **Lamp:** table lamp or pendant.
2. **Target:** where the pattern lands. This sets which way the emitter faces and whether the shells get top caps.
3. **Light:** emitter type and size. The note gives the smallest opening that stays crisp.
4. **Shells:** inner shape, radius and height; leave the outer shell auto-fitted with a 9 mm gap.
5. **Pattern:** generator and its main sliders. Randomize with locks to explore.
6. **Moiré:** detune the outer shell by 2 or 3 for broad lobes, or pair an independent pattern.
7. **Motion:** manual twist for a hand-turned lamp; bookmark the looks you like.
8. **Make:** FDM or SLS, check the status line, then **Export print files**.

---

## Export format

```
inner-shell.stl     one watertight part (lower/upper halves for split spheres)
outer-shell.stl
design.json         reopen with Open design
interface.json      end diameters, cap planes, hub radius, closest gap,
                    required clearance, twist periods, bookmarks
checks.txt          triangle counts, watertight results, hole and web counts, notes
```

Units are millimetres, with the light centre at the origin and z up. Binary STL runs about 50 MB per million triangles; the default design is about 0.73 M triangles (roughly 36 MB) for both shells at the 0.7 mm grid.

---

## File structure

```
index.html            the studio: built, self-contained, no runtime dependencies
tutorial.html         the tutorial page
src/
  core.js             pattern generators, shell masks, constraints, mesher, STL and zip writers
  state.js            defaults, presets, auto-fit, design loading
  render.js           WebGL2 room and lamp renderer
  ui.js               sidebar, checks, camera, randomize, export
  template.html       page shell and styles
  tutorial.html       tutorial source ({{TOOL}} is replaced at build time)
tools/
  build.js            builds index.html and tutorial.html from src/
  test.js             geometry test harness
docs/img/             screenshots
.github/workflows/
  pages.yml           tests, checks index.html is up to date, deploys to GitHub Pages
```

`index.html` is monolithic on purpose, so it can be dropped anywhere and opened directly. Edit `src/`, then rebuild.

---

## Development

```bash
node tools/build.js   # writes index.html and tutorial.html
node tools/test.js    # exits non-zero on any failure
```

The harness builds every preset's shells, whole and split, and checks that each mesh is edge-manifold with genus equal to (open ends − 1) + holes. It also checks volumes against analytic values for blank shells, ray alignment of hole walls, cap planes, clearance and collision detection, auto-fit gaps, twist periods, STL size and the zip structure.

For headless screenshots, `index.html?frames=N` caps soft-shadow refinement at N frames.

---

## Fabrication notes

- **Print coupons first:** flat plates 3 and 4 mm thick with 2–10 mm slot and hole ladders, lit by the real LED. They settle the true blur, which holes survive and how much the material leaks.
- **Crispness:** keep openings at least 5× the emitter. On the default shells, 20–24 slots give crisp rays with a 1.4 mm die; the default 36 give softer, finer rays.
- **Material:** matte black PETG or ASA. PLA softens around 60 °C, and light colours glow.
- **FDM:** print capped cylinders cap-down; no supports needed. Slots on vertical walls print cleanly. Rings and dots leave overhanging hole tops (no teardrop shaping yet). Split spheres throw a dark ring from the seam band; spheres suit SLS better.
- **Light:** Luminus SST-20 2700K CRI 95 on a 10 mm copper board, on an aluminium stem at the shell centre (±3 mm). Mean Well LDD-700L at 350–700 mA from a certified 24 V adapter, dimmed with its analogue input to avoid PWM flicker on moving shadows.
- **Twist:** run the outer shell's bottom rim on a printed V-groove race with 6 mm BBs, with felt drag. Put rim ticks at quarters of the twist period shown in the Motion step.

## Known limits

- Bottom caps aren't built yet, so open bottoms throw a bright disc.
- The preview shows direct light only; use ambient fill to approximate room bounce.
- Hole walls aren't drawn in the lamp close-up. The room projection is exact.
- The wall-to-cap corner has a chamfer of up to one grid cell.

---

## License

MIT. See [LICENSE](LICENSE).
