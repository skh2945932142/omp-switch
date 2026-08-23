import type { OmpAdapter } from "./adapter";
import type { ConfigPatch, ProfileRef } from "./domain";

export type JsonCliCommand = "list" | "get" | "validate" | "plan" | "apply" | "snapshot" | "snapshots";

export interface ParsedJsonCliCommand {
  command: JsonCliCommand;
  profile: string;
  patch?: ConfigPatch;
}

export interface JsonCliRuntime {
  adapter: OmpAdapter;
  profile(id: string): ProfileRef;
}

export interface JsonCliResponse {
  version: 1;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

function getOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseJsonCliArguments(args: string[]): ParsedJsonCliCommand {
  const command = args.find((arg) => !arg.startsWith("-"));
  if (
    command !== "list" &&
    command !== "get" &&
    command !== "validate" &&
    command !== "plan" &&
    command !== "apply" &&
    command !== "snapshot" &&
    command !== "snapshots"
  ) {
    throw new Error("Expected one of: list, get, validate, plan, apply, snapshot, snapshots");
  }
  const profile = getOption(args, "--profile") ?? "default";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) throw new Error("Invalid profile");
  const patchText = getOption(args, "--patch");
  if ((command === "apply" || command === "plan") && !patchText) throw new Error(`${command} requires --patch <json>`);
  let patch: ConfigPatch | undefined;
  if (patchText) {
    try {
      const parsed = JSON.parse(patchText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Patch must be a JSON object");
      patch = parsed as ConfigPatch;
    } catch (error) {
      throw new Error(error instanceof Error ? `Invalid patch: ${error.message}` : "Invalid patch");
    }
  }
  return { command, profile, patch };
}

export async function runJsonCli(command: ParsedJsonCliCommand, runtime: JsonCliRuntime): Promise<JsonCliResponse> {
  try {
    if (command.command === "list") return { version: 1, ok: true, data: await runtime.adapter.listProfiles() };
    const profile = runtime.profile(command.profile);
    if (command.command === "snapshots") return { version: 1, ok: true, data: await runtime.adapter.listSnapshots(profile) };
    const config = await runtime.adapter.loadProfile(profile);
    if (command.command === "get") return { version: 1, ok: true, data: config };
    if (command.command === "validate") return { version: 1, ok: true, data: runtime.adapter.validate(config) };
    if (command.command === "snapshot") return { version: 1, ok: true, data: await runtime.adapter.createSnapshot(config) };
    const preview = runtime.adapter.planPatch(config, command.patch!);
    if (command.command === "plan") return { version: 1, ok: true, data: preview };
    return { version: 1, ok: true, data: await runtime.adapter.commitPatch(config, preview) };
  } catch (error) {
    return { version: 1, ok: false, error: { code: "command_failed", message: error instanceof Error ? error.message : String(error) } };
  }
}
