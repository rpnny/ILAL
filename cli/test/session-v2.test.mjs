import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeSessionAuthorization,
  encodeSessionAuthorization,
  hashSessionAuthorization,
  recoverSessionAuthorization,
  signSessionAuthorization,
} from "../dist/sessionProtocol.js";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const key = `0x${"1".padStart(64, "0")}`;
const account = privateKeyToAccount(key);
const hook = "0x1111111111111111111111111111111111111111";
const router = "0x2222222222222222222222222222222222222222";
const poolId = `0x${"ab".repeat(32)}`;

test("v2 session hookData round-trips and recovers its signer", async () => {
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });
  const signed = await signSessionAuthorization({
    walletClient,
    account,
    version: "2",
    authorizedCaller: router,
    policyHash: 123n,
    policyRevision: 4n,
    chainId: 84532n,
    hook,
    poolId,
    action: 1,
    ttl: 600,
  });

  const decoded = decodeSessionAuthorization(signed.hookData, "2");
  assert.equal(decoded.token.user.toLowerCase(), account.address.toLowerCase());
  assert.equal(decoded.token.authorizedCaller.toLowerCase(), router.toLowerCase());
  assert.equal(decoded.token.policyHash, 123n);
  assert.equal(decoded.token.policyRevision, 4n);
  const recovered = await recoverSessionAuthorization({
    ...decoded,
    version: "2",
    hook,
    chainId: 84532n,
  });
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
});

test("v1 and v2 hookData retain the same ABI user/caller prefix", async () => {
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });
  const common = {
    walletClient,
    account,
    authorizedCaller: router,
    chainId: 84532n,
    hook,
    poolId,
    action: 1,
    ttl: 600,
  };
  const v1 = await signSessionAuthorization({
    ...common,
    version: "1",
    issuer: "0x3333333333333333333333333333333333333333",
  });
  const v2 = await signSessionAuthorization({
    ...common,
    version: "2",
    policyHash: 1n,
    policyRevision: 1n,
  });
  const prefixLength = 2 + 64 * 2;
  assert.equal(v1.hookData.slice(0, prefixLength), v2.hookData.slice(0, prefixLength));
});

test("ERC-1271 hookData preserves non-ECDSA signature bytes and the session digest", async () => {
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });
  const signed = await signSessionAuthorization({
    walletClient,
    account,
    version: "2",
    authorizedCaller: router,
    policyHash: 123n,
    policyRevision: 4n,
    chainId: 84532n,
    hook,
    poolId,
    action: 1,
    ttl: 600,
  });
  const contractSignature = "0x12345678";
  const hookData = encodeSessionAuthorization(signed.token, contractSignature, "2");
  const decoded = decodeSessionAuthorization(hookData, "2");
  assert.equal(decoded.signature, contractSignature);
  assert.equal(
    hashSessionAuthorization({ token: decoded.token, version: "2", hook, chainId: 84532n }),
    hashSessionAuthorization({ token: signed.token, version: "2", hook, chainId: 84532n }),
  );
});
