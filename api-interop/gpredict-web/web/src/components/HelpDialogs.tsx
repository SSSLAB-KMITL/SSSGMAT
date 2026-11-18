import { useEffect, useState } from "react";
import { errorText, getLicense, getReadme } from "../api";
import { FloatingWindow } from "./FloatingWindow";

/** (ของเรา) The user manual of Gpredict Web is the README of this program, not Gpredict's PDF manual. */
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

/** The text a request gives (the licence, the README), or the Thai text of why it could not be read. Fetched once, when the window opens. */
function useFetchedText(load: () => Promise<string>): { text: string | null; error: string | null } {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load().then(
      (t) => alive && setText(t),
      (e: unknown) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [load]);

  return { text, error };
}

/** The scrolling window of a long text, or the reason there is none. */
function TextBody({ text, error, label, loading }: { text: string | null; error: string | null; label: string; loading: string }) {
  return error !== null ? (
    <p className="dialog-error" role="alert">
      {error}
    </p>
  ) : (
    <pre className="license-text" tabIndex={0} aria-label={label}>
      {text ?? loading}
    </pre>
  );
}

/**
 * Help → Online help (ref §1; ของเรา for the text): Gpredict shows an info box with a link to its website; this one shows the
 * README of Gpredict Web in a window that scrolls (GET /api/readme), with the README's path in the repository as plain text.
 * No link: the program points nowhere outside itself.
 */
export function OnlineHelpDialog({ onClose }: { onClose: () => void }) {
  const { text, error } = useFetchedText(getReadme);
  return (
    <FloatingWindow title="Online help" onClose={onClose} width={720}>
      <div className="dialog">
        <p className="dialog-text">
          คู่มือการใช้งาน Gpredict Web คือไฟล์ README ของโปรแกรม:
          {"\n"}
          <code className="dialog-path">{README_PATH}</code>
        </p>
        <TextBody text={text} error={error} label="README" loading="กำลังอ่าน README.md…" />
        <CloseButton onClose={onClose} />
      </div>
    </FloatingWindow>
  );
}

/** Help → License (ref §1): the text of License.txt of the repository (GET /api/license) in a window that scrolls. */
export function LicenseDialog({ onClose }: { onClose: () => void }) {
  const { text, error } = useFetchedText(getLicense);
  return (
    <FloatingWindow title="License" onClose={onClose} width={640}>
      <div className="dialog">
        <TextBody text={text} error={error} label="License" loading="กำลังอ่าน License.txt…" />
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
