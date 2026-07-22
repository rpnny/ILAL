#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const findings = [];
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf", ".gz", ".tgz", ".wasm", ".zkey", ".ptau"]);
const rules = [
  ["named signer secret", /(?:PRIVATE_KEY|MNEMONIC|SEED_PHRASE|KEYSTORE_PASSWORD)\s*["']?\s*[:=]\s*["']?(?:0x[0-9a-fA-F]{64}|[A-Za-z0-9_+\/-]{24,})/g],
  ["GitHub token", /gh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}/g],
  ["npm token", /npm_[A-Za-z0-9]{30,}/g],
  ["credential URL", /https?:\/\/[^\s\/:@]+:[^\s\/@]+@[^\s"']+/g],
];

function allowed(line) {
  return line.includes("0xTestOnly")
    || line.includes("0xIssuerKey")
    || line.includes("0xUserKey")
    || line.includes("0xFreshWalletKey")
    || line.includes("0xMarketMakerKey")
    || line.includes("0x<")
    || line.includes("0x...")
    || line.includes("${")
    || line.includes("repeat(")
    || line.includes("padStart(");
}

function scanText(label, text) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (allowed(line)) continue;
    for (const [rule, pattern] of rules) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) findings.push(`${label}:${index + 1}: ${rule}`);
    }
  }
}

function scanFile(path, label = path) {
  if (binaryExtensions.has(extname(path).toLowerCase())) return;
  if (statSync(path).size > 2_000_000) return;
  const contents = readFileSync(path);
  if (contents.includes(0)) return;
  scanText(label, contents.toString("utf8"));
}

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root })
  .toString("utf8").split("\0").filter(Boolean);
for (const relative of listed) scanFile(resolve(root, relative), relative);

const history = spawnSync("git", ["log", "-p", "--all", "--full-history", "--no-ext-diff", "--"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 128 * 1024 * 1024,
});
if (history.status !== 0) throw new Error(`git history scan failed: ${history.stderr}`);
scanText("git-history", history.stdout);

const packRoot = mkdtempSync(join(tmpdir(), "ilal-pack-scan-"));
try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", packRoot], {
    cwd: resolve(root, "cli"),
    encoding: "utf8",
  }));
  const tarball = resolve(packRoot, packed[0].filename);
  const extractRoot = resolve(packRoot, "unpacked");
  execFileSync("mkdir", [extractRoot]);
  execFileSync("tar", ["-xzf", tarball, "-C", extractRoot]);
  const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
  for (const path of walk(extractRoot)) scanFile(path, `npm-tarball/${path.slice(extractRoot.length + 1)}`);
} finally {
  rmSync(packRoot, { recursive: true, force: true });
}

if (findings.length > 0) {
  console.error("potential secrets found (values intentionally redacted):");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log("current tree, Git history, website assets, release metadata, and npm tarball passed the local secret scan");
