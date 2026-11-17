import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { errorText, getMaps, uploadMap } from "../api";
import { missingMaps, mapUrl, moveSelection, previewCaption, uploadContentType, uploadProblem, withEntry } from "../mapFiles";
import type { MapEntry } from "../types";
import { Modal } from "./Modal";

/** The title of Gpredict's dialog, its buttons and the name of its filter (map-selector.c:242-260). */
export const SELECT_MAP = { title: "Select Map", cancel: "Cancel", open: "Open", filter: "Image files" } as const;

/** What Gpredict's preview and its page show for a map that cannot be read: the icon `image-missing`. */
function MissingImage({ width, height }: { width: number; height: number }) {
  return (
    <span className="map-missing" role="img" aria-label="image-missing" style={{ width, height }}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="2" y="3" width="18" height="16" rx="1.5" />
        <path d="M2 15l5-5 4 4 3-3 6 6M8 8h.01" />
        <path d="M3 3l16 16" />
      </svg>
    </span>
  );
}

/**
 * The picture of the map `file` scaled to `width` x `height` (Gpredict scales it with `gdk_pixbuf_scale_simple`, so it is stretched to the
 * box); the icon `image-missing` when the server has no such file or cannot give it. It tries again when `file` changes.
 */
export function MapImage({ file, width, height, className }: { file: string; width: number; height: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === file) return <MissingImage width={width} height={height} />;
  return <img className={className} src={mapUrl(file)} width={width} height={height} alt="" onError={() => setFailed(file)} />;
}

interface Props {
  /** the map the page has now: it is selected when the dialog opens (GTK preselects it) */
  current: string;
  /** Open with a map selected: its file name (a stock map's, or the name it was uploaded as) */
  onOpen: (file: string) => void;
  /** Cancel or Escape */
  onCancel: () => void;
}

/**
 * Gpredict's "Select Map" dialog (ref-D §11, map-selector.c): a file chooser with the buttons Cancel and Open, a filter "Image files", the
 * maps of Gpredict as its shortcut folder and a preview pane with the picture at 160 x 80 and the caption "<w>x<h> pixels" and the size.
 * Open is off until a map is selected; a double click on a map or Enter opens it. A browser cannot browse the disk of the server, so the
 * list is the maps of Gpredict and the ones that were uploaded, and (ของเรา) the button "อัปโหลดภาพ..." sends an image of the user's
 * disk to the server (jpg, jpeg or png, up to 10 MB), which adds it to the list and selects it.
 */
export function MapSelector({ current, onOpen, onCancel }: Props) {
  const [maps, setMaps] = useState<readonly MapEntry[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFailure, setUploadFailure] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    getMaps().then(
      (list) => {
        if (!alive) return;
        setMaps(list.maps);
        // the map the page has is preselected if the server has it (one that is missing leaves nothing selected)
        setSelected((now) => now ?? (list.maps.some((m) => m.file === current) ? current : null));
      },
      (e: unknown) => alive && setFailure(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [attempt, current]);

  const chosen = maps?.find((m) => m.file === selected) ?? null;

  const keys = (e: KeyboardEvent) => {
    if (maps === null) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (chosen !== null) onOpen(chosen.file);
      return;
    }
    const next = moveSelection(maps.map((m) => m.file), selected, e.key);
    if (next !== selected) {
      e.preventDefault();
      setSelected(next);
    }
  };

  const picked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (file === undefined) return;
    const problem = uploadProblem(file);
    if (problem !== null) {
      setUploadFailure(problem);
      return;
    }
    setUploading(true);
    setUploadFailure(null);
    try {
      const entry = await uploadMap(file.name, uploadContentType(file.name), file);
      missingMaps.forget(entry.file); // a map that was missing and is there now is reported again if it goes
      setMaps((held) => withEntry(held ?? [], entry));
      setSelected(entry.file);
    } catch (err) {
      setUploadFailure(errorText(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title={SELECT_MAP.title} onEscape={onCancel}>
      <div className="dialog map-select">
        {maps === null ? (
          failure === null ? (
            // (ของเรา) Gpredict's file chooser reads its folder at once
            <p className="dialog-text tree-wait">กำลังอ่านรายการภาพแผนที่...</p>
          ) : (
            <div className="tree-wait">
              <p className="dialog-error" role="alert">
                {failure}
              </p>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setFailure(null);
                  setAttempt((n) => n + 1);
                }}
              >
                ลองอีกครั้ง
              </button>
            </div>
          )
        ) : (
          <div className="map-select-body">
            <div className="dialog-list map-list" role="listbox" aria-label={SELECT_MAP.filter} tabIndex={0} data-autofocus onKeyDown={keys}>
              <div className="dialog-list-head">{SELECT_MAP.filter}</div>
              {maps.map((m) => (
                <div
                  key={m.file}
                  role="option"
                  aria-selected={m.file === selected}
                  className={m.file === selected ? "dialog-row selected" : "dialog-row"}
                  ref={(el) => {
                    if (el !== null && m.file === selected) el.scrollIntoView({ block: "nearest" });
                  }}
                  onClick={() => setSelected(m.file)}
                  onDoubleClick={() => onOpen(m.file)}
                >
                  {m.file}
                  {!m.stock && <span className="map-own"> (อัปโหลด)</span>}
                </div>
              ))}
            </div>
            <div className="map-preview">
              {chosen === null ? (
                // GTK deactivates its preview when no file is selected
                <MissingImage width={160} height={80} />
              ) : (
                <>
                  <MapImage key={`${chosen.file}:${chosen.bytes}`} file={chosen.file} width={160} height={80} className="map-preview-image" />
                  <p className="map-caption">{previewCaption(chosen)}</p>
                </>
              )}
            </div>
          </div>
        )}
        <div className="map-upload">
          <input ref={picker} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={(e) => void picked(e)} />
          <button type="button" className="button" disabled={uploading || maps === null} onClick={() => picker.current?.click()}>
            อัปโหลดภาพ...
          </button>
          {uploading && <span className="dialog-text">กำลังอัปโหลด...</span>}
        </div>
        {uploadFailure !== null && (
          <p className="dialog-error" role="alert">
            {uploadFailure}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={onCancel}>
            {SELECT_MAP.cancel}
          </button>
          <button type="button" className="button" disabled={chosen === null} onClick={() => chosen !== null && onOpen(chosen.file)}>
            {SELECT_MAP.open}
          </button>
        </div>
      </div>
    </Modal>
  );
}
