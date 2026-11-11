export type EnumSource = readonly [model: string, property: string, sameAs?: ReadonlyArray<readonly [model: string, property: string]>];
export const SOURCES: Readonly<Record<string, EnumSource>>;
