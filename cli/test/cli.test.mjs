import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const cli = new URL("../dist/index.js", import.meta.url).pathname;

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NO_COLOR: "1", ...env },
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

test("reported version matches package version", () => {
  const version = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim();
  assert.equal(version, packageJson.version);
});

test("init selects only the active v0.3.3 Base Sepolia deployment", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-cli-init-"));
  try {
    const result = spawnSync(process.execPath, [cli, "init"], {
      cwd: dir,
      env: { ...process.env, NO_COLOR: "1" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, output(result));
    const config = JSON.parse(readFileSync(join(dir, ".ilal.json"), "utf8"));
    assert.equal(config.protocolVersion, "1");
    assert.equal(config.chain, "84532");
    assert.equal(config.router, "0x2ccd398F6F60A1d926374a78F25e90E3Bef99A77");
    assert.equal(config.hook, "0x9B894a6fD363CfBA6E8A5876256Fb7698659CA80");
    assert.equal(config.poolId, "0x1a05b49e39c3ed799c4f0f23bb61e647ff9d3c558136f718a2ab2fa87c82d1ad");
    assert.doesNotMatch(JSON.stringify(config), /0x6C7A1E5AB19706691554529c62a6d4417F55868D/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("private keys are not accepted in process arguments", () => {
  const result = run([
    "swap",
    "--amount-in", "1",
    "--unsafe-no-slippage",
    "--private-key", `0x${"1".repeat(64)}`,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /unknown option '--private-key'/);
});

test("live swap requires an output floor before wallet or RPC work", () => {
  const result = run(["swap", "--amount-in", "1"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /positive --min-amount-out is required/);
});

test("demo commands never print a live swap without an explicit slippage choice", () => {
  const result = run(["demo", "--commands"]);
  assert.equal(result.status, 0, output(result));
  const swapLine = output(result).split("\n").find((line) => line.includes("swap --amount-in 100"));
  assert.ok(swapLine, "demo should print a swap command");
  assert.match(swapLine, /--min-amount-out <quotedMinRaw>/);
});

test("add liquidity requires explicit maximum token spends", () => {
  const result = run([
    "pool", "add-liquidity",
    "--tick-lower=-600",
    "--tick-upper=600",
    "--liquidity=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /requires --max-amount-0 and --max-amount-1/);
});

test("remove liquidity requires explicit minimum token receipts", () => {
  const result = run([
    "pool", "remove-liquidity",
    "--tick-lower=-600",
    "--tick-upper=600",
    "--liquidity=1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /requires --min-amount-0 and --min-amount-1/);
});

test("ZK domain timelock commands are discoverable", () => {
  const result = run(["oracle", "--help"]);
  assert.equal(result.status, 0);
  assert.match(output(result), /propose-domain/);
  assert.match(output(result), /activate-domain/);
});

test("zero ZK domain hashes fail before signing", () => {
  const result = run([
    "oracle", "propose-domain",
    "--issuer", "0x0000000000000000000000000000000000000001",
    "--issuer-hash", "0",
    "--schema-hash", "1",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /hashes must both be nonzero/);
});

test("deploy passes hostile RPC text as one argv value without invoking a shell", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-cli-shell-"));
  const fakeForge = join(dir, "forge");
  const capturedArgs = join(dir, "argv.txt");
  const injectedMarker = join(dir, "injected");
  writeFileSync(fakeForge, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$ILAL_TEST_ARGV\"\n");
  chmodSync(fakeForge, 0o700);

  try {
    const hostileRpc = `http://127.0.0.1;touch ${injectedMarker}`;
    const result = run([
      "--unsafe-private-key",
      "deploy",
      "--rpc", hostileRpc,
      "--contracts-dir", new URL("../../contracts", import.meta.url).pathname,
    ], {
      PRIVATE_KEY: `0x${"1".repeat(64)}`,
      ILAL_TEST_ARGV: capturedArgs,
      PATH: `${dir}:${process.env.PATH}`,
    });

    assert.equal(result.status, 0, output(result));
    const argv = readFileSync(capturedArgs, "utf8").trim().split("\n");
    const rpcIndex = argv.indexOf("--rpc-url");
    assert.notEqual(rpcIndex, -1);
    assert.equal(argv[rpcIndex + 1], hostileRpc);
    assert.throws(() => readFileSync(injectedMarker), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("production deploy passes the Safe admin through the child environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-cli-admin-"));
  const fakeForge = join(dir, "forge");
  const capturedAdmin = join(dir, "admin.txt");
  writeFileSync(fakeForge, "#!/bin/sh\nprintf '%s' \"$ADMIN\" > \"$ILAL_TEST_ADMIN\"\n");
  chmodSync(fakeForge, 0o700);
  const admin = "0x1111111111111111111111111111111111111111";

  try {
    const result = run([
      "--unsafe-private-key",
      "deploy",
      "--admin", admin,
      "--contracts-dir", new URL("../../contracts", import.meta.url).pathname,
    ], {
      PRIVATE_KEY: `0x${"1".repeat(64)}`,
      ILAL_TEST_ADMIN: capturedAdmin,
      PATH: `${dir}:${process.env.PATH}`,
    });

    assert.equal(result.status, 0, output(result));
    assert.equal(readFileSync(capturedAdmin, "utf8"), admin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deploy rejects an invalid admin before reading a signing key", () => {
  const result = run(["deploy", "--admin", "not-an-address"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /Invalid admin address/);
});

test("keystore deployment delegates signing to Foundry without exporting PRIVATE_KEY", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-cli-keystore-deploy-"));
  const fakeForge = join(dir, "forge");
  const keystore = join(dir, "deployer.json");
  const captured = join(dir, "forge.txt");
  const address = "1111111111111111111111111111111111111111";
  writeFileSync(keystore, JSON.stringify({ version: 3, address, crypto: {} }));
  writeFileSync(fakeForge, "#!/bin/sh\nprintf '%s\\n' \"${PRIVATE_KEY-unset}\" \"$USE_FOUNDRY_WALLET\" \"$DEPLOYER\" \"$@\" > \"$ILAL_TEST_FORGE\"\n");
  chmodSync(fakeForge, 0o700);

  try {
    const result = run([
      "--keystore", keystore,
      "deploy",
      "--contracts-dir", new URL("../../contracts", import.meta.url).pathname,
    ], {
      PRIVATE_KEY: `0x${"9".repeat(64)}`,
      ILAL_TEST_FORGE: captured,
      PATH: `${dir}:${process.env.PATH}`,
    });
    assert.equal(result.status, 0, output(result));
    const lines = readFileSync(captured, "utf8").trim().split("\n");
    assert.deepEqual(lines.slice(0, 3), ["unset", "true", `0x${address}`]);
    const keystoreIndex = lines.indexOf("--keystore");
    assert.notEqual(keystoreIndex, -1);
    assert.equal(lines[keystoreIndex + 1], keystore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deployment rejects a group-readable keystore password file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-cli-password-mode-"));
  const keystore = join(dir, "deployer.json");
  const password = join(dir, "password.txt");
  writeFileSync(keystore, JSON.stringify({ version: 3, address: "1111111111111111111111111111111111111111", crypto: {} }));
  writeFileSync(password, "test-password\n");
  chmodSync(password, 0o644);
  try {
    const result = run([
      "--keystore", keystore,
      "--password-file", password,
      "deploy",
      "--contracts-dir", new URL("../../contracts", import.meta.url).pathname,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(output(result), /Password file permissions are too broad/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mock deploy keeps admin and treasury independent", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-cli-mock-roles-"));
  const fakeForge = join(dir, "forge");
  const captured = join(dir, "roles.txt");
  writeFileSync(fakeForge, "#!/bin/sh\nprintf '%s\\n' \"$ADMIN\" \"$TREASURY\" > \"$ILAL_TEST_ROLES\"\n");
  chmodSync(fakeForge, 0o700);
  const admin = "0x1111111111111111111111111111111111111111";
  const treasury = "0x4444444444444444444444444444444444444444";

  try {
    const result = run([
      "--unsafe-private-key",
      "deploy",
      "--mock",
      "--admin", admin,
      "--treasury", treasury,
      "--wallet-to-seed", "0x5555555555555555555555555555555555555555",
      "--contracts-dir", new URL("../../contracts", import.meta.url).pathname,
    ], {
      PRIVATE_KEY: `0x${"1".repeat(64)}`,
      ILAL_TEST_ROLES: captured,
      PATH: `${dir}:${process.env.PATH}`,
    });
    assert.equal(result.status, 0, output(result));
    assert.deepEqual(readFileSync(captured, "utf8").trim().split("\n"), [admin, treasury]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("production deploy passes a custom issuer trust domain to Foundry", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-cli-issuer-"));
  const fakeForge = join(dir, "forge");
  const captured = join(dir, "issuer-env.txt");
  writeFileSync(
    fakeForge,
    "#!/bin/sh\nprintf '%s\\n' \"$EAS_ADDRESS\" \"$SCHEMA_UID\" \"$TRUSTED_ATTESTER\" \"$TREASURY\" \"$PROTOCOL_FEE_PIPS\" \"$ISSUER_NAME\" > \"$ILAL_TEST_ISSUER_ENV\"\n"
  );
  chmodSync(fakeForge, 0o700);
  const eas = "0x2222222222222222222222222222222222222222";
  const schema = `0x${"ab".repeat(32)}`;
  const attester = "0x3333333333333333333333333333333333333333";
  const treasury = "0x4444444444444444444444444444444444444444";

  try {
    const result = run([
      "--unsafe-private-key",
      "deploy",
      "--eas", eas,
      "--schema", schema,
      "--attester", attester,
      "--treasury", treasury,
      "--protocol-fee-pips", "75",
      "--issuer-name", "Goldfinch Test Issuer",
      "--contracts-dir", new URL("../../contracts", import.meta.url).pathname,
    ], {
      PRIVATE_KEY: `0x${"1".repeat(64)}`,
      ILAL_TEST_ISSUER_ENV: captured,
      PATH: `${dir}:${process.env.PATH}`,
    });

    assert.equal(result.status, 0, output(result));
    assert.deepEqual(readFileSync(captured, "utf8").trim().split("\n"), [
      eas, schema, attester, treasury, "75", "Goldfinch Test Issuer",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("production deploy rejects malformed trust-domain inputs before signing", () => {
  const result = run(["deploy", "--schema", "0x1234"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /Invalid schema UID/);
});

test("mock deploy rejects external EAS parameters instead of ignoring them", () => {
  const result = run([
    "deploy", "--mock",
    "--eas", "0x2222222222222222222222222222222222222222",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /--mock deploys MockEAS/);
});

test("broadcast deployment requires an explicit Safe admin", () => {
  const result = run(["deploy", "--chain", "8453", "--broadcast"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /Broadcast deployment requires --admin <Safe>/);
});

test("broadcast deployment requires an explicit treasury", () => {
  const result = run([
    "deploy", "--chain", "84532", "--broadcast",
    "--admin", "0x1111111111111111111111111111111111111111",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /requires an explicit --treasury/);
});
