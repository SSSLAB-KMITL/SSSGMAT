// REST client of the radio and rotator routes (sub-project 3, spec §8): the devices of Preferences → Interfaces, the transponders
// and the controllers. Throws ApiError for status >= 400, like api.ts.

import { moduleUrl, request } from "../api";
import type { ControllerKind, ControllerRef, HwConf, RadioState, RotatorState, Transponder, TrspUpdateAnswer } from "./types";

// ---------------------------------------------------------------- Preferences → Interfaces

export const getHwconf = () => request<HwConf>("GET", "/api/hwconf");

/**
 * Replaces all the devices with these: both lists are required, every device is checked first (422 HWCONF_INVALID, Thai text, `object` =
 * the key) and then nothing is written; the devices that are not in the lists are deleted. `Cycle` and `Threshold` are ignored: the
 * server keeps the file's (1000 and 5.0 for a new device). Two names that differ only in case are refused.
 */
export const putHwconf = (h: HwConf) => request<HwConf>("PUT", "/api/hwconf", h);

// ---------------------------------------------------------------- transponders

/** The transponders of a satellite, in the order of the file; none if the satellite has no file. */
export async function getTransponders(norad: number): Promise<Transponder[]> {
  return (await request<{ norad: number; transponders: Transponder[] }>("GET", `/api/trsp/${norad}`)).transponders;
}

/** Edit → Update transponder data: asks SatNOGS DB at most once in two hours; within that the answer is `cached` (spec §7.1). Waits for the network. */
export const updateTransponders = () => request<TrspUpdateAnswer>("POST", "/api/trsp/update");

// ---------------------------------------------------------------- controllers

/** The target satellite of a module changed (Select satellite, a click in a view, Autotrack): the open controllers of the module follow. 404 if the module is not open or does not have the satellite. */
export const postTarget = (module: string, norad: number) => request<void>("POST", `${moduleUrl(module)}/target`, { norad });

/** The controllers that are open on the server, for every module. */
export async function getControllers(): Promise<ControllerRef[]> {
  return (await request<{ open: ControllerRef[] }>("GET", "/api/controllers")).open;
}

/** Opens the Radio Control or Antenna Control of a module (409 NO_RADIO_CONFIG or NO_ROTATOR_CONFIG without a device); answers the open controllers. */
export async function openController(module: string, kind: ControllerKind): Promise<ControllerRef[]> {
  return (await request<{ open: ControllerRef[] }>("POST", `${moduleUrl(module)}/${kind}/open`)).open;
}

/** Closes it (the radio or rotator is disengaged first); answers the open controllers. */
export async function closeController(module: string, kind: ControllerKind): Promise<ControllerRef[]> {
  return (await request<{ open: ControllerRef[] }>("POST", `${moduleUrl(module)}/${kind}/close`)).open;
}

/**
 * One action of a controller window ({"action": "engage", "on": true}, ...): the new state, which the server answers under the key of the
 * kind. 404 if the controller is not open, 422 CONTROLLER_INVALID for a body that is wrong.
 */
export function controllerAction(module: string, kind: "radio", body: Record<string, unknown>): Promise<RadioState>;
export function controllerAction(module: string, kind: "rotator", body: Record<string, unknown>): Promise<RotatorState>;
export function controllerAction(module: string, kind: ControllerKind, body: Record<string, unknown>): Promise<RadioState | RotatorState>;
export async function controllerAction(module: string, kind: ControllerKind, body: Record<string, unknown>): Promise<RadioState | RotatorState> {
  const answer = await request<Partial<Record<ControllerKind, RadioState | RotatorState>>>("POST", `${moduleUrl(module)}/${kind}`, body);
  return answer[kind]!;
}
