// File → Quit (ของเรา): stop the server, then the page says so. If the server cannot be stopped from the page, say that instead.

import { errorText } from "./api";

/**
 * Run the quit request. Only an answer of success means the server is going away, so only then `onStopped` (the "server
 * stopped" page). Any error, such as 409 QUIT_UNAVAILABLE from a server that was not started with `python -m gpredict_web`
 * (dev mode under uvicorn), goes to `onError` as its Thai text and the page stays as it is: the server is still running.
 */
export async function runQuit(
  quit: () => Promise<void>,
  onStopped: () => void,
  onError: (text: string) => void,
): Promise<void> {
  try {
    await quit();
  } catch (e) {
    onError(errorText(e));
    return;
  }
  onStopped();
}
