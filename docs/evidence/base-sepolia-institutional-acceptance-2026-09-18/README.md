# Base Sepolia institutional acceptance — 2026-09-18

Status: **accepted**

- Transaction: [`0xcec4be62969b74bf4a330c79da69f6060b45838bd6926c5e1bad0426ae41a674`](https://sepolia.basescan.org/tx/0xcec4be62969b74bf4a330c79da69f6060b45838bd6926c5e1bad0426ae41a674)
- Block: `46978263`
- Canonical block hash: `0x9681559939af8963ac12318af3e39f8132f5665574d39cccf2cad7ce51482ff0`
- Batch ID: `0x68b6028ef8dba3b9a129407a7ad85291b0f33b15b68c75453c931246babb8626`
- Submitted: `100000` token0 / `70000` token1
- Internally matched: `70000` on each side
- AMM residual input: `30000` token0 / `0` token1
- Institution A output: `99104` token1 (`70000` matched + `29104` AMM output)
- Institution B output: `70000` token0, fully matched

The executor used only `https://sepolia.base.org`; no ILAL-operated endpoint
participated. The execute and inspect receipts are byte-identical. The Router and
Hook retained zero token inventory, the batch context closed, and both nonces
were consumed.

All JSON artifacts contain public execution evidence only. The temporary
encrypted keystores and password files used for this test were deleted after
address verification and execution.
