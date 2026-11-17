import { describe, expectTypeOf, it } from "vitest";
import type { SatState } from "./types";

describe("SatState", () => {
  it("measured numbers are nullable (the server sends null for NaN/Infinity), identifiers are not", () => {
    expectTypeOf<SatState["az"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SatState["el"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SatState["range_km"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SatState["phase_deg"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SatState["norad"]>().toEqualTypeOf<number>();
    expectTypeOf<SatState["orbit"]>().toEqualTypeOf<number>();
    expectTypeOf<SatState["next_aos"]>().toEqualTypeOf<string | null>();
  });
});
