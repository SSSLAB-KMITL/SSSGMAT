import { useEffect, useState } from "react";
import { errorText, getLicense } from "../api";
import { FloatingWindow } from "./FloatingWindow";

/** (ของเรา) The user manual of Gpredict Web is the README of this program, not Gpredict's PDF manual (Task 19 writes it). */
const README_PATH = "api-interop/gpredict-web/README.md";

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-buttons">
      <button type="button" className="button" data-autofocus onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/**
 * Help → Online help (ref §1; ของเรา for the text): Gpredict shows an info box with a link to its website; this one names the
 * README of Gpredict Web by its path in the repository, as plain text (no link: the program points nowhere outside itself).
 */
export function OnlineHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <FloatingWindow title="Online help" onClose={onClose}>
      <div className="dialog">
        <p className="dialog-text">
          คู่มือการใช้งาน Gpredict Web อยู่ในไฟล์ README ของโปรแกรม:
          {"\n"}
          <code className="dialog-path">{README_PATH}</code>
        </p>
        <CloseButton onClose={onClose} />
      </div>
    </FloatingWindow>
  );
}

/** Help → License (ref §1): the text of License.txt of the repository (GET /api/license) in a window that scrolls. */
export function LicenseDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getLicense().then(
      (t) => alive && setText(t),
      (e: unknown) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <FloatingWindow title="License" onClose={onClose} width={640}>
      <div className="dialog">
        {error !== null ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : (
          <pre className="license-text" tabIndex={0} aria-label="License">
            {text ?? "กำลังอ่าน License.txt…"}
          </pre>
        )}
        <CloseButton onClose={onClose} />
      </div>
    </FloatingWindow>
  );
}

/**
 * Help → About Gpredict Web (ของเรา; Gpredict's About dialog is about Gpredict): what this is, and that it is not Gpredict and
 * not from its developers (spec §8.1: the name "Gpredict Web" is deliberate).
 */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <FloatingWindow title="About Gpredict Web" onClose={onClose}>
      <div className="dialog">
        <p className="dialog-text">
          <b>Gpredict Web</b>
          {"\n"}หน้าเว็บที่ทำหน้าตาและการใช้งานแบบ Gpredict โดยคำนวณวงโคจรด้วย GMAT
          {"\n"}A Gpredict-style web interface that computes orbits with GMAT.
          {"\n\n"}ไม่ใช่โปรแกรม Gpredict และไม่เกี่ยวข้องกับผู้พัฒนา Gpredict
          {"\n"}This is not Gpredict and is not affiliated with its developers.
        </p>
        <CloseButton onClose={onClose} />
      </div>
    </FloatingWindow>
  );
}
