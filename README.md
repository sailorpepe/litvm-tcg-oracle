<div align="center">

<img src="assets/banner.png" alt="LitVM TCG Oracle" width="100%" />

# ⚡ LitVM TCG Oracle

**AI-Powered Trading Card Grading & On-Chain Price Oracle**

Built on [LitVM LiteForge](https://litvm.com/) — Litecoin's EVM-Compatible Layer 2

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)](LICENSE)
[![Chain](https://img.shields.io/badge/Chain-LitVM_LiteForge-00dcff.svg)](https://liteforge.explorer.caldera.xyz)
[![Status](https://img.shields.io/badge/Status-Live_on_Testnet-00ff6a.svg)](https://www.the-undesirables.com/litvm)

[Live Demo](https://www.the-undesirables.com/litvm) · [LitVM Docs](https://docs.litvm.com) · [Explorer](https://liteforge.explorer.caldera.xyz)

</div>

---

## 🔮 Overview

A decentralized price oracle and AI grading service for the $50B+ trading card market — deployed on Litecoin's Layer 2.

| Feature | Description |
|---------|-------------|
| **📊 Price Oracle** | Top 50 TCG products tracked on-chain with hourly updates |
| **🔍 AI Grader** | Upload a card → get PSA-style grade in ~60 seconds |
| **⛓️ On-Chain** | All price data lives on the LitVM LiteForge blockchain |
| **🤖 Local AI** | Qwen 2.5 VL 7B runs on dedicated hardware, not cloud APIs |

---

## 📊 Supported Categories

| Category | Products | Source |
|----------|----------|--------|
| ⚡ Pokémon | Booster boxes, packs, cases | TCGPlayer |
| 🧙 Magic: The Gathering | Collector boosters, displays | TCGPlayer |
| 🏴‍☠️ One Piece | Booster box cases, displays | TCGPlayer |
| 🐉 Dragon Ball | Booster box cases | TCGPlayer |
| 💎 Final Fantasy | Collector boosters, promos | TCGPlayer |
| 🎮 Union Arena | Booster cases | TCGPlayer |
| 🤖 Gundam | Card game displays | TCGPlayer |

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   TCGCSV API    │     │   Mac Mini Cron   │     │  TCGPriceOracle   │
│  432K products  │────▶│  litvm_updater.py │────▶│  Smart Contract   │
│                 │     │    (every hour)   │     │  (Chain ID 4441)  │
└─────────────────┘     └──────────────────┘     └───────┬───────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  User uploads   │     │   Vercel Blob    │     │    Next.js App    │
│  card photo     │────▶│   (temp relay)   │────▶│   (Frontend UI)   │
└─────────────────┘     └───────┬──────────┘     └───────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │  litvm_grader.py  │
                        │  Qwen 2.5 VL 7B  │
                        │   (via Ollama)    │
                        └──────────────────┘
```

---

## 📜 Smart Contracts

> Deployed on LitVM LiteForge Testnet (Chain ID `4441`)

| Contract | Address | Purpose |
|----------|---------|---------|
| **TCGPriceOracle** | [`0xA79C...5771`](https://liteforge.explorer.caldera.xyz/address/0xA79C6b3922949fcaBb518f56f0B6e68Ca7115771) | On-chain price feeds |
| **GradingEscrow** | [`0xe784...bB82`](https://liteforge.explorer.caldera.xyz/address/0xe784d2AE4171De8f909eb638a60BE03B2341bB82) | Grading payment (0.001 zkLTC) |
| **TCGOracleToken** | [`0x8D0A...9AD4`](https://liteforge.explorer.caldera.xyz/address/0x8D0AF701d318Be518F9ca6934B8F76Be24029AD4) | TCGO governance token (1M supply) |

---

## 🔍 AI Grading Methodology

The grader follows **PSA/Beckett standards** with four sub-categories:

```
┌─────────────┬──────────────────────────────────────────┐
│  CENTERING  │  Border ratio analysis (55/45 = PSA 10)  │
├─────────────┼──────────────────────────────────────────┤
│  CORNERS    │  Wear, whitening, rounding detection      │
├─────────────┼──────────────────────────────────────────┤
│  EDGES      │  Chipping, whitening, rough cut analysis  │
├─────────────┼──────────────────────────────────────────┤
│  SURFACE    │  Scratches, print defects, crease scan    │
└─────────────┴──────────────────────────────────────────┘
```

- Final grade is **capped by the lowest sub-score** (weakest link rule)
- Most cards grade **5-8** — a 10 is virtually impossible
- Conservative by design — matches real-world PSA expectations

---

## 🛠️ Tech Stack

```
Blockchain       LitVM LiteForge (Litecoin L2, Chain ID 4441)
Smart Contracts  Solidity ^0.8.28 (OpenZeppelin)
AI Model         Qwen 2.5 VL 7B via Ollama
Price Data       TCGPlayer market data via TCGCSV
Image Pipeline   Pillow + pillow-heif (HEIC/WebP/PNG → JPEG)
Frontend         Next.js 14 + RainbowKit + wagmi
Backend          Python 3.10+ (web3.py, requests)
Hosting          Vercel (frontend) + Mac Studio (AI)
```

---

## 📁 Project Structure

```
litvm-tcg-oracle/
├── assets/
│   └── banner.png
├── contracts/
│   └── TCGPriceOracle.sol      # On-chain price oracle
├── scripts/
│   ├── litvm_grader.py         # AI grading worker
│   └── .env.example            # Environment template
├── .gitignore
├── LICENSE                     # Business Source License 1.1
└── README.md
```

---

## ⚡ Quick Start

### Prerequisites
- Python 3.10+
- [Ollama](https://ollama.ai) with `qwen2.5vl:7b`
- Node.js 18+

### Run the AI Grader
```bash
# Install Qwen VL model
ollama pull qwen2.5vl:7b

# Setup
cd scripts
pip install web3 requests python-dotenv pillow pillow-heif
cp .env.example .env  # Add your keys

# Run
python litvm_grader.py
```

### Run the Price Oracle
```bash
cd scripts
python litvm_updater.py
```

---

## 🔗 Links

| Resource | URL |
|----------|-----|
| **Live App** | [the-undesirables.com/litvm](https://www.the-undesirables.com/litvm) |
| **Block Explorer** | [liteforge.explorer.caldera.xyz](https://liteforge.explorer.caldera.xyz) |
| **Faucet** | [liteforge.hub.caldera.xyz](https://liteforge.hub.caldera.xyz) |
| **LitVM** | [litvm.com](https://litvm.com) |

---

## 📊 Stats

- **260+** on-chain price updates
- **50** tracked products across 7 categories
- **Hourly** price refresh cycle
- **~60 second** AI grading turnaround

---

<div align="center">

**Built by [The Undesirables](https://www.the-undesirables.com)**

*The AI does the work. The blockchain makes it real.*

</div>
