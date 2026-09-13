#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const temporary = mkdtempSync(join(tmpdir(), "ilal-package-smoke-"));
const expectedCliVersion = JSON.parse(readFileSync(resolve(root, "cli/package.json"), "utf8")).version;

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

function pack(workspace) {
  const output = run("npm", ["pack", "--workspace", workspace, "--pack-destination", temporary]);
  const filename = output.trim().split(/\r?\n/).at(-1);
  if (!filename?.endsWith(".tgz")) throw new Error(`npm pack did not return a tarball for ${workspace}.`);
  return join(temporary, filename);
}

try {
  const protocol = pack("@ilalv3/protocol");
  const cli = pack("@ilalv3/cli");
  writeFileSync(join(temporary, "package.json"), "{\"private\":true,\"type\":\"module\"}\n", { mode: 0o600 });
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", protocol, cli], { cwd: temporary });
  run(process.execPath, [
    "--input-type=module",
    "-e",
    "const paths=['@ilalv3/protocol','@ilalv3/protocol/order','@ilalv3/protocol/batch','@ilalv3/protocol/preflight','@ilalv3/protocol/settlement','@ilalv3/protocol/receipt']; await Promise.all(paths.map(path => import(path)));",
  ], { cwd: temporary });
  const version = run(join(temporary, "node_modules", ".bin", "ilal"), ["--version"], { cwd: temporary }).trim();
  if (version !== expectedCliVersion) throw new Error(`Installed CLI reported unexpected version ${version}.`);
  console.log(`installed package smoke test passed: protocol subpaths and ilal ${version}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
