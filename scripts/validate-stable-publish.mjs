#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(tag)) {
  throw new Error("npm publication requires a semver vX.Y.Z or prerelease tag");
}
const version = tag.slice(1);
const json = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const cli = json("cli/package.json");
const release = json(`releases/${tag}.json`);
const index = json("deployments/index.json");
if (cli.version !== version || release.version !== version || release.tag !== tag) throw new Error("tag, CLI, and release manifest versions differ");
const isPrerelease = version.includes("-");
if (isPrerelease) {
  if (release.softwareStatus !== "prerelease" || release.npmPublication !== "next") {
    throw new Error("prerelease manifest is not marked for npm next publication");
  }
} else if (release.softwareStatus !== "stable" || release.npmPublication !== "stable") {
  throw new Error("release manifest is not marked for stable npm publication");
}
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (release.releaseCommit !== null) throw new Error("tracked release template must leave self-referential releaseCommit null");
const active = Object.values(index.active ?? {}).map(path => json(`deployments/${path}`));
if (isPrerelease) {
  const deployment = json(`deployments/${release.deploymentManifest}`);
  if (deployment.status !== "candidate" || deployment.protocolVersion !== 2) {
    throw new Error("prerelease must reference a V2 candidate deployment");
  }
} else {
  const deployment = active.find(item => item.version === version);
  if (!deployment) throw new Error("no active deployment manifest matches the stable version");
  if (deployment.releaseCommit !== null || deployment.sourceCommit !== release.sourceCommit) throw new Error("tracked deployment/release linkage template differs");
}
const protectedPaths = ["contracts/src", "contracts/script", "contracts/foundry.toml", "contracts/scripts/install-deps.sh"];
const diff = execFileSync("git", ["diff", "--name-only", `${release.sourceCommit}..${head}`, "--", ...protectedPaths], { cwd: root, encoding: "utf8" }).trim();
if (diff) throw new Error(`release-only commit changed protected build inputs:\n${diff}`);
console.log(`npm publication metadata is consistent for ${tag}`);
