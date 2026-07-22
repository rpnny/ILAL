import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  bytesToHex,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  configureSignerOptions,
  createExecutionClients,
  decryptKeystoreV3,
} from "../dist/signer.js";
import { proposeSafeTransaction } from "../dist/safe.js";

const key = `0x${"1".padStart(64, "0")}`;
const account = privateKeyToAccount(key);

function makeKeystore(password) {
  const salt = Buffer.from("11".repeat(32), "hex");
  const iv = Buffer.from("22".repeat(16), "hex");
  const derived = pbkdf2Sync(password, salt, 1024, 32, "sha256");
  const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(key.slice(2), "hex")), cipher.final()]);
  const mac = keccak256(bytesToHex(Buffer.concat([derived.subarray(16, 32), ciphertext]))).slice(2);
  return JSON.stringify({
    version: 3,
    address: account.address.slice(2),
    crypto: {
      cipher: "aes-128-ctr",
      ciphertext: ciphertext.toString("hex"),
      cipherparams: { iv: iv.toString("hex") },
      kdf: "pbkdf2",
      kdfparams: { dklen: 32, c: 1024, prf: "hmac-sha256", salt: salt.toString("hex") },
      mac,
    },
  });
}

async function jsonRpcServer(handler) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const result = handler(payload.method, payload.params ?? []);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test("decrypts a Web3 Secret Storage v3 PBKDF2 keystore", () => {
  assert.equal(decryptKeystoreV3(makeKeystore("correct horse"), "correct horse"), key);
});

test("RPC-managed signer verifies chain and account ownership", async () => {
  const rpc = await jsonRpcServer(method => {
    if (method === "eth_chainId") return "0x14a34";
    if (method === "eth_accounts") return [account.address];
    throw new Error(`Unexpected method ${method}`);
  });
  try {
    configureSignerOptions({ rpcAccount: account.address });
    const clients = await createExecutionClients({ chain: baseSepolia, rpc: rpc.url });
    assert.equal(clients.kind, "rpc-account");
    assert.equal(clients.address.toLowerCase(), account.address.toLowerCase());
  } finally {
    configureSignerOptions({});
    await rpc.close();
  }
});

test("Safe proposer validates on-chain state and writes an offline proposal", async () => {
  const safe = "0x1111111111111111111111111111111111111111";
  const target = "0x2222222222222222222222222222222222222222";
  const nonce = 7n;
  const data = "0x1234";
  const types = {
    SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const safeTxHash = hashTypedData({
    domain: { chainId: baseSepolia.id, verifyingContract: safe },
    types,
    primaryType: "SafeTx",
    message: {
      to: target,
      value: 0n,
      data,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce,
    },
  });
  const selectors = {
    owners: toFunctionSelector("getOwners()"),
    threshold: toFunctionSelector("getThreshold()"),
    nonce: toFunctionSelector("nonce()"),
    hash: toFunctionSelector("getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)"),
  };
  const rpc = await jsonRpcServer((method, params) => {
    if (method === "eth_chainId") return "0x14a34";
    if (method === "eth_getCode") return "0x6001";
    if (method === "eth_call") {
      const callData = params[0].data;
      if (callData.startsWith(selectors.owners)) return encodeAbiParameters([{ type: "address[]" }], [[account.address]]);
      if (callData.startsWith(selectors.threshold)) return encodeAbiParameters([{ type: "uint256" }], [2n]);
      if (callData.startsWith(selectors.nonce)) return encodeAbiParameters([{ type: "uint256" }], [nonce]);
      if (callData.startsWith(selectors.hash)) return encodeAbiParameters([{ type: "bytes32" }], [safeTxHash]);
    }
    throw new Error(`Unexpected method ${method}`);
  });
  const dir = mkdtempSync(join(tmpdir(), "ilal-safe-test-"));
  const output = join(dir, "proposal.json");
  try {
    const proposal = await proposeSafeTransaction({
      chain: baseSepolia,
      rpc: rpc.url,
      safe,
      to: target,
      data,
      output,
    });
    assert.equal(proposal.safeTxHash, safeTxHash);
    assert.equal(proposal.submitted, false);
    assert.equal(proposal.threshold, "2");
    assert.equal(JSON.parse(readFileSync(output, "utf8")).nonce, "7");
    assert.equal(statSync(output).mode & 0o777, 0o600);
  } finally {
    await rpc.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
