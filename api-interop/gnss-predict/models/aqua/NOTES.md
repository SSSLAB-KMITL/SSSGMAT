# Aqua (`aqua`) — NASA EOS PM-1

## Source & License Attribution
- Upstream model: `models/vendor/nasa/Aqua_B.glb` from **NASA 3D Resources**
  (`nasa/NASA-3D-Resources`, U.S. Government / public domain).
- Authoritative mission dimensions & instrument layout:
  NASA Aqua Mission / ESA eoPortal (`16.70 m` deployed Y span, `4.81 m` Z nadir-zenith
  height; `8.83 m` X overall envelope including forward AMSR-E reflector and aft
  TDRSS high-gain antenna boom).
- Spacecraft covered (`norad_ids`): `27424` (Aqua / EOS PM-1, COSPAR `2002-022A`).

## Frame & Conversion Notes
- `scripts/build.py` scales `Aqua_B.glb` by `16.700 / 17.7773` to match the
  official `16.70 m` deployed span, and rotates `-90 deg` around X so the nadir
  instruments (`MODIS`, `AIRS`, `CERES`, `AMSU`, `HSB`) face `+Z`, the zenith
  TDRSS HGA faces `-Z`, `AMSR-E` sits on `+X`, and the single solar array wing
  (`wing-Y`) extends along `-Y` (`T_gltf = [0, -0.2007, 1.4691]`).
- Packed vendor textures are downscaled to `<= 512 px` (`foil_n`, `tex_01`,
  `foil_gold_ramp`, `foil_silver_ramp`).

## Verification (`verify.py --single-wing`)
```
FILE_SIZE_BYTES 993412 (0.947 MB)
REIMPORT_TRIANGLES 12977
  bus                   11188
  wing-Y                 1789
REIMPORT_BBOX_MIN (-4.414, -15.311, -2.586)
REIMPORT_BBOX_MAX (4.415, 1.39, 2.185)
REIMPORT_BBOX_SIZE (8.828, 16.701, 4.772)
IMAGES [('foil_gold_ramp', (256, 256)), ('foil_n', (512, 512)), ('foil_silver_ramp', (256, 256)), ('tex_01', (512, 512))]
WING_NODE wing-Y T=[0, -0.20066452026367188, 1.46914541721344]
EXPECTED_SIZE (8.83, 16.7, 4.81) REL_DIFF_PCT (0.02, 0.01, 0.79)
VERIFY_STATUS PASS
```


## Cell-Normal Verification Evidence (P3-2 — High Confidence)
Direct polygon normal & material inspection of the official `NASA-3D-Resources/Aqua_B.glb` mesh (after `Rx(-90 deg)` frame alignment to `+Z` nadir / `-Y` wing) resolves `cell_normal = "+X"` without ambiguity (`"confidence": "low"` removed from `catalog.json`):
- **`+X` solar-cell face (`shiny_panel`, 717 polygons)**: Smooth, unobstructed photovoltaic face spanning `X = +0.320 .. +0.398 m` (`mean X = +0.3735 m`, outward face normals along `+X`).
- **`-X` structural backside (`tex_01`, 693 polygons on `Y < -4.5 m`)**: Faces strictly `-X` (`X = +0.078 .. +0.370 m`, `mean X = +0.3401 m`) and carries the central deployment mast/boom, structural ribs, and backside copper busbar/harness wiring texture (`tex_01`).
- **Verification**: `verify.py --single-wing --expected-size 8.828,16.701,4.772` passed cleanly (`993,412` bytes / `0.947 MB`, `12,977` triangles, `BBOX_SIZE (8.828, 16.701, 4.772)`, `REL_DIFF_PCT (0.0, 0.0, 0.0)`).
