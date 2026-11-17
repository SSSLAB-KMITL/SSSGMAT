// For the tests of local time: the time zone of the process is the machine's, so a test that reads local time pins one.

import { afterAll, beforeAll } from "vitest";

declare const process: { env: Record<string, string | undefined> };

/** Run the tests of the enclosing `describe` (or file) in the time zone `tz`, and put the machine's back afterwards. */
export function pinTimeZone(tz: string): void {
  let before: string | undefined;
  beforeAll(() => {
    before = process.env.TZ;
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });
}
