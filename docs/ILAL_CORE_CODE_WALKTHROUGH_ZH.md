# ILAL 核心代码大白话精读

> 适合第一次接触 Solidity、Uniswap v4 Hook、EIP-712 和零知识证明的读者。
>
> 本文只把代码实际做了什么讲清楚，不用 README 的宣传语代替实现，也不把“有测试”当作“代码一定安全”。

## 0. 先说结论：ILAL 到底是什么

ILAL 的核心不是一个 KYC NFT，也不是 CLI，更不是“用了 ZK”这件事。

它真正做的是：

> 把“谁能使用这个池子的流动性”变成 Uniswap v4 交易执行过程中的链上硬规则。

普通网站可以在前端检查 KYC，但懂合约的人可能绕过网站直接调用链上协议。ILAL 把检查放进 Hook，因此检查失败时，Uniswap 交易本身会回滚。

当前 v1 主链路由五个核心文件组成：

| 文件 | 大白话角色 | 真正负责什么 |
|---|---|---|
| [`ILALRouter.sol`](../contracts/src/ILALRouter.sol) | 柜台和搬运工 | 确认真实调用者、调用 Uniswap、结算代币、检查滑点和金额上限 |
| [`ComplianceHook.sol`](../contracts/src/ComplianceHook.sol) | 链上门卫 | 在 Swap/LP 操作前验证 Session、Policy、Credential 和 nonce |
| [`SessionLib.sol`](../contracts/src/libraries/SessionLib.sol) | 一次性通行证标准 | 定义用户签什么，并验证 EOA 签名 |
| [`PolicyRegistry.sol`](../contracts/src/PolicyRegistry.sol) | 池子规则表 | 保存每个池子接受哪家 Issuer、哪种 Credential |
| [`CNFIssuer.sol`](../contracts/src/CNFIssuer.sol) | 资格证签发处 | 根据 EAS 或 ZK 证明签发不可转让 Credential，并处理过期和撤销 |

可选 ZK 路径还涉及：

| 文件 | 作用 |
|---|---|
| [`circuits/ilal.circom`](../circuits/ilal.circom) | 证明钱包属于运营方维护的 Merkle 合格集合 |
| [`Groth16VerifierAdapter.sol`](../contracts/src/verifier/Groth16VerifierAdapter.sol) | 把生成的 verifier 接口转换成 `CNFIssuer` 使用的接口 |
| `ILALVerifier.sol` | snarkjs 自动生成的数学验证合约，不是手写业务逻辑 |

当前公开部署使用 v1、MockEAS，并关闭 ZK。`contracts/src/v2/` 是隔离的实验路径，不属于当前公开运行主链路。

---

## 1. 一张图看懂全部关系

```text
EAS Attestation                 ZK Merkle Proof（可选）
       │                                  │
       └──────────────┬───────────────────┘
                      ▼
                 CNFIssuer
              给 Alice 签发 CNF
                      │
                      ▼
Alice 本地创建并签署一次性 Session
                      │
                      ▼
                 ILALRouter
       检查 msg.sender 就是 Alice
       保存滑点/金额限制并请求 unlock
                      │
                      ▼
             Uniswap PoolManager
                      │
                      ▼
               ComplianceHook
      检查 Router、Session、签名、Policy、
             Credential、nonce
                      │
          通过        │        失败
           │          │          └── 整笔交易 revert
           ▼
PoolManager 完成 Swap 或 LP 计算
           │
           ▼
Router 根据 BalanceDelta 支付/取回代币
```

这里最重要的是两个互补检查：

```text
Router 检查：现在按下交易按钮的人是不是 Alice？
Hook 检查：这张通行证是不是真的由 Alice 签署，Alice 当前有没有资格？
```

缺少任意一边，身份闭环都不完整。

---

# 第一部分：Session——Alice 到底签了什么

## 2. `SessionLib.sol` 的职责

文件：[`contracts/src/libraries/SessionLib.sol`](../contracts/src/libraries/SessionLib.sol)

Session 可以理解为 Alice 签署的一张短期、一次性、用途明确的电子通行证。

Hook 被 PoolManager 调用时，看到的是 Router，而不是最外层的 Alice。Session 用密码学证明：

> 虽然现在是 Router 在操作，但 Alice 的确授权过这次操作。

## 3. Session 的九个字段

原代码：

```solidity
struct SessionToken {
    address user;
    address authorizedCaller;
    address cnfIssuer;
    uint256 chainId;
    address verifyingHook;
    bytes32 poolId;
    uint8 action;
    uint64 deadline;
    bytes32 nonce;
}
```

加上大白话批注：

```solidity
struct SessionToken {
    address user;
    // 通行证属于谁，例如 Alice

    address authorizedCaller;
    // 允许哪个 Router 使用，不能拿到另一个 Router

    address cnfIssuer;
    // Alice 声明使用哪家 Issuer 签发的凭证

    uint256 chainId;
    // 允许在哪条链使用，防止跨链重放

    address verifyingHook;
    // 只允许指定 Hook 验证

    bytes32 poolId;
    // 只允许操作指定 Uniswap 池

    uint8 action;
    // 1=Swap，2=添加流动性，3=移除流动性

    uint64 deadline;
    // 过期时间

    bytes32 nonce;
    // 一次性编号，成功使用后不能重放
}
```

Alice 实际签的意思是：

```text
我是 Alice。
我授权指定 ILALRouter，
使用指定 Issuer 给我的凭证，
在 Base Sepolia 上，
通过指定 ComplianceHook，
操作指定 USDC/ETH 池。
本次只允许 Swap，
十分钟后过期，
唯一编号是 12345。
```

## 4. 为什么改一个字段，签名就失效

`SESSION_TOKEN_TYPEHASH` 先固定表格的名称、字段类型、名字和顺序：

```solidity
bytes32 constant SESSION_TOKEN_TYPEHASH = keccak256(
    "SessionToken(address user,address authorizedCaller,address cnfIssuer,uint256 chainId,address verifyingHook,bytes32 poolId,uint8 action,uint64 deadline,bytes32 nonce)"
);
```

然后 `structHash()` 把模板和九个字段一起编码并哈希：

```solidity
function structHash(SessionToken memory token)
    internal
    pure
    returns (bytes32)
{
    return keccak256(
        abi.encode(
            SESSION_TOKEN_TYPEHASH,
            token.user,
            token.authorizedCaller,
            token.cnfIssuer,
            token.chainId,
            token.verifyingHook,
            token.poolId,
            token.action,
            token.deadline,
            token.nonce
        )
    );
}
```

哈希可以理解成内容指纹：

```text
原内容 → 指纹 A
只把 Swap 改成 RemoveLiquidity → 完全不同的指纹 B
```

Alice 对指纹 A 的签名不能验证指纹 B。

## 5. `domainSeparator` 防止签名跨项目使用

只签 Session 内容仍然不够。另一个项目可能使用相同字段，尝试复用 Alice 的签名。

`ComplianceHook` 在部署时生成一个 `domainSeparator`，绑定：

```text
名称：ILAL ComplianceHook
版本：1
当前 chainId
当前 Hook 地址
```

最后的 EIP-712 digest 是：

```solidity
keccak256(
    abi.encodePacked(
        "\x19\x01",
        domainSeparator,
        structHash(token)
    )
);
```

所以即使 Session 内容完全一样，只要链或 Hook 地址不同，最终指纹也不同。

## 6. EOA 签名怎样恢复地址

普通钱包的 65 字节签名包含 `r`、`s`、`v`。代码拆出这三部分：

```solidity
assembly {
    r := mload(add(sig, 32))
    s := mload(add(sig, 64))
    v := byte(0, mload(add(sig, 96)))
}
```

然后调用：

```solidity
ecrecover(h, v, r, s)
```

它会恢复出签名者地址。Hook 再检查这个地址是否等于 `token.user`。

代码还要求：

```solidity
s <= secp256k1 曲线阶的一半
v 只能是 27 或 28
```

这是拒绝 ECDSA 可塑性签名，只接受标准形式。

## 7. SessionLib 没负责什么

这个 library 只定义格式、计算指纹、恢复 EOA 地址。它不负责：

- 判断 deadline 是否过期；
- 判断 pool、chain、action 是否匹配；
- 查询 Credential；
- 记录 nonce；
- 验证 Safe/ERC-1271；
- 确认外层调用者就是 Alice。

这些由 Hook 和 Router 完成。

## 8. 当前 Session 的重要边界

Session 没有签入：

- Swap 输入金额；
- 最少输出；
- `sqrtPriceLimitX96`；
- LP tick 区间；
- 流动性数量；
- LP 最大支出或最小取回。

它表达的是：

```text
允许 Alice 在这个池做一次 Swap
```

而不是：

```text
只允许 Alice 用 100 USDC，并至少收到 0.03 ETH
```

当前 Router 要求 `msg.sender == user`，因此陌生 relayer 不能拿到 Session 后替 Alice 修改参数。但如果未来支持第三方代提交，就应考虑把交易参数也放进签名。

---

# 第二部分：Policy——这个池子接受什么资格

## 9. `PolicyRegistry.sol` 的职责

文件：[`contracts/src/PolicyRegistry.sol`](../contracts/src/PolicyRegistry.sol)

它是一张池子准入规则表：

```text
poolId
  ↓
接受哪家 Issuer
  ↓
要求哪种 Credential
  ↓
规则当前是否启用
```

## 10. Policy 的三个字段

接口定义：

```solidity
struct Policy {
    address cnfIssuer;
    bytes32 requiredCredentialType;
    bool enabled;
}
```

大白话：

```solidity
struct Policy {
    address cnfIssuer;
    // 这个池子信任哪一个凭证合约

    bytes32 requiredCredentialType;
    // 具体要求哪种资格，v1 中通常就是 EAS schemaUID

    bool enabled;
    // false 时禁止新 Swap 和添加流动性
}
```

存储结构是：

```solidity
mapping(bytes32 => Policy) private _policies;
```

从未配置的池会返回 Solidity 默认值：

```text
issuer = 0
credentialType = 0
enabled = false
```

Hook 会拒绝它。因此默认是“未配置就不准入”。

## 11. 两级管理权限

### Owner

Owner 可以：

- 给任意池设置 Policy；
- 更换池子的 Issuer；
- 关闭 Policy；
- 注册/取消 Issuer 的自助配置权。

```solidity
function setPolicy(
    bytes32 poolId,
    address cnfIssuer,
    bytes32 credentialType
) external onlyOwner
```

### 注册 Issuer

Owner 调用：

```solidity
registerIssuer(issuerA);
```

之后 Issuer A 可以调用自助版本：

```solidity
setPolicy(poolId, credentialType);
```

合约自动把 `cnfIssuer` 写成 `msg.sender`，所以 Issuer A 不能冒充 Issuer B。

如果池子已经属于 Issuer A，A 可以更新；如果属于 B，A 会收到：

```solidity
PolicyOwnedByAnotherIssuer
```

## 12. Policy 是实时生效的

Hook 每次 Swap/Add 都调用：

```solidity
policyRegistry.getPolicy(poolId)
```

因此：

- Policy 关闭后，下一笔新交易立即失败；
- Issuer 轮换后，绑定旧 Issuer 的 Session 立即失败；
- credential type 修改后，旧类型凭证立即不再满足。

这里没有缓存，也没有 timelock。

## 13. Policy 权限边界

`deregisterIssuer()` 只取消未来自助修改权，不会自动关闭已有 Policy。

更重要的是：

```solidity
disablePolicy(poolId)
```

只把 `enabled` 改为 `false`。如果原 Issuer 仍是 registered，它可以再次调用自助 `setPolicy()`，而该函数会重新写入：

```solidity
enabled: true
```

所以管理员想可靠停用某 Issuer 时，当前操作顺序必须是：

```text
先 deregisterIssuer
再逐个 disablePolicy
```

否则原 Issuer 有能力重新启用自己的 Policy。这是当前 v1 的真实治理边界。

---

# 第三部分：Credential——资格证怎样产生和失效

## 14. `CNFIssuer.sol` 的职责

文件：[`contracts/src/CNFIssuer.sol`](../contracts/src/CNFIssuer.sol)

它把外部资格证明转换成 ILAL 内部统一读取的 Credential。

有两条签发路径：

```text
路径 A：EAS Attestation → CNF
路径 B：Groth16 ZK Proof → CNF
```

最终 Hook 不关心 Alice 当初走哪条路径，只调用：

```solidity
isValid(Alice)
credentialOf(Alice)
getCredential(tokenId)
```

## 15. Credential 保存什么

接口中的结构：

```solidity
struct Credential {
    address holder;
    address issuer;
    bytes32 credentialType;
    uint64 issuedAt;
    uint64 expiresAt;
    bool revoked;
}
```

大白话：

```text
这张证属于谁
由哪个 CNFIssuer 合约签发
属于哪种证件类型
什么时候签发
什么时候过期
是否已撤销
```

当前 `credentialType` 被写为：

```solidity
credentialType: schemaUID
```

所以 PolicyRegistry 的 `requiredCredentialType` 应与该 Issuer 的 `schemaUID` 对应。

## 16. 为什么它是 ERC-721，却不能转让

CNF 使用 ERC-721，是为了拥有标准的 token ID、owner 查询和事件生态，但它是 soulbound。

它主动禁止授权：

```solidity
function approve(address, uint256) public pure override {
    revert ApprovalNotAllowed();
}

function setApprovalForAll(address, bool) public pure override {
    revert ApprovalNotAllowed();
}
```

又在底层 `_update()` 阻止“从非零地址转到另一个非零地址”：

```solidity
address from = _ownerOf(tokenId);
if (from != address(0) && to != address(0)) {
    revert TransferNotAllowed();
}
```

这允许：

- 从零地址 mint 给 Alice；
- 理论上从 Alice burn 到零地址；

但不允许：

- Alice 转给 Bob；
- Alice 授权市场替她转。

否则 Alice 可以通过 KYC 后把资格卖给别人。

## 17. 每个钱包只有一张 Credential

```solidity
mapping(address => uint256) private _holderToken;
```

mint 前检查：

```solidity
if (_holderToken[msg.sender] != 0) {
    revert CredentialAlreadyExists();
}
```

过期后不会 mint 第二张，而是对原 token 执行 renew。这样同一个钱包的资格历史不会不断生成新 token。

## 18. EAS 路径怎样 mint

Alice 调用：

```solidity
mintWithEAS(attestationUID)
```

重要的是：调用者必须是 Alice 自己。合约用 `msg.sender` 作为预期接收人。

内部 `_verifyAttestation()` 从 EAS 读取 Attestation：

```solidity
IEAS.Attestation memory a =
    eas.getAttestation(uid);
```

然后依次检查：

```solidity
if (_usedAttestations[uid])
    revert AttestationAlreadyUsed();

if (a.schema != schemaUID)
    revert WrongSchema();

if (a.attester != trustedAttester)
    revert WrongAttester();

if (a.recipient != expectedRecipient)
    revert WrongRecipient();

if (a.revocationTime != 0)
    revert AttestationRevoked();

if (
    a.expirationTime != 0
    && a.expirationTime <= block.timestamp
) revert AttestationExpired();
```

这分别防止：

- 同一份证明被重复用于签发；
- 拿错误类型的 Attestation；
- 拿不可信机构签发的 Attestation；
- 拿 Bob 的 Attestation 给 Alice 使用；
- 使用已撤销或过期证明。

通过后：

```solidity
_usedAttestations[uid] = true;
_mint(msg.sender, sourceExpiresAt, uid);
```

## 19. Credential 到期时间怎样计算

代码计算两个时间：

```text
本地期限 = 当前时间 + credentialLifetime
来源期限 = EAS/ZK 证明声明的 expiresAt
```

最终取更早的一个：

```solidity
if (
    sourceExpiresAt != 0
    && sourceExpiresAt < localExpiresAt
) return sourceExpiresAt;

return localExpiresAt;
```

例如：

```text
ILAL 默认有效 90 天
EAS Attestation 只剩 20 天
最终 Credential 只能有效 20 天
```

不能通过 ILAL 把上游证明的有效期延长。

如果 EAS 的 expirationTime 是 0，表示上游没有时间上限，ILAL 仍使用本地默认期限。

## 20. EAS 撤销是实时生效的

`isValid()` 不只查看本地 `revoked` 和 `expiresAt`。

如果 Credential 来自 EAS，它还会重新读取原 Attestation：

```solidity
bytes32 uid = sourceAttestationUID[tokenId];

if (uid == bytes32(0)) return true;

return _isSourceAttestationValid(uid, wallet);
```

所以 Attester 后来在 EAS 撤销 Attestation，不需要重新调用 ILAL，下一次 Hook 查询 `isValid()` 就会得到 false。

## 21. Owner 撤销为什么是永久的

Owner 调用：

```solidity
revoke(wallet)
```

它同时写入：

```solidity
permanentlyBanned[wallet] = true;
_credentials[tokenId].revoked = true;
```

后续 mint 和 renew 都会被阻止。

因此这里的 revoke 不是“临时暂停”，而是：

> 这个钱包地址不能再通过同一个 CNFIssuer 恢复资格。

如果业务需要申诉和恢复机制，当前 v1 没有提供。

## 22. ZK 路径怎样 mint

Alice 调用：

```solidity
mintWithProof(proof, publicInputs)
```

公开输入顺序必须是：

```text
[0] walletHash
[1] issuerHash
[2] schemaHash
[3] expiresAt
[4] revealFlags
[5] merkleRoot
```

`CNFIssuer` 先做业务绑定：

```solidity
expectedWalletHash =
    uint256(keccak256(abi.encodePacked(msg.sender))) >> 4;
```

然后检查：

```text
证明绑定当前 msg.sender
issuerHash 等于管理员配置值
schemaHash 等于管理员配置值
merkleRoot 等于当前批准 root
expiresAt 仍在未来
```

最后把 proof 解码为 Groth16 的 `a/b/c` 点并调用 verifier。

## 23. ZK 配置为什么有 timelock

如果管理员能瞬间替换 verifier 或 Merkle root，他可以临时换成一个恶意版本，给不合格用户签发，再换回来。

所以代码采用“先提议、等待、再激活”：

```text
Verifier：72 小时
Merkle root：48 小时
Issuer/schema domain：72 小时
```

例如 verifier：

```solidity
proposeZKVerifier(newVerifier);
// 等 72 小时
activateZKVerifier();
```

这给监控系统和治理参与者留下发现异常的时间。

注意：timelock 只提供反应窗口，不会自动阻止恶意更新。没有监控和响应机制时，等待时间本身不等于安全。

## 24. ZK Credential 的重要边界

EAS Credential 每次 `isValid()` 都重新检查上游 Attestation。

ZK Credential 的 `sourceAttestationUID` 是零，因此 mint 成功后，`isValid()` 只检查：

```text
本地 expiresAt
本地 revoked
```

之后更换 Merkle root 不会自动使已经 mint 的 ZK Credential 失效。ZK root 主要控制“谁现在可以 mint/renew”，不是历史 Credential 的实时撤销列表。

---

# 第四部分：ZK 电路——它到底证明了什么

## 25. `circuits/ilal.circom` 的真实语义

文件：[`circuits/ilal.circom`](../circuits/ilal.circom)

运营方在链下维护一棵 Merkle tree。每个叶子是：

```text
Poseidon(
    walletField,
    kycLevel,
    countryCode,
    expiresAt
)
```

Alice 私下持有：

- 钱包地址；
- KYC level；
- 国家代码；
- Merkle path。

她公开：

- 钱包哈希；
- issuer/schema 哈希；
- 到期时间；
- Merkle root。

证明要说明：

```text
我知道一个钱包地址；
它的哈希等于公开 walletHash；
这个钱包和私密属性组成的叶子，
确实属于公开 Merkle root。
```

但不公开具体 walletField、KYC level、countryCode 和 Merkle path。

## 26. 电路的五步

### 第一步：地址字段和 160 个 bit 必须一致

```solidity
bits2num.out === walletField;
```

防止证明者用一套 bit 计算 walletHash，却用另一个 walletField 构造 Merkle leaf。

### 第二步：计算 walletHash

电路对钱包地址的 20 字节执行 Keccak，并右移 4 位以放入 BN254 field：

```text
walletHash = keccak256(walletAddress) >> 4
```

链上 `CNFIssuer` 对 `msg.sender` 做完全相同计算，因此 Bob 不能使用 Alice 的 proof。

### 第三步：计算叶子

```text
leaf = Poseidon(
    walletField,
    kycLevel,
    countryCode,
    expiresAt
)
```

### 第四步：验证 Merkle path

电路从叶子和私密 path 重建 root，并要求：

```solidity
merkleRoot === merkle.root;
```

链上再要求这个 root 等于管理员批准的 `CNFIssuer.merkleRoot`。

### 第五步：基础约束

当前 v1 只要求：

```text
kycLevel 在 0 到 3 之间
expiresAt > 0
revealFlags == 0
```

## 27. v1 电路没有证明什么

这一点必须说清楚。

它没有独立证明：

```text
kycLevel 至少为 institutional
countryCode 不属于受限国家
满足某个池子的私密政策
```

甚至 `kycLevel = 0` 也满足当前“0 到 3”的范围约束。

因此 v1 的“合格”主要依赖：

> 运营方只把真正合格的记录放进 Merkle tree。

换句话说，它证明的是“属于运营方批准的集合”，而不是电路自己判断“这个人一定达到机构级 KYC”。

这也是 v2 电路尝试补充 minimum tier、jurisdiction root 和 policy binding 的原因，但 v2 当前不在公开部署中。

---

# 第五部分：Verifier Adapter——为什么多这一层

## 28. `Groth16VerifierAdapter.sol`

文件：[`contracts/src/verifier/Groth16VerifierAdapter.sol`](../contracts/src/verifier/Groth16VerifierAdapter.sol)

snarkjs 自动生成的 verifier 接受固定数组：

```solidity
uint256[6] pubSignals
```

而 `CNFIssuer` 使用统一接口：

```solidity
uint256[] publicInputs
```

Adapter 只做接口转换：

```solidity
require(
    publicInputs.length == 6,
    "Adapter: wrong pubSignals length"
);

uint256[6] memory pub;

for (uint256 i = 0; i < 6; i++) {
    pub[i] = publicInputs[i];
}

return verifier.verifyProof(a, b, c, pub);
```

它不判断 Alice 是否合格，也不解释六个数字的业务含义。业务绑定由 `CNFIssuer` 完成，数学证明由生成的 verifier 完成。

---

# 第六部分：ComplianceHook——真正决定交易能否继续

## 29. Hook 为什么不是配饰

文件：[`contracts/src/ComplianceHook.sol`](../contracts/src/ComplianceHook.sol)

它实现 Uniswap v4 的 `IHooks`，并启用：

```text
beforeSwap
beforeAddLiquidity
beforeRemoveLiquidity
```

真实部署的 PoolKey 把 `ComplianceHook` 地址写在 `hook` 字段里。因此 PoolManager 在对应动作前会调用它。

失败时 Hook 直接 revert，整个 Uniswap 操作一起回滚。

## 30. 两层入口验证

第一层：

```solidity
if (msg.sender != address(poolManager)) {
    revert OnlyPoolManager();
}
```

只有指定 PoolManager 能直接调用 Hook。

第二层：

```solidity
if (caller != authorizedRouter) {
    revert RouterNotAuthorized();
}
```

PoolManager 传入的操作发起者必须是指定 ILALRouter。

所以路径被固定为：

```text
指定 Router → 指定 PoolManager → 指定 Hook
```

## 31. `_verifySession()` 的完整检查

Hook 解码：

```solidity
(SessionToken token, bytes sig) =
    abi.decode(hookData, ...);
```

随后检查：

```text
调用者是固定 Router
Session 未过期
Session 授权的 Router 等于当前 Router
chainId 等于当前链
verifyingHook 等于当前 Hook
poolId 等于当前池
action 等于当前动作
```

然后计算 EIP-712 digest 并验证签名。

EOA 使用 `ecrecover`；合约钱包使用 ERC-1271：

```solidity
IERC1271(user).isValidSignature(h, sig)
```

## 32. Policy 和 Credential 检查

对于 Swap 和 Add：

```solidity
Policy policy =
    policyRegistry.getPolicy(poolId);

if (!policy.enabled)
    revert PolicyNotConfigured();

if (policy.cnfIssuer != token.cnfIssuer)
    revert PolicyIssuerMismatch();

if (!issuer.isValid(token.user))
    revert CredentialInvalid();

if (
    credential.credentialType
    != policy.requiredCredentialType
) revert CredentialTypeMismatch();
```

这是真正把 Policy、Credential 与 Uniswap 执行连接起来的地方。

## 33. 为什么 Remove 不检查 Credential

代码特意判断：

```solidity
bool isExit =
    action == ACTION_REMOVE_LIQUIDITY;

if (!isExit) {
    // Policy + Credential checks
}
```

因此资格失效后：

```text
不能 Swap
不能继续 Add
仍能 Remove 自己的仓位
```

退出仍需正确 Router、Hook、pool、action、签名和 nonce，只是不再依赖会变化的 Policy/Credential。

设计原则是：

> 可以阻止新增风险，但不能因为后续资格变化锁住用户本金。

## 34. nonce bitmap 怎样防重放

一个 `bytes32 nonce` 被拆成：

```text
高 248 位 → bitmap 的第几个 word
低 8 位 → word 内第几个 bit
```

成功验证后写入：

```solidity
uint256 mask = uint256(1) << bitPos;
uint256 word = nonceBitmap[user][wordPos];

if (word & mask != 0) {
    revert NonceAlreadyUsed();
}

nonceBitmap[user][wordPos] = word | mask;
```

同一 Session 第二次使用会失败。

如果后续滑点或资金结算失败，整笔交易回滚，nonce 写入也会回滚，因此失败交易不会永久浪费 nonce。

## 35. verified-flow 动态费率

如果 Pool 使用 Uniswap v4 dynamic fee，Hook 返回：

```solidity
500 | OVERRIDE_FEE_FLAG
```

即给这次已验证流量设置 0.05% LP fee。静态费率池不会被覆盖。

这与 Router 收到 treasury 的 protocol fee 是两种不同费用。

## 36. Hook 的实现边界

- 构造函数没有检查 PoolManager、Registry、Router 是否为零地址，错误部署可能永久不可用。
- Hook 本身看不到最外层 Alice，所以必须依赖 Router 检查 `msg.sender == token.user`。
- Session 不绑定交易金额和价格参数。
- ERC-1271 的行为取决于具体智能钱包实现。

---

# 第七部分：ILALRouter——调用 Uniswap 并真正搬钱

## 37. Router 的三个入口

文件：[`contracts/src/ILALRouter.sol`](../contracts/src/ILALRouter.sol)

```text
swap
addLiquidity
removeLiquidity
```

每个入口都会：

1. 验证基本参数；
2. 验证 Session 前两个字段；
3. 把调用者和参数编码进 `CallbackData`；
4. 调用 `poolManager.unlock()`。

## 38. Router 怎样确认当前人就是 Alice

所有 v1/v2 Session 的前两个 ABI word 都设计为：

```text
user
authorizedCaller
```

Router 直接读取前 64 字节：

```solidity
assembly {
    userWord :=
        calldataload(hookData.offset)

    callerWord :=
        calldataload(
            add(hookData.offset, 32)
        )
}
```

然后检查：

```solidity
if (address(uint160(userWord)) != msg.sender) {
    revert SessionUserMismatch();
}

if (
    address(uint160(callerWord))
    != address(this)
) {
    revert SessionCallerMismatch();
}
```

所以 Bob 不能拿 Alice 的未使用 Session 调用 Router。

Router 只读稳定前缀；Session 的完整版本和签名由对应 Hook 解码和验证。

## 39. 为什么要 `unlockCallback`

Uniswap v4 使用 flash accounting。

Router 先调用：

```solidity
poolManager.unlock(callbackData)
```

PoolManager 再回调：

```solidity
router.unlockCallback(callbackData)
```

Router 在回调中调用：

```solidity
poolManager.swap(...)
```

或：

```solidity
poolManager.modifyLiquidity(...)
```

PoolManager 先计算整次操作的余额变化，Router 必须在 unlock 窗口结束前把账结清。

`unlockCallback` 还检查：

```solidity
msg.sender == poolManager
```

攻击者不能伪造一张账单直接要求 Router 付款。

## 40. `BalanceDelta` 是一张账单

例如 Alice 用 100 USDC 换到 0.03 ETH：

```text
USDC delta = -100
ETH  delta = +0.03
```

规则：

```text
负数：用户欠 PoolManager
正数：PoolManager 欠用户
零：不处理
```

Router 的 `_settle()`：

```solidity
if (delta < 0) {
    poolManager.sync(currency);
    transferFrom(
        payer,
        poolManager,
        amount
    );
    poolManager.settle();
}

if (delta > 0) {
    poolManager.take(
        currency,
        payer,
        amount
    );
}
```

所以输入代币从 Alice 去 PoolManager，输出代币从 PoolManager 直接给 Alice。

## 41. Swap 滑点保护

Alice 可以设置：

```text
最少收到 minAmountOut
```

PoolManager 计算后：

```solidity
if (actualOut < minAmountOut) {
    revert SlippageTooHigh(
        actualOut,
        minAmountOut
    );
}
```

检查在链上执行。失败时 Swap、Hook nonce 和所有余额变化一起回滚。

传入 `minAmountOut = 0` 会主动关闭保护；CLI 会要求用户明确选择，但低层合约调用仍允许 0。

## 42. LP 金额保护

添加流动性：

```text
maxAmount0 = token0 最多支付多少
maxAmount1 = token1 最多支付多少
```

移除流动性：

```text
minAmount0 = token0 最少取回多少
minAmount1 = token1 最少取回多少
```

PoolManager 计算完真实 delta 后，Router 再检查这些边界，所以不是前端提示。

## 43. 不同用户的 LP 仓位怎样隔离

PoolManager 看到的仓位所有者都是 Router。若只使用用户给的 salt，Alice 和 Bob 可能碰到同一仓位键。

Router 改写 salt：

```solidity
positionSalt =
    keccak256(
        abi.encode(user, userSalt)
    );
```

即使 Alice 和 Bob 使用相同 tick 和 `userSalt=123`：

```text
hash(Alice, 123) != hash(Bob, 123)
```

所以 Alice 不能复制 Bob 的公开参数移除 Bob 的仓位。

## 44. 协议费怎样收

Router 在 Swap 完成后，根据实际消耗的输入量收：

```solidity
feeAmount =
    actualAmountIn
    * protocolFeePips
    / 1_000_000;
```

如果计划输入 100，但因价格限制只成交 40，就按 40 收费。

费率在部署时固定，且构造函数要求：

```text
protocolFeePips <= 0.10%
```

如果协议费转账失败，整笔交易回滚。

## 45. ERC-20 支持边界

当前 Router：

- 只支持 ERC-20 池；
- 不支持原生 ETH；
- 支持 `transferFrom` 返回 true；
- 也兼容不返回数据的老式 ERC-20。

它没有完整保证 fee-on-transfer、rebasing、恶意回调等非标准 token 行为。

## 46. Router 中发现的 exact-output 缺口

仓库声明 exact-output 不支持，并定义：

```solidity
error ExactOutputNotSupported();
```

但检查只出现在 `_quoteProtocolFee()`：

```solidity
if (params.amountSpecified > 0) {
    revert ExactOutputNotSupported();
}
```

真正的 `swap()` 入口没有相同检查。

这意味着低层调用者可能直接提交 exact-output Swap，而当前只提供 `minAmountOut`，没有 exact-output 所需的 `maxAmountIn` 保护。

如果产品明确只支持 exact-input，修复应在 `swap()` 入口增加：

```solidity
if (params.amountSpecified > 0) {
    revert ExactOutputNotSupported();
}
```

并增加直接执行 `swap()` 的 exact-output 回归测试。当前测试只验证报价函数会拒绝。

---

# 第八部分：完整流程演示

## 47. EAS Credential 签发

假设 Coinbase/EAS 已为 Alice 创建 Attestation。

```text
Alice 调用 CNFIssuer.mintWithEAS(uid)
    ↓
检查 uid 没被使用
    ↓
从 EAS 读取 Attestation
    ↓
检查 schema、attester、recipient、撤销和过期状态
    ↓
记录 uid 已使用
    ↓
为 Alice mint 不可转让 CNF
    ↓
记录 expiresAt 和 sourceAttestationUID
```

以后 Hook 调用 `isValid(Alice)` 时，CNFIssuer 会再次读取 EAS，所以来源撤销实时生效。

## 48. 一次成功 Swap

```text
1. Alice 查询 PoolKey 和 Policy

2. Alice 构造 Session：
   user = Alice
   authorizedCaller = Router
   cnfIssuer = Issuer A
   chainId = Base Sepolia
   verifyingHook = Hook
   poolId = USDC/ETH
   action = Swap
   deadline = 十分钟后
   nonce = 随机唯一值

3. Alice 对 EIP-712 digest 签名

4. Alice 调用 Router.swap(...)

5. Router 检查：
   hookData.user == msg.sender == Alice
   hookData.authorizedCaller == Router

6. Router 调用 PoolManager.unlock()

7. PoolManager 回调 Router.unlockCallback()

8. Router 调用 PoolManager.swap()

9. PoolManager 调用 Hook.beforeSwap()

10. Hook 检查：
    只能由 PoolManager 调用
    sender 必须是固定 Router
    Session 未过期
    chain/hook/pool/action 全匹配
    Alice 签名有效
    当前 Policy 启用
    Session Issuer 与 Policy 一致
    Alice Credential 有效且类型匹配
    nonce 未使用

11. Hook 标记 nonce 并返回允许

12. PoolManager 计算 BalanceDelta

13. Router 检查 actualOut >= minAmountOut

14. Router 根据 delta：
    从 Alice 收输入 token
    从 PoolManager 给 Alice 输出 token

15. Router 按实际输入收 protocol fee

16. 整笔交易提交
```

## 49. 无效 Credential 为什么失败

步骤 10 中：

```solidity
issuer.isValid(Alice) == false
```

Hook 抛出：

```solidity
CredentialInvalid()
```

异常沿调用链向上传播：

```text
Hook revert
→ PoolManager.swap revert
→ unlockCallback revert
→ Router.swap revert
→ 整笔链上交易回滚
```

这就是“合规不是装饰”的直接证据。

## 50. nonce 重放为什么失败

第一次成功时：

```text
nonce bit：0 → 1
```

第二次提交同一 Session：

```text
Hook 发现 nonce bit 已经是 1
→ NonceAlreadyUsed()
→ 整笔交易回滚
```

攻击者即使复制完整交易数据，也不能再次使用。

## 51. 资格失效后怎样退出 LP

```text
Alice 的 Credential 被撤销
    ↓
Alice 再 Swap → CredentialInvalid
    ↓
Alice 签署 action=RemoveLiquidity 的新 Session
    ↓
Router 确认调用者就是 Alice
    ↓
Hook 验证签名、pool、action、nonce
    ↓
Hook 识别这是退出，不检查当前 Policy/Credential
    ↓
Router 使用 hash(Alice, userSalt) 定位 Alice 的仓位
    ↓
PoolManager 移除流动性
    ↓
Router 检查最少取回数量并把 token 给 Alice
```

这实现了“禁止新增风险，但不锁本金”。

## 52. ZK mint 流程

```text
运营方把合格记录加入链下 Merkle tree
    ↓
把 root 经过 timelock 更新到 CNFIssuer
    ↓
Alice 在本地使用私密属性和 Merkle path 生成 Groth16 proof
    ↓
Alice 调用 mintWithProof
    ↓
CNFIssuer 检查公开 walletHash 对应 msg.sender
    ↓
检查 issuerHash/schemaHash/root/expiresAt
    ↓
Adapter 把动态数组转换成固定 uint[6]
    ↓
生成 verifier 验证数学证明
    ↓
通过后为 Alice mint CNF
```

注意：v1 是“运营方集合成员证明”，不是电路自行执行每个池子的复杂合规政策。

---

# 第九部分：部署时为什么需要 HookMiner

## 53. `HookMiner.sol`

文件：[`contracts/src/libraries/HookMiner.sol`](../contracts/src/libraries/HookMiner.sol)

Uniswap v4 通过 Hook 地址最低若干 bit 判断哪些回调启用。ILAL 需要：

```text
beforeSwap            0x0080
beforeAddLiquidity    0x0800
beforeRemoveLiquidity 0x0200
合计                  0x0A80
```

普通部署无法选择最终地址。`HookMiner` 遍历 CREATE2 salt，预先计算地址：

```solidity
for (uint256 i = 0; i < 100_000; i++) {
    salt = bytes32(i);
    hookAddress =
        computeCreate2Address(...);

    if (
        uint160(hookAddress)
        & ALL_HOOK_MASK
        == flags
    ) {
        return (hookAddress, salt);
    }
}
```

找到低位满足 `0x0A80` 的地址后，用该 salt 部署 Hook。

这是部署辅助代码，不参与每笔交易，但没有它就不能稳定得到符合 Uniswap v4 权限编码要求的 Hook 地址。

---

# 第十部分：哪些文件是接口，哪些是生成代码

## 54. Interfaces

`contracts/src/interfaces/` 中的文件主要定义“两个模块如何对话”：

```text
IPolicyRegistry：Hook 怎样读取 Policy
ICNFIssuer：Hook 怎样读取 Credential
IEAS：CNFIssuer 怎样读取 Attestation
IGroth16Verifier：CNFIssuer 怎样调用证明验证器
```

接口本身通常不保存状态、不执行业务，只规定函数和数据结构。真正逻辑在实现合约中。

## 55. `ILALVerifier.sol`

这是 snarkjs 根据 circuit 和 zkey 自动生成的椭圆曲线配对验证代码。

审查重点不是逐行欣赏生成代码，而是验证完整产物链：

```text
Circom source
→ R1CS
→ trusted setup / zkey
→ verification key
→ Solidity verifier
→ deployed bytecode
```

并确认所有 hash 对得上。当前仓库明确把 production ceremony 和独立审计列为未完成事项。

---

# 第十一部分：当前架构的信任边界

## 56. 必须信任谁

即使所有代码没有 bug，v1 仍需要信任：

- PolicyRegistry Owner/Safe；
- CNFIssuer Owner/Safe；
- EAS 合约；
- trustedAttester；
- ZK Merkle tree 运营方；
- ZK ceremony 和 verifier 产物；
- 指定 Uniswap PoolManager；
- treasury 和发布流程。

链上代码能严格执行配置，但不能判断管理员输入的配置在现实世界是否诚实。

## 57. 管理员能做什么

Policy Owner 可以：

- 更换池子的 Issuer；
- 改 credential type；
- 关闭 Policy；
- 注册 Issuer。

CNFIssuer Owner 可以：

- 永久 revoke 钱包；
- 经过 timelock 更新 ZK verifier/root/domain。

Router 的 treasury 和 protocol fee 是 immutable，部署后不能修改。

Hook 的 PoolManager、Registry、Router 也是 immutable。

## 58. 当前已确认的主要实现边界

| 边界 | 影响 |
|---|---|
| `swap()` 未真正拒绝 exact-output | 低层 exact-output 调用没有 `maxAmountIn` 保护 |
| Policy disable 可被仍注册的原 Issuer重新启用 | 管理员停用必须先 deregister 再 disable |
| Session 不绑定金额和价格参数 | 当前依赖 `msg.sender == user`；未来 relayer 设计需扩展 |
| v1 ZK 不强制 minimum tier/country policy | “合格”依赖运营方只把合格记录加入 tree |
| ZK root 更新不撤销已 mint Credential | 旧 ZK Credential 只受本地 expiry/revoke 控制 |
| 非标准 ERC-20 覆盖不足 | 上主网前需恶意 token、fee-on-transfer、reentrancy 测试 |
| 多个管理动作无原子批处理 | 运维顺序和 Safe calldata 审查很重要 |
| 未独立审计 | 当前只能视为 testnet/PoC 软件 |

---

# 第十二部分：怎样判断这些代码是不是“配饰”

## 59. 反事实检查

最简单的方法是问：删除这个文件，系统会失去什么？

### 删除 `SessionLib`

- 无法定义可验证的用户授权；
- 无法绑定 chain/hook/pool/action；
- Hook 无法恢复 EOA 签名者。

### 把 `PolicyRegistry` 换成假数据

- 池子不能分别设置准入要求；
- Issuer 和 credential type 检查失去依据。

### 把 `CNFIssuer` 换成永远返回 true

- 任何用户都被视为合格；
- EAS、过期、撤销、ZK 全部失去作用。

### 把 `ComplianceHook` 换成 no-op

- 无 Credential 用户也能交易；
- Session 可重放；
- Policy 不再影响 PoolManager；
- 资格撤销无法阻止新交易。

### 删除 `ILALRouter`

- Hook 看不到真实最终用户；
- 没有资金结算；
- 没有链上滑点/LP 金额保护；
- 多用户 LP 仓位无法安全隔离。

这五个模块都处在实际调用链上，并能通过 state change 或 revert 改变交易结果，因此不是展示层装饰。

---

# 最后的记忆版本

如果只记住六句话：

1. `CNFIssuer` 把 EAS/ZK 资格证明变成不可转让的链上 Credential。
2. `PolicyRegistry` 规定每个池子接受哪家 Issuer、哪种 Credential。
3. `SessionLib` 让 Alice 签署一张绑定链、Hook、池、动作、期限和 nonce 的一次性通行证。
4. `ILALRouter` 确认当前调用者就是 Alice，并负责调用 Uniswap、滑点保护和代币结算。
5. `ComplianceHook` 在 Uniswap 执行前验证 Session、Policy、Credential 和 nonce，失败就让整笔交易回滚。
6. 资格失效会阻止新的 Swap/Add，但 Alice 仍能签名退出自己的 LP，避免本金被锁。

ILAL 的核心闭环可以压缩成：

```text
谁有资格（Credential）
    +
这个池要求什么（Policy）
    +
用户这次授权什么（Session）
    +
谁真正来提交和结算（Router）
    +
交易前强制执行（Hook）
```

这五部分一起，才构成 ILAL。
