import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const source = resolve(scriptDir, "../../site");
const target = resolve(scriptDir, "../dist/console-assets");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const name of [
  "app.html", "app.css", "app.js",
  "mixed.html", "mixed.css", "mixed.js",
  "console.html", "console.css", "console.js",
]) {
  cpSync(resolve(source, name), resolve(target, name));
}

// Mixed is unpublished in this task. Keep its SDK runtime self-contained in
// the CLI artifact while retaining the workspace package as a build-time type
// dependency. This avoids a broken file:../sdk dependency for packed installs.
const sdkSource = resolve(scriptDir, "../../sdk/dist");
const sdkTarget = resolve(scriptDir, "../dist/vendor-sdk");
cpSync(sdkSource, sdkTarget, { recursive: true });
for (const name of ["mixed.js", "mixedConsole.js"]) {
  const path = resolve(scriptDir, "../dist/commands", name);
  const text = readFileSync(path, "utf8")
    .replaceAll("from '@ilalv3/sdk'", "from '../vendor-sdk/index.js'")
    .replaceAll('from "@ilalv3/sdk"', 'from "../vendor-sdk/index.js"');
  writeFileSync(path, text);
}
