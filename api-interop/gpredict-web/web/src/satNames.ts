// Edit module: the module keeps only NORAD numbers, the selected list shows names. Looks the names up, a few requests at a time.

import type { SelectedSat } from "./moduleForm";

/** How many lookups are on their way at once (a module has up to 200 satellites; the server is on this computer). */
const AT_ONCE = 8;

/** The name a satellite is listed under when the server cannot say what it is. */
export const fallbackName = (norad: number): string => `NORAD ${norad}`;

export interface SatNames {
  /** every satellite asked for, in the order asked */
  sats: SelectedSat[];
  /** the lookups that failed (those satellites are in `sats` under their catalogue number) */
  failures: { norad: number; error: unknown }[];
}

export async function loadSatNames(
  norads: readonly number[],
  get: (norad: number) => Promise<{ name: string }>,
  atOnce: number = AT_ONCE,
): Promise<SatNames> {
  const sats: SelectedSat[] = norads.map((norad) => ({ norad, name: fallbackName(norad) }));
  const failures: SatNames["failures"] = [];
  let next = 0;
  const worker = async () => {
    while (next < norads.length) {
      const i = next++;
      const norad = norads[i]!;
      try {
        sats[i] = { norad, name: (await get(norad)).name };
      } catch (error) {
        failures.push({ norad, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, norads.length) }, worker));
  failures.sort((a, b) => norads.indexOf(a.norad) - norads.indexOf(b.norad));
  return { sats, failures };
}
