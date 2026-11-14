# Galileo FOC — procedural model spike (v2, refinement pass)

## Files

- **`galileo_foc.glb`**: 1,346,164 bytes (1.28 MB), 12,472 triangles, 18 meshes, 18 materials, 8 generated PNG textures (the largest is 1024×1024).
- **`scripts/build.py`** (v2) builds the model, exports the glb and renders the views. Run it with `Blender -b --factory-startup -P scripts/build.py -- --root . [--render] [--views 01,06] [--samples 64]`.
  - The generated textures are also written to `textures/` for inspection.
  - `scripts/build_v1.py` is the first-round version, kept for reference.
- **`scripts/verify.py`** re-imports the glb into an empty scene. It prints the triangle count, meshes, bounding box and size, plus the raw glTF node and mesh bounds. With `--render`, it also renders the re-imported model.
- **Measurement tooling (read-only on photos):**
  - `scripts/exif_focal.py` reads EXIF focal lengths (stdlib only, run with `python3 -I`).
  - `scripts/gridcrop.py` makes gridded crops of photos so pixel coordinates can be read off.
  - `scripts/photo_geometry.py` holds the measured image points and the pinhole/PnP solver.
  - `scripts/measure_yoke.py` produces the yoke measurement.
- **`scripts/compare.py`** builds the comparison sheets: the photo on the left, a render of the glb from a matched camera on the right. These sheets are for internal review only, and no photo pixel goes into the model.
- **`scripts/render_setup.py`** holds the shared render setup.
- **`renders/`** (JPEG, 1200×750):
  - `01_earth_face.jpg`, `02_side_span.jpg`, `03_three_quarter.jpg`, `04_anti_earth.jpg`, `05_bus_closeup.jpg`, `06_yoke_closeup.jpg`, `07_wing_back.jpg`.
  - `90_reimport_check.jpg`.
- **`_refs/galileo-foc/`** holds downloaded pages and photos, gridded crops derived from them, and the internal photo comparison sheets (`compare_phenix_earth_face.png`, `compare_wing_side_view.png`, `compare_wing_deploy_2013.png`). These are references only.

## 1. Axes and origin (unchanged convention)

The Blender body frame uses the orientation of the GSC/OHB mechanical frame:

| Axis | Direction |
|---|---|
| **+Z** | Navigation antenna boresight (Earth-facing panel). |
| **+Y** | Solar-array rotation axis. |
| **+X** | Normal to the clock panel (the deep-space side). |

The axes are right-handed.

- **IGS/ANTEX frame:** `X_IGS = −X`, `Y_IGS = −Y`, `Z_IGS = Z` (a 180° turn about Z).
- **Origin:** the centre of the bus box. `model = GSC_mech − (0.415, 0, 0.550) m`.

After glTF export (Blender defaults, +Y up), glTF (x, y, z) = body (x, z, −y):

| Body axis | glTF axis |
|---|---|
| +X | **+X** |
| +Y | **−Z** |
| +Z (nadir/boresight) | **+Y** |

This was verified from the accessor bounds in the exported file.

- **Wing nodes:** `solar_wing_+Y` and `solar_wing_-Y` keep identity rotation. Their origins sit on the SADM axis.
  - glTF translations are now **(0.10, 0, −0.60)** and **(0.10, 0, +0.60)**. The X offset is new: the SADM position was measured at body x ≈ +0.10 m.
  - A right-handed rotation θ about body +Y (glTF −Z) on that node is the solar-array angle.
  - In the default pose the cell side faces body −X (+X_IGS).
- **CesiumJS** (derived from `ModelUtility.getAxisCorrectionMatrix`, not tested): with the default up = Y and forward = Z, Cesium model space = body (y, −x, z). Load with `forwardAxis: Axis.X` to get the body frame directly.
- **Normal maps:** they are exported as `normalTexture` without TANGENT attributes. CesiumJS should derive tangents itself; confirm this in the app.

## 2. What changed in v2

1. **Yoke: measured, not derived.** The method is in §3.
   - New shape, copied from the ESA "Attachment of solar wing" (2017) and "Side view of deployed wing" (2017) photos:
     - the SADM on the ±Y face;
     - a bronze root hinge bracket with two spring/damper canisters;
     - one flat orange bar, 85 mm wide (in the wing plane) × 30 mm thick, with grey bolted splice plates at both ends;
     - a 0.70 m tapered T-crossbar plate along the panel width;
     - a grey hinge fitting with spring units at the panel root;
     - two groups of gold flex-harness straps from the crossbar to the panel.
   - The previous V-strut yoke was invented and has been removed.
2. **Solar wings.**
   - **Hinge gap:** 75 mm, measured. The previous value was 20 mm.
   - **Panel position:** the panels are now centred on the yoke and SADM axis.
   - **Front texture:** a 1024² atlas that copies the ESA side-view photo panel by panel.
     - **Cells:** 4 × 7.6 cm cut-corner cells, near-black indigo, with faint interconnect dashes.
     - **Rows:** 11 rows in 2/7/2 groups, separated by two olive-brown substrate strips (≈ 8.5 cm).
     - **Harness gap:** a vertical gap down each panel's middle with gold harness and tie points.
     - **Blanks and inserts:** the outer panel has white cell-free blanks with round inserts at the photographed positions; the inner panel has inserts only.
     - **Edges:** gold harness with tie points along the short edges, and a black edge frame.
   - **Rear texture:** dark charcoal CFRP with black cable runs, red tie points, orange-red connector patches and inserts. It is copied from ESA "Dark side of Galileo's solar wing".
   - **Hardware:** two hinge brackets and gold flex straps across the gap, and a tip snubber bracket.
3. **Bus blankets.**
   - A new 512 px tiled black-MLI texture: blanket seams with black tape, small brown MLI studs, and gentle wrinkles.
   - A generated normal map (glTF `normalTexture`), plus bevelled, softer box edges.
   - Raised MLI-covered unit boxes on the ±Y upper band and the −X face.
   - All bus blankets stay black: GSC material "A" sits on every face, and every flight-configuration photo shows black.
4. **Earth face** (positions measured on the frontal Phenix photo; sheet `compare_phenix_earth_face`).
   - **Navigation antenna:** Ø1.28 m including the foil (Ø1.16 m before). It overhangs the 1.2 m face as in the photos. It is a crumpled Ge-Kapton foil drum wrapped over the rim, with a foil normal map.
   - **SAR antenna:** an elongated foil-wrapped hexagon, ±0.395 × ±0.585 m. Six gold helix cages sit at the measured positions (0, ±0.52) and (±0.34, ±0.23). It has a white perforated centre disc with a crossed gold feed.
   - **LRR:** silver honeycomb holders (60 CCRs, staggered 6 × 10).
   - **S-band +Z:** moved to the −X edge (−1.20, +0.23) and tilted 45° toward −X (Ø0.11 × 0.20 m).
   - **Small equipment:**
     - The Earth sensor block and the sun-sensor block are at the −X/+Y corner.
     - A small sensor sits between the nav and SAR antennas.
     - A grey EGSE connector panel is new: mesh `egse_connector_panel`.
     - The C-band horn moved next to the LRR on the −Y side, and its top is now dark.
5. **Other faces.**
   - −X: two white coarse sun sensors (from the TVAC photo), a raised MLI unit box and thrusters.
   - ±Y: six orange hold-down/release points per face, at x = −0.75 and +0.39 (measured) and +1.10 (est.), z = +0.33 / −0.35 (measured).
   - The ±Y radiator outlines were re-laid around the measured OSR window (areas still match GSC).
6. **Comparison sheets** (§5). The new mesh is `egse_connector_panel`, and the node structure is otherwise unchanged.

## 3. Yoke measurement and the 14.67 m span

- **Photo 1:** `refs/esa_wing_deploy.jpg` (ESA/ESTEC 2013, Nikon D4, EXIF 24 mm → f = 3285 px).
  - Six wing corners were read off gridded crops: inner edge, hinge and tip, at known s = 0 / 2.5 / 5.075 m and width 1.082 m.
  - Those corners give the wing pose by PnP. The 4-point fit has residuals of 2–4 px.
  - The ray through the yoke root hinge was intersected with the wing centre line.
  - **Result:** root hinge → inner panel edge = **1.40 m** (4-point fit) / **1.57 m** (6-point fit). The hinge lies on the wing axis to within 6–8 cm.
  - **Independent check:** the depth this gives for the root hinge is 7.30 m. The bus face's own pixel scale (1.100 m tall = 500 px) gives 7.23 m. These agree.
- **Photo 2:** `refs/esa_attachment_wing.jpg` (ESA 2017, 24 mm). The crossbar (0.68 m long, measured on the frontal side-view photo) sets the scale near the panel, and the bar's apparent-width ratio gives the depth change along the bar. **Result:** root fitting → T centre ≈ **1.29 m**, with roughly ±15% uncertainty.
- **Photo 3:** `refs/esa_side_view_wing.jpg` (2017, 27 mm, frontal), at 774 px/m in the wing plane:
  - panel length 2.47–2.52 m, confirming 2.5 m;
  - hinge gap **0.075 m**;
  - bar width 85 mm and crossbar length 0.68–0.70 m.
- **Combined:**
  - SADM + root hinge ≈ 0.15–0.25 m out from the bus face.
  - **Bus face → inner panel edge = 1.62 m (±0.1)**, used in the model. The v1 value, derived from the span, was 1.715 m.
  - The OHB CAD/CGI impression of ~0.9 m was wrong; that drawing is schematic.
- **Span reconciliation:**
  - 1.200 (bus) + 2 × (1.62 + 2.5 + 0.075 + 2.5) = **14.59 m** to the panel tips.
  - Adding the tip snubber brackets (≈ 0.04 m each side) gives 14.67 m, which equals the official OHB figure. The model's bounding box Y is exactly 14.670 m.
  - So the official 14.67 m most plausibly runs tip-bracket to tip-bracket and includes the 75 mm hinge gaps. The remaining ≤ 0.08 m sits inside the ±0.1 m per-side measurement error.

## 4. Dimension table

**Official** means a published value. **Derived** means arithmetic on official values. **Measured** means taken from photos with the camera model and EXIF focal length. **Est.** means a judgement from photos.

| Item | Value | Status / source |
|---|---|---|
| Bus box | 2.530 × 1.200 × 1.100 m | official (GSC) |
| Wing | 2 panels of 2.500 × 1.082 m (5.000 × 1.082 per wing) | official (GSC, ESA "1 × 5 m", OHB "2 panels"); panel length confirmed by measurement |
| Hinge gap between panels | 0.075 m | measured (side view) |
| Panel thickness | 0.025 m | measured (tip crop, ≈ 2.5 cm), approx. |
| Bus face → inner panel edge | 1.62 m | measured (2 photos, §3) |
| Span | 14.59 m to the panel tips, 14.67 m including the tip brackets | official 14.67 (OHB); reconciled |
| SADM axis | model x = +0.10, z = 0 (±0.1) | measured (2013 photo) |
| SADM / root hinge length | 0.12 / 0.12 m, SADM Ø0.20 | est. |
| Yoke bar | 85 × 30 mm, ≈ 1.22 m between fittings (root bracket end → T centre 1.26 m; photo 2: ≈ 1.29 m) | width measured; thickness est. |
| T crossbar | 0.70 × 0.10 m, tapered | length measured; width est. |
| Cell size and layout | 4 × 7.6 cm, 11 rows (2/7/2), 2 × 29 columns per panel, strips at t = 0.185–0.268 and 0.8125–0.895 m | measured (side view); 2,552 cell sites per wing pair (ESA: "> 2500 cells") |
| Blanks and inserts on the outer panel | 12 blanks + 6 inserts; inner panel 6 inserts | measured positions (±3 cm) |
| Nav antenna reference point | (140, 0, 1215) mm GSC → model (−0.275, 0, 0.665) | official |
| Nav antenna diameter / height | Ø1.28 m (foil-wrapped), top 0.14 m above the panel | measured (Phenix, 1155 px/m); the official ARP is 0.115 m above the panel |
| LRR reference point / size | (−703, −27.5, 1120.45) mm GSC; 0.253 × 0.350 × 0.0485 m, 60 CCRs | official (GSC, ILRS) |
| LRR distance from the −X end | 0.14 m (centre) | measured (Phenix) → bus X offset 0.415 m (est./measured) |
| SAR antenna | centre x = +0.83; plate ±0.395 (X) × ±0.585 (Y); helices at (0, ±0.52), (±0.34, ±0.23); disc Ø0.36 | measured (Phenix); heights est. |
| S-band +Z | (−1.20, +0.23), tilted 45° toward −X, Ø0.11 × 0.20 m | measured position / tilt from 3 photos; size measured approx. |
| Earth sensor, sun sensors, C-band horn, EGSE panel | see `build.py` | positions measured on Phenix/dispenser photos where visible, else est.; identities partly guessed |
| Hold-down points on ±Y | x = −0.75, +0.39 (measured), +1.10 (est.); z = +0.33, −0.35 | measured (2013 photo) |
| Radiators (OSR) | +Y 1.654, −Y 1.536, +X 0.882, −Z 0.957 m² | areas official (GSC); layout est. from photos |
| Ge-Kapton (B), black MLI (A) | B on the nav and SAR foil, A on everything else | official materials; assignment est. |
| −Z S-band, thrusters, launcher interface brackets | small | est. / placeholder |
| Overall bounding box | 2.651 × 14.670 × 1.430 m (body X × Y × Z) | Z exceeds OHB's 1.40 m launch envelope by 3 cm because of the tilted S-band antenna |

## 5. Comparison sheets (left: photo, right: glb render from a matched camera)

All three were rendered under a bright, cleanroom-like grey environment so that colours are comparable.

- **`_refs/galileo-foc/compare_phenix_earth_face.png`**: Phenix chamber 2013, 24 mm, frontal camera from the measured face scale. Wings are hidden because they were not mounted in the photo. Face extent, nav antenna, SAR hexagon and helices, LRR, S-band cylinder and Earth-sensor block line up within a few cm.
- **`_refs/galileo-foc/compare_wing_side_view.png`**: ESA 2017 side view, 27 mm, frontal. Panel extents, strips, blanks, inserts, central harness gap and yoke T line up.
- **`_refs/galileo-foc/compare_wing_deploy_2013.png`**: 2013 deployment, 24 mm.
  - The camera comes from the 6-point wing PnP, and the array angle was fitted (0.5°) from the bus edges.
  - Yellow crosses mark the measured points on both halves; on the render they fall on the wing corners.
  - The bus −X edge and root-hinge marks are within ~60 px (full-res).

## 6. Still different from the real satellite

- **Foil.** The crumpled sunshield is a statistical crumple, not the real fold pattern, and it reads a little "cellular" up close. Real MLI also has tape, vents and loose flaps that are not modelled.
- **Harness.** There is no harness or cable routing on the bus, no thermistors and no grounding straps. The wing-rear cables are generic.
- **Small equipment.** The exact identity and shape of the small Earth-face items (Earth sensor, sun sensors, C-band horn, EGSE panel) are uncertain. Their positions are measured, but their shapes are generic boxes and cylinders.
- **SAR helix cages** are simplified: a 2.5-turn wire on four posts, versus the real birdcage shape.
- **Faces without references.** No usable photo shows the −Z face or the +X (clock) face, so they only carry radiators, blankets and generic parts. The thruster positions are guesses.
- **Radiators.** The OSR mirror tiles have no reflection mapping beyond PBR. The exact radiator outlines are estimated, while the areas are official.
- **Unmeasured hardware.** The SADM and root-hinge dimensions are estimated. Only the overall face-to-panel distance is measured.
- **Panel details.** The panel rear and the white blanks of the inner wing follow one satellite's photos; other flight models may differ in detail.
- **Variants.** Per-satellite variants are ignored.

## 7. Sources

- **GSC Galileo Satellite Metadata:** https://www.gsc-europa.eu/support-to-developers/galileo-satellite-metadata
- **OHB *Galileo FOC Satellites* fact sheet 2019-05:** https://www.ohb-system.de/files/images/mediathek/downloads/190603_OHB-System_Galileo_FOC-Satellites_2019-05.pdf
- **ILRS Galileo mission page:** https://ilrs.dgfi.tum.de/missions/satellite_missions/current_missions/ga05_general.html
- **ESA photos** (layout, colours and measurements only):
  - https://www.esa.int/ESA_Multimedia/Images/2013/12/Sliding_Galileo_out_of_the_Phenix_test_chamber
  - https://www.esa.int/ESA_Multimedia/Images/2013/12/Galileo_emerging_from_TVAC
  - https://www.esa.int/ESA_Multimedia/Images/2013/07/Galileo_FOC_solar_wing_deployment
  - https://www.esa.int/ESA_Multimedia/Images/2017/11/Satellites_and_dispenser
  - https://www.esa.int/ESA_Multimedia/Images/2014/08/Galileos_on_payload_dispenser
- **ESA 2017 wing photos.** The pages have moved; they were retrieved via web.archive.org and the image IDs. The original page URLs are below; the image files are `refs/esa_side_view_wing.jpg`, `refs/esa_attachment_wing.jpg` and `refs/esa_dark_side_wing.jpg`.
  - https://www.esa.int/ESA_Multimedia/Images/2017/07/Side_view_of_deployed_Galileo_solar_wing
  - https://www.esa.int/ESA_Multimedia/Images/2017/07/Attachment_of_solar_wing
  - https://www.esa.int/ESA_Multimedia/Images/2017/07/Dark_side_of_Galileo_s_solar_wing
- **CesiumJS axis correction:** https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/Model/ModelUtility.js
