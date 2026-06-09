#!/usr/bin/env python3
"""
TCGPriceOracleV2 — Hourly Price Updater
Pushes top 50 card prices to the V2 oracle contract using batchUpdatePricesOnly().

V1 sent 50 individual transactions (5 batches of 10).
V2 sends 1 single transaction with all 50 prices. Much cheaper.

Run from crontab:
  0 * * * * cd ~/undesirables-x402-server && source venv/bin/activate && python3 litvm_updater_v2.py >> updater_v2.log 2>&1

Prerequisites:
  - mantle_v2_deployment.json must exist (created by deploy_v2.py)
  - TCGPriceOracleV2_abi.json must exist
  - .env with BURNER_PRIVATE_KEY
  - market_memory.sqlite populated
"""

import json
import os
import sys
import sqlite3
from datetime import datetime, timezone
from web3 import Web3
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ─────────────────────────────────────────
RPC_URL = "https://rpc.sepolia.mantle.xyz"
CHAIN_ID = 5003
DB_PATH = os.path.expanduser("~/.cache/market_memory.sqlite")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ABI_PATH = os.path.join(SCRIPT_DIR, "TCGPriceOracleV2_abi.json")
DEPLOY_PATH = os.path.join(SCRIPT_DIR, "mantle_v2_deployment.json")


def load_contract_address():
    """Read the V2 contract address from deployment output."""
    if not os.path.exists(DEPLOY_PATH):
        print("  ERROR: mantle_v2_deployment.json not found. Run deploy_v2.py first.")
        sys.exit(1)
    with open(DEPLOY_PATH) as f:
        data = json.load(f)
    return data["contract_address"]


def get_top_50_prices(db_path):
    """Query SQLite for the top 50 products by market price.
    Returns only product_id, market_price, low_price — no names needed
    since products are already registered on-chain."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    latest_date = cursor.execute(
        "SELECT MAX(date) FROM price_history"
    ).fetchone()[0]

    rows = cursor.execute("""
        SELECT
            p.product_id,
            CAST(p.market_price * 100 AS INTEGER),
            CAST(p.low_price * 100 AS INTEGER)
        FROM price_history p
        JOIN cards c ON p.product_id = c.product_id
        WHERE p.date = ?
          AND p.market_price > 0
        ORDER BY p.market_price DESC
        LIMIT 50
    """, (latest_date,)).fetchall()

    conn.close()
    return rows, latest_date


def main():
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"\n  ─── V2 Oracle Update: {now} ───")

    # Validate
    private_key = os.getenv("BURNER_PRIVATE_KEY", "").strip()
    if not private_key:
        print("  ERROR: BURNER_PRIVATE_KEY not set")
        sys.exit(1)
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    # Connect
    w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 60}))
    if not w3.is_connected():
        print("  ERROR: Cannot connect to LiteForge RPC")
        sys.exit(1)

    account = w3.eth.account.from_key(private_key)
    wallet = account.address

    # Load contract
    contract_address = load_contract_address()
    with open(ABI_PATH) as f:
        abi = json.load(f)
    oracle = w3.eth.contract(address=contract_address, abi=abi)

    # Get prices from SQLite
    products, data_date = get_top_50_prices(DB_PATH)
    if len(products) == 0:
        print("  ERROR: No products found in database")
        sys.exit(1)

    ids = [p[0] for p in products]
    prices = [p[1] for p in products]
    lows = [p[2] for p in products]

    print(f"  Products:  {len(products)}")
    print(f"  Data date: {data_date}")
    print(f"  Contract:  {contract_address}")
    print(f"  Wallet:    {wallet}")

    # Send single batch transaction
    nonce = w3.eth.get_transaction_count(wallet)

    tx = oracle.functions.batchUpdatePricesOnly(
        ids, prices, lows
    ).build_transaction({
        "chainId": CHAIN_ID,
        "from": wallet,
        "nonce": nonce,
        "gas": 5000000,
        "gasPrice": w3.eth.gas_price,
    })

    signed = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"  TX sent:   {tx_hash.hex()}")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

    if receipt.status == 1:
        total = oracle.functions.totalUpdates().call()
        print(f"  ✅ Update confirmed (gas: {receipt.gasUsed}, total updates: {total})")
    else:
        print(f"  ❌ Transaction failed! TX: {tx_hash.hex()}")
        sys.exit(1)

    print(f"  ─── Done ───\n")


if __name__ == "__main__":
    main()
