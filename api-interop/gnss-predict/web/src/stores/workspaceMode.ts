import { create } from "zustand";

export type WorkspaceMode = "gnss" | "satellites";
export const WORKSPACE_MODE_KEY = "gnss-studio.workspace-mode.v1";

export function readWorkspaceMode(): WorkspaceMode {
  try { return window.localStorage.getItem(WORKSPACE_MODE_KEY) === "satellites" ? "satellites" : "gnss"; }
  catch { return "gnss"; }
}

/** A workflow preference only: switching never writes a Scenario or starts a job. */
export const useWorkspaceMode = create<{ mode: WorkspaceMode; setMode(mode: WorkspaceMode): void }>()(set => ({
  mode: readWorkspaceMode(),
  setMode: mode => {
    try { window.localStorage.setItem(WORKSPACE_MODE_KEY, mode); } catch { /* In-memory selection still works. */ }
    set({ mode });
  },
}));
