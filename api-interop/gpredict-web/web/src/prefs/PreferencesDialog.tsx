import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { errorText } from "../api";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Modal } from "../components/Modal";
import { laterTooltip } from "../later";
import type { PrefValue } from "../types";
import { COMMIT_ORDER, firstView, groupLabel, PREF_GROUPS, switchGroup } from "./prefGroups";
import type { PrefGroupId, PrefsPageApi } from "./prefGroups";
import { pageFailure, prefsFailure } from "./prefPlaces";
import { CommitList, commitPreferences, commitSteps, draftToRequest, draftValue, resetInDraft, setInDraft } from "./prefsDraft";
import type { Draft } from "./prefsDraft";
import { checkPrefs, reloadPrefs, savePrefs, usePrefs } from "./prefsStore";

interface Props {
  onClose: () => void;
}

const NO_CHANGES: Draft = new Map();

/** A page of a group. A component of its own so that the page can use hooks, and keeps them while its group is hidden. */
function GroupPage({ page, api }: { page: (api: PrefsPageApi) => ReactNode; api: PrefsPageApi }) {
  return <>{page(api)}</>;
}

/**
 * Edit → Preferences (ref-D §1, spec §8.1): a modal window "GPREDICT Preferences :: <group>" with the four groups as icons at
 * its left, the page of the group beside them, and the buttons Cancel and OK (no Apply).
 *
 * The pages change a draft that belongs to the window. OK is all or nothing (spec §10, `commitPreferences`): it first checks every part
 * with dry runs that write nothing (what differs from the server's values, PUT /api/prefs?dry_run=true, then the latest `onCheck`
 * function of each page and key), and only when all of them pass writes: the preferences (`savePrefs`), then the latest `onCommit`
 * function of each page and key. The pages run in Gpredict's order, General, Modules, Interfaces, Predict, whichever was visited first.
 * Then the window closes. If any step fails it stays open and shows the Thai error as "<group> → <tab>: <text>". Cancel and Escape
 * close it and save nothing. The page of a group that has been shown stays in the window (hidden) until it closes, so switching groups
 * loses nothing; the window reads the server's values again when it opens, and a page is built from them. An error in a page shows a
 * Thai message in its place (ErrorBoundary, ของเรา) and leaves the window and the other pages as they are.
 */
export function PreferencesDialog({ onClose }: Props) {
  const answer = usePrefs();
  const [draft, setDraft] = useState<Draft>(NO_CHANGES);
  const [view, setView] = useState(firstView);
  const [checks] = useState(() => new CommitList(COMMIT_ORDER));
  const [commits] = useState(() => new CommitList(COMMIT_ORDER));
  const [settled, setSettled] = useState(false); // the read at opening has ended, with or without an answer
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    let alive = true;
    reloadPrefs().then(
      () => alive && setSettled(true),
      (e: unknown) => {
        if (!alive) return;
        setLoadError(errorText(e));
        setSettled(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const setValue = useCallback((key: string, v: PrefValue) => setDraft((d) => setInDraft(d, key, v)), []);
  const resetKeys = useCallback((keys: readonly string[]) => setDraft((d) => resetInDraft(d, keys)), []);

  /** what each page gets: they differ only in the group that registers an onCheck or onCommit; new when the values the pages show change */
  const apis = useMemo(
    () =>
      answer === null
        ? null
        : new Map<PrefGroupId, PrefsPageApi>(
            PREF_GROUPS.map((g) => [
              g.id,
              {
                value: <T extends PrefValue>(key: string) => draftValue(answer, draft, key) as T,
                set: setValue,
                reset: resetKeys,
                onCommit: (key, fn) => commits.add(g.id, key, fn),
                onCheck: (key, fn) => checks.add(g.id, key, fn),
              },
            ]),
          ),
    [answer, draft, setValue, resetKeys, checks, commits],
  );

  const ready = apis !== null && settled;

  const ok = async () => {
    if (answer === null || !settled || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const { set, remove } = draftToRequest(answer, draft);
      await commitPreferences(
        commitSteps({
          changed: Object.keys(set).length > 0 || remove.length > 0,
          checkPrefs: () => checkPrefs(set, remove),
          savePrefs: () => savePrefs(set, remove),
          checks,
          commits,
          prefsFailedAs: (e) => prefsFailure(e, groupLabel),
          // a page's name is a group's id: the pages are registered by `PREF_GROUPS.map` above and nowhere else
          pageFailedAs: (page, e) => pageFailure(groupLabel(page as PrefGroupId), e),
        }),
      );
      onClose();
    } catch (e) {
      setFailure(errorText(e));
      setBusy(false);
    }
  };
  const cancel = () => {
    if (!busy) onClose();
  };

  const active = PREF_GROUPS.find((g) => g.id === view.active)!;
  const error = failure ?? loadError;

  return (
    <Modal title={`GPREDICT Preferences :: ${active.label}`} onEscape={cancel}>
      <div className="dialog prefs">
        <div className="prefs-main">
          <div className="prefs-groups" role="tablist" aria-orientation="vertical" aria-label="Preferences">
            {PREF_GROUPS.map((g) => {
              const icon = (
                <>
                  <span className="prefs-icon" aria-hidden="true">
                    {g.icon}
                  </span>
                  {g.label}
                </>
              );
              // a group without a page is shown and cannot be chosen: `aria-disabled` and not `disabled`, so that its tooltip shows in every browser
              return g.page === null ? (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  className="button flat prefs-group later"
                  aria-selected="false"
                  aria-disabled="true"
                  title={g.later === undefined ? undefined : laterTooltip(g.later)}
                  onClick={(e) => e.preventDefault()}
                >
                  {icon}
                </button>
              ) : (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${g.id}`}
                  aria-controls={`${id}-page-${g.id}`}
                  aria-selected={g.id === view.active}
                  data-autofocus={g.id === view.active ? true : undefined}
                  className={g.id === view.active ? "button flat prefs-group active" : "button flat prefs-group"}
                  onClick={() => setView((v) => switchGroup(v, g.id))}
                >
                  {icon}
                </button>
              );
            })}
          </div>
          <div className="prefs-pages">
            {ready ? (
              PREF_GROUPS.filter((g) => g.page !== null && view.visited.includes(g.id)).map((g) => (
                <div
                  key={g.id}
                  id={`${id}-page-${g.id}`}
                  className="prefs-page"
                  role="tabpanel"
                  aria-labelledby={`${id}-tab-${g.id}`}
                  hidden={g.id !== view.active}
                >
                  <ErrorBoundary text="หน้าอื่นของ Preferences ยังใช้ได้">
                    <GroupPage page={g.page!} api={apis.get(g.id)!} />
                  </ErrorBoundary>
                </div>
              ))
            ) : (
              // (ของเรา) Gpredict reads its configuration from a file and has nothing to wait for; a read that failed is told below
              !settled && <p className="dialog-text">กำลังอ่านค่า Preferences...</p>
            )}
          </div>
        </div>
        {error !== null && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="button" disabled={!ready || busy} onClick={() => void ok()}>
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
