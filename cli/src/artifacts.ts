import { closeSync, existsSync, linkSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { stringifyProtocolJson } from "@ilalv3/protocol";

export function artifactJson(value: unknown): string {
  return stringifyProtocolJson(value);
}

export function ensureWritable(path: string, force = false): string {
  const output = resolve(path);
  if (!force && existsSync(output)) throw new Error(`Refusing to overwrite ${output}; pass --force to replace it.`);
  return output;
}

export function writeArtifact(path: string, value: unknown, force = false): string {
  const output = ensureWritable(path, force);
  const temporary = resolve(dirname(output), `.${basename(output)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, artifactJson(value), { encoding: "utf8" });
    closeSync(descriptor);
    descriptor = undefined;
    if (force) renameSync(temporary, output);
    else {
      linkSync(temporary, output);
      unlinkSync(temporary);
    }
    return output;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}
