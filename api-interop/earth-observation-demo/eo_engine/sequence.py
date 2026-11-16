"""Experimental SICD aspect sequence. No invented frame timestamps or speeds."""

import json
import shutil
import subprocess
import numpy as np
from PIL import Image, ImageDraw
from .catalog import scene, scene_dir, save_json
from .remote import HTTPRangeReader


def sequence(scene_id, frames=8, progress=lambda *_: None):
    from sarpy.io.complex.sicd import SICDDetails, SICDReader
    from sarpy.processing.sicd.normalize_sicd import DeskewCalculator
    from sarpy.processing.sicd.subaperture import (
        frame_definition,
        subaperture_processing_phase_history,
    )

    row = scene(scene_id)
    folder = scene_dir(scene_id)
    progress("Reading SICD headers and full cross-range support for a narrow strip", 5)
    with HTTPRangeReader(
        row["sicd_public_url"], budget=192 * 1024**2, block_size=262144
    ) as remote:
        details = SICDDetails(remote)
        meta = details.sicd_meta
        if meta.ImageFormation.ImageFormAlgo not in ("PFA", "RMA", "RGAZCOMP"):
            raise ValueError("Unsupported image formation algorithm")
        reader = SICDReader(details)
        nr, nc = int(meta.ImageData.NumRows), int(meta.ImageData.NumCols)
        centre_r = int(meta.ImageData.SCPPixel.Row) - int(meta.ImageData.FirstRow)
        centre_c = int(meta.ImageData.SCPPixel.Col) - int(meta.ImageData.FirstCol)
        start_r = max(0, min(nr - 128, centre_r - 64))
        stop_r = min(nr, start_r + 128)
        start_c = max(0, centre_c - 512)
        stop_c = min(nc, centre_c + 512)
        # Range-Doppler / polynomial deskew uses the producer's Grid metadata.
        calc = DeskewCalculator(
            reader, dimension=1, index=0, apply_deskew=True, apply_deweighting=False
        )
        data = calc[start_r:stop_r, 0:nc]
        progress("Forming overlapping spectral sub-apertures", 65)
        fill = max(
            1.0, 1.0 / (float(meta.Grid.Col.SS) * float(meta.Grid.Col.ImpRespBW))
        )
        windows, resolution = frame_definition(
            nc, frame_count=frames, aperture_fraction=0.3, fill=fill, method="FULL"
        )
        phase = np.fft.fftshift(np.fft.fft(data, axis=1), axes=1)
        chips = [
            np.abs(
                subaperture_processing_phase_history(phase, w, resolution, dimension=1)[
                    :, start_c:stop_c
                ]
            )
            for w in windows
        ]
        log = np.log1p(np.stack(chips))
        lo, hi = np.percentile(log, [2, 99.7])
        images = []
        frame_rows = []
        for i, chip in enumerate(log):
            gray = np.uint8(np.clip((chip - lo) / max(hi - lo, 1e-8), 0, 1) * 255)
            im = Image.fromarray(gray).convert("RGB")
            im = im.resize((1024, max(160, int(im.height * 1024 / im.width))))
            canvas = Image.new("RGB", (1024, im.height + 55), "#111827")
            canvas.paste(im, (0, 55))
            ImageDraw.Draw(canvas).text(
                (14, 12),
                f"{row['platform']} | aspect {i + 1}/{frames} | 30% aperture | EXPERIMENTAL - not timed video",
                fill="white",
            )
            canvas.save(folder / f"frame-{i}.png")
            images.append(canvas)
            frame_rows.append(
                dict(
                    index=i,
                    spectral_start=windows[i][0],
                    spectral_stop=windows[i][1],
                    time_utc=None,
                    url=f"/api/eo/scenes/{scene_id}/files/frame-{i}.png",
                )
            )
        images[0].save(
            folder / "sequence.gif",
            save_all=True,
            append_images=images[1:],
            duration=400,
            loop=0,
        )
        mp4 = False
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            result = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-loglevel",
                    "error",
                    "-framerate",
                    "2.5",
                    "-i",
                    str(folder / "frame-%d.png"),
                    "-vf",
                    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                    "-pix_fmt",
                    "yuv420p",
                    str(folder / "sequence.mp4"),
                ],
                capture_output=True,
                timeout=90,
                # Absolute executable, no cwd/session hooks, and non-inherited
                # Python descriptors let Popen use posix_spawn here as well.
                close_fds=False,
            )
            mp4 = result.returncode == 0
        result = dict(
            scene_id=scene_id,
            method="SICD deskew + overlapping spectral sub-apertures; full cross-range support, narrow range strip at scene centre",
            status="experimental_aspect_sequence",
            frame_count=frames,
            aperture_fraction=0.3,
            source_url=row["sicd_public_url"],
            downloaded_bytes=remote.downloaded,
            image_formation=meta.ImageFormation.ImageFormAlgo,
            strip=dict(
                row_start=start_r, row_stop=stop_r, col_start=start_c, col_stop=stop_c
            ),
            gif_url=f"/api/eo/scenes/{scene_id}/files/sequence.gif",
            mp4_url=f"/api/eo/scenes/{scene_id}/files/sequence.mp4" if mp4 else None,
            frames=frame_rows,
            warning="Aspect sequence, not a validated time-domain video. Frames overlap; frame-to-time mapping, motion and speed are not validated. This chip is at the SICD scene centre, not the interactive GEC ROI. Playback speed is a presentation setting.",
        )
        save_json(folder / "sequence.json", result)
        progress("Experimental aspect sequence ready", 100)
        return result
