# LitVM TCG Oracle

A decentralized TCG Price Oracle and AI Card Grader built on [LitVM LiteForge](https://litvm.com/) — Litecoin's EVM-compatible Layer 2.

## What It Does

### 📊 Price Oracle
Tracks the **top 50 most valuable trading card products** across Pokémon, Magic: The Gathering, One Piece, Dragon Ball, Final Fantasy, Union Arena, and Gundam. Prices update hourly from TCGPlayer market data and are written on-chain to the `TCGPriceOracle` smart contract.

### 🔍 AI Card Grader
Upload a photo of any trading card and receive an instant PSA-style grade report. The AI vision model (Qwen 2.5 VL 7B) analyzes:
- **Centering** — border ratio analysis
- **Corners** — wear, whitening, rounding
- **Edges** — chipping, whitening, rough cuts
- **Surface** — scratches, print defects, creases

Grades follow PSA methodology: final score capped by the weakest sub-score.

## Architecture

```
TCGCSV (432K products)
    │
    ▼
litvm_updater.py ──── hourly cron ────▶ TCGPriceOracle Contract
                                           │
                                           ▼
                                     Frontend (Next.js)
                                           │
User uploads card photo ──▶ Vercel Blob ──▶ litvm_grader.py
                                           │
                                    Qwen 2.5 VL (Ollama)
                                           │
                                    Grade Report ──▶ User
```

## Smart Contracts (LiteForge Testnet — Chain ID 4441)

| Contract | Address | Purpose |
|----------|---------|---------|
| TCGPriceOracle | `0xA79C6b3922949fcaBb518f56f0B6e68Ca7115771` | On-chain price feeds |
| GradingEscrow | `0xe784d2AE4171De8f909eb638a60BE03B2341bB82` | Grading payment |
| TCGOracleToken | `0x8D0AF701d318Be518F9ca6934B8F76Be24029AD4` | TCGO governance token |

## Tech Stack

- **Chain**: LitVM LiteForge (Litecoin L2, EVM-compatible)
- **AI Model**: Qwen 2.5 VL 7B via Ollama on dedicated hardware
- **Price Data**: TCGPlayer via TCGCSV
- **Frontend**: Next.js + RainbowKit
- **Backend**: Python (web3.py, requests, Pillow)

## Project Structure

```
contracts/          — Solidity smart contracts
scripts/
  litvm_updater.py  — Price oracle cron (hourly)
  litvm_grader.py   — AI grading worker (polls every 60s)
```

## Setup

### Prerequisites
- Python 3.10+
- Ollama with `qwen2.5vl:7b` model
- Node.js 18+

### Price Oracle
```bash
cd scripts
pip install web3 requests python-dotenv
cp .env.example .env  # Add your LITVM_TESTNET_PK
python litvm_updater.py
```

### AI Grader
```bash
ollama pull qwen2.5vl:7b
pip install web3 requests python-dotenv pillow pillow-heif
python litvm_grader.py
```

## Live Demo

🔗 [the-undesirables.com/litvm](https://www.the-undesirables.com/litvm)

## License

MIT

## Built By

[The Undesirables](https://www.the-undesirables.com) — Building on @LitecoinVM
