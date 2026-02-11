# Security Audit - Aerodrome Yield Finder

This document outlines the security considerations, threat model, and best practices for the `aerodrome-yield-finder` skill.

## 🛡️ Threat Model

The skill operates as a read-only data fetcher. It does not sign transactions or manage private keys.

- **Assets Protected**: None (stateless).
- **Attacker Capabilities**:
    - Malicious RPC endpoint (could feed false active pool data).
    - Malicious CoinGecko API (could feed false price data).

## 🔒 Secrets Management

- **API Keys**: No private API keys are required. The skill uses public endpoints for:
    - Base RPC (`https://mainnet.base.org`)
    - CoinGecko (Public API v3)
- **Environment Variables**:
    - `RPC_URL`: Optional. Used to override the default Base RPC.
    - **Recommendation**: Do not log `RPC_URL` if it contains sensitive API keys (e.g., Alchemy/Infura keys).

## 💉 Input Validation

- **Command Line Arguments**:
    - Handled by custom `parseArgs` function in `fetch_pools.js`.
    - `minTvl` is parsed via `parseFloat`.
    - `limit` and `offset` are parsed via `parseInt`.
    - **Risk**: Low. Javascript type coercion prevents command injection via these flags.

## 📦 Dependencies

- **`viem` (^2.0.0)**:
    - Standard, strictly typed library for EVM interactions.
    - Used for `publicClient.readContract` calls.
    - **Risk**: Low. Dependency is minimal and widely trusted.

## 🌐 Network Security

- **RPC Connection**:
    - Default: `https://mainnet.base.org` (Public).
    - **Risk**: Public RPCs can be slow or rate-limited, but malicious data injection is unlikely to compromise the host system beyond providing false yield info.
- **Price Feeds**:
    - Fetched from `api.coingecko.com`.
    - **Risk**: If CoinGecko is compromised or returns false data, APR calculations may be incorrect. This is a data integrity risk, not a system compromise risk.

## 📝 Output Sanitization

- **JSON Output**:
    - The script outputs strictly formatted JSON via `JSON.stringify()`.
    - Logs and debug info are directed to `stderr`.
    - **Risk**: Low. Stdout is clean for piping.

## 🚫 What NOT To Do

- **DO NOT** modify the script to accept a private key or signer. This skill is for **reading data only**.
- **DO NOT** pipe the output directly into a transaction signer without human verification of the contract addresses.
- **DO NOT** use an untrusted `RPC_URL`.

## ✅ Safe Usage

```bash
# Standard usage
./scripts/query-pools.sh --min-tvl 10000

# With custom RPC (ensure it is trusted)
RPC_URL="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY" ./scripts/query-pools.sh
```
