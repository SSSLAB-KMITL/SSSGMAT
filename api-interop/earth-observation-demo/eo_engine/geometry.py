from __future__ import annotations
from datetime import datetime, timedelta
import numpy as np
from pyproj import Transformer
from .catalog import scene, scene_dir, save_json
from .remote import HTTPRangeReader

ECEF = Transformer.from_crs("EPSG:4979", "EPSG:4978", always_xy=True)
GEODETIC = Transformer.from_crs("EPSG:4978", "EPSG:4979", always_xy=True)


def angles(position, lon, lat, height=0):
    target = np.array(ECEF.transform(lon, lat, height))
    delta = np.asarray(position) - target
    lo, la = np.deg2rad([lon, lat])
    east = -np.sin(lo) * delta[0] + np.cos(lo) * delta[1]
    north = (
        -np.sin(la) * np.cos(lo) * delta[0]
        - np.sin(la) * np.sin(lo) * delta[1]
        + np.cos(la) * delta[2]
    )
    up = (
        np.cos(la) * np.cos(lo) * delta[0]
        + np.cos(la) * np.sin(lo) * delta[1]
        + np.sin(la) * delta[2]
    )
    return dict(
        azimuth_deg=float(np.degrees(np.arctan2(east, north)) % 360),
        elevation_deg=float(np.degrees(np.arctan2(up, np.hypot(east, north)))),
        slant_range_m=float(np.linalg.norm(delta)),
    )


def extract_geometry(scene_id):
    from sarpy.io.complex.sicd import SICDDetails

    row = scene(scene_id)
    # SICDDetails reads only NITF headers / DES metadata, not the image segment.
    with HTTPRangeReader(row["sicd_public_url"], budget=16 * 1024**2) as remote:
        details = SICDDetails(remote)
        sicd = details.sicd_meta
        epoch = str(sicd.Timeline.CollectStart)
        start = datetime.fromisoformat(epoch.replace("Z", "+00:00"))
        duration = float(sicd.Timeline.CollectDuration)
        scp = sicd.GeoData.SCP.ECF.get_array()
        lon, lat, height = GEODETIC.transform(*scp)
        samples = []
        for t in np.linspace(0, duration, 65):
            position = sicd.Position.ARPPoly(float(t))
            slon, slat, alt = GEODETIC.transform(*position)
            samples.append(
                dict(
                    t_s=float(t),
                    time=(start + timedelta(seconds=float(t))).isoformat() + "Z",
                    ecef_m=position.tolist(),
                    lon=slon,
                    lat=slat,
                    altitude_m=alt,
                    **angles(position, lon, lat, height),
                )
            )
        result = dict(
            source="SICD Position.ARPPoly",
            estimated=False,
            frame="ECEF / WGS84",
            source_url=row["sicd_public_url"],
            downloaded_bytes=remote.downloaded,
            epoch_utc=epoch + "Z",
            duration_s=duration,
            target=dict(lon=lon, lat=lat, height_m=height),
            samples=samples,
            metadata=dict(
                image_formation=str(sicd.ImageFormation.ImageFormAlgo),
                row_spacing_m=float(sicd.Grid.Row.SS),
                col_spacing_m=float(sicd.Grid.Col.SS),
                rows=int(sicd.ImageData.NumRows),
                cols=int(sicd.ImageData.NumCols),
            ),
            note="Producer trajectory model, evaluated only within this collect. Not independent ground truth.",
        )
        save_json(scene_dir(scene_id) / "geometry.json", result)
        return result
