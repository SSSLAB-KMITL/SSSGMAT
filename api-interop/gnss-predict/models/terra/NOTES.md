# Terra (`terra`) — NASA EOS AM-1

## Source & License Attribution
- Upstream model: `models/vendor/nasa/Terra.glb` from **NASA 3D Resources**
  (`nasa/NASA-3D-Resources`, U.S. Government / public domain).
- Authoritative mission dimensions & instrument layout:
  NASA Terra Mission / ESA eoPortal (`6.8 m` bus length × `3.5 m` bus across,
  `9 m × 5 m` single solar array wing, `~13.0 m` deployed Y span, `~5.1 m` Z with
  high-gain antenna & zenith equipment).
- Spacecraft covered (`norad_ids`): `25994` (Terra / EOS AM-1, COSPAR `1999-068A`).

## Frame & Conversion Notes
- Raw `Terra.glb` is in `0.5 mm` units (`scale = 0.0005` -> metres) with nadir
  instruments on `-Z`. `scripts/build.py` rotates `+180 deg` around Y so the nadir
  instrument deck (`ASTER`, `CERES`, `MISR`, `MODIS`, `MOPITT`) faces `+Z`, zenith
  TDRSS HGA faces `-Z`, and the single deployed solar array (`wing-Y`) extends
  along `-Y` (`T_gltf = [0.1865, -0.5652, 1.6677]`, SADM root on `-Y` bus wall).
- External `.tga` references missing in the vendor GLB (`Side_Panels_TERRA.tga`,
  `solarpanels.tga`) are removed cleanly and replaced with a procedural silicon solar
  cell texture (`tex_solar_front`, `512x256`) and metallic structural panels.

## Verification (`verify.py --single-wing`)
```
FILE_SIZE_BYTES 1006228 (0.960 MB)
REIMPORT_TRIANGLES 13397
  bus                   10797
  wing-Y                 2600
REIMPORT_BBOX_MIN (-3.405, -10.403, -2.57)
REIMPORT_BBOX_MAX (3.405, 2.624, 2.572)
REIMPORT_BBOX_SIZE (6.811, 13.027, 5.142)
IMAGES [('tex_solar_front', (512, 256))]
WING_NODE wing-Y T=[0.18650221824645996, -0.5651659369468689, 1.6676928997039795]
EXPECTED_SIZE (6.81, 13.03, 5.14) REL_DIFF_PCT (0.01, 0.02, 0.04)
VERIFY_STATUS PASS
```

