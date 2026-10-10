# Tenebrae lamp: FDM print session

Print the two shells of the mirrored-spiral pendant on the Bambu P2S or H2D without the slots spaghettiing.

## Why the last print failed

The slots twist at **1.47°** of azimuth per degree of elevation. On a cylinder, the arms between slots lean at **atan(1 / twist)** from horizontal at lamp height, and more steeply towards the ends:

| Twist | Arm angle at lamp height | Overhangs under 45° (inner / outer) | FDM without supports |
|---|---|---|---|
| 1.47 (current) | 34° | 31 / 31 runs, up to 110 mm wide | Fails |
| 1.2 | 40° | 31 / 31 runs | Fails |
| 1.0 | 45° | 0 | Borderline |
| **0.85** | **50°** | **0** | **Prints** |
| 0 (straight slots) | 90° | 0 | Prints |

FDM can't build a downward-facing edge flatter than about 45° without support. Nothing in the design is flatter than 30°, so resin or SLS would print it as it is.

## Pick a route

| | Route A: lower the twist | Route B: keep twist 1.47 |
|---|---|---|
| Printer | P2S or H2D | **H2D only** (two nozzles) |
| Supports | None | PLA supports with a PETG interface |
| Look | Spiral shadows sweep less; the moiré lobes don't change | Unchanged |
| Risk | Low | Supports inside 62 narrow slots, clean-up |

Don't try Route B on the P2S. Every layer would need two filament swaps, which adds roughly 1 kg of purge and 30+ hours per shell.

## Before the session

- [ ] **Studio version:** open https://knnurl.github.io/tenebrae-studio/ and hard-refresh. You need commit `951f219` or later, which has the overhang check.
- [ ] **Design:** use `design.json` from `~/Downloads/tenebrae-cut-printed-caps-2026-10-02.zip`, the latest version, with top caps only. Load it with **Open design**.
- [ ] **Filament:** black PLA for the body. Grey or light colours glow under the LED and wash out the shadows.
  - Route B also needs Bambu PETG Basic, any colour, for the interface.
- [ ] **Bed:** textured PEI, clean.

### Part sizes, caps attached, printed cap-down

| Shell | Size (3 mm wall) | Size (2 mm wall) | Fits P2S (256³) | Fits H2D, two nozzles (300 × 320 × 325) |
|---|---|---|---|---|
| Inner | 106 × 202 mm tall | 104 × 202 mm | Yes | Yes |
| Outer | 158 × 251 mm tall | 156 × 251 mm | Yes, with only 5 mm of Z to spare | Yes |

The design still has the 3 mm wall from the laser sheet. For FDM, 2 mm is enough and saves about a third of the plastic; set it under Shells.

## Studio steps

1. **Open design:** load the `design.json` above.
2. **Export → Format → 3D print (STL).** The process switches back to FDM, and the toast confirms it.
3. **Route A only:** go to **Pattern** and set **Twist** to **0.85**. In linked mode the outer shell follows.
   - Check the room preview; the lobes should still be there.
4. **Checks table:** **Overhangs under 45°** must read **0 / 0** for Route A.
   - For Route B it will read 31 / 31, which is expected; you'll support them.
   - Teal cells in the mask strip show where the overhangs are.
5. **Export → Caps → Attached → Export print files.** Each shell becomes one STL with its top cap.
   - The outer shell has no bottom cap, so it isn't split.
6. **Checks:** in `checks.txt`, both STLs must read **watertight**.

## Slicer (Bambu Studio)

### Both routes
- **Orientation:** cap down on the plate, open end up. The flat cap needs no support.
- **Layers:** 0.2 mm, 0.4 mm nozzle.
- **Cooling:** keep the defaults "Detect overhang walls" on, slow overhang speeds and full fan on overhangs.
- **Plate:** one shell per plate. Print the inner shell first; it's shorter and cheaper.

### Route A
- Supports **off**.

### Route B (H2D)
Start from [`PETG-interface.3mf`](PETG-interface.3mf) in this folder (also in `~/Downloads`). It is a settings-only Bambu Studio project, with no model, saved for an X1E, so change these:
- [ ] **Printer profile:** Bambu Lab H2D, 0.4 nozzle.
- [ ] **Filaments:** PLA (black) is filament 1, PETG is filament 2. Map them to **different nozzles** so swaps are nozzle switches, not purges.
- [ ] **Support threshold angle:** from **30° to 50°**. At 30° the slicer generates nothing, because the slot ceilings lean 34–40°.
- [ ] **Keep these as in the file:**
  - support type normal (auto), snug;
  - top Z distance 0;
  - support interface filament 2;
  - interface not used for the body;
  - 3 bottom interface layers, so supports standing on the arm below also peel off.
- [ ] **Supports on build plate only:** **off**. The supports have to stand on the arms below.
- [ ] **Preview:** check every slot has support under its upper edge, and that the PETG layers touch the PLA.

## Test ring first (20–30 min)

The flattest arms are at the light's height, so test there.

1. In Bambu Studio, use **Cut** on the inner shell to keep a band about **40 mm tall around the light's plane**. Printed cap down, the light's plane is 119.5 mm above the plate, so keep **100–140 mm above the plate**.
2. Print it with the same settings as the full part.
3. **Route A pass:** slot edges are clean, with no drooping strands and no curled arm tips.
4. **Route B pass:** the supports come out of the slots by hand or with pliers, and the slot ceilings are smooth where the PETG touched.
5. If it fails, see the gotchas below before printing the full shell.

## Full prints

| Shell | Route | Estimate | Notes |
|---|---|---|---|
| Inner | | | |
| Outer | | | |

## Gotchas

- **Twist must stay ≤ 1.00, preferably 0.85, for unsupported FDM.** The studio warns above this, so trust the checks-table row over the preview.
- **After changing the wall thickness,** re-check the "Closest gap between shells" note.
- **The outer shell is 251 mm tall on a 256 mm P2S.** Don't add a raft, and don't scale up.
- **Light colours glow.** Black only, or paint the outside.
- **The PETG-interface threshold is 30° in the file,** which is wrong for this lamp. It must be about 50°.
- **If Route A still droops at 0.85:** slow overhang walls further, or set Twist to 0.7 (55°).
- **Fallbacks if FDM keeps failing:** black tough resin (needs a large plate for the outer shell, about 164 mm on the short side), or MJF/SLS nylon through a service, which handles any twist.

## Session log

| Date | Part | Printer | Route / twist | Settings changed | Result |
|---|---|---|---|---|---|
| | | | | | |
