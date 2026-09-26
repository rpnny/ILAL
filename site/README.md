# ILAL website and console

`index.html` is the static product overview. `mixed.html`, `mixed.css` and `mixed.js` are the single wallet-based application, served by the CLI with its local API:

```bash
node cli/dist/index.js console --manifest deployments/base-sepolia/v1.0.0-mixed-testnet.1.json --rpc https://sepolia.base.org
```

Open `http://127.0.0.1:4174`. Static hosting alone cannot run the console API. The `mixed` filenames are internal compatibility names; the product is ILAL. Historical app/console variants have been removed.
