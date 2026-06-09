#!/usr/bin/env python3
"""
Merkle Tree Builder — Generates a Merkle root from the full SQLite database
and pushes it on-chain to the MerklePriceOracle contract.

This commits 432K+ product prices to a single 32-byte hash on-chain.
Anyone can verify any individual price by requesting a Merkle proof from the API.

Run daily after the pipeline finishes:
  cd ~/undesirables-x402-server
  source venv/bin/activate
  python3 merkle_builder.py

Leaf encoding (matches Solidity):
  keccak256(bytes.concat(keccak256(abi.encode(productId, categoryId, name, marketPrice, lowPrice))))
"""

import json
import os
import sys
import sqlite3
import struct
from datetime import datetime, timezone
from eth_abi import encode as abi_encode
from web3 import Web3
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ─────────────────────────────────────────
RPC_URL = "https://rpc.sepolia.mantle.xyz"
CHAIN_ID = 4441
DB_PATH = os.path.expanduser("~/.cache/market_memory.sqlite")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ABI_PATH = os.path.join(SCRIPT_DIR, "MerklePriceOracle_abi.json")
DEPLOY_PATH = os.path.join(SCRIPT_DIR, "mantle_merkle_deployment.json")
TREE_CACHE_PATH = os.path.join(SCRIPT_DIR, "mantle_merkle_tree_cache.json")


def keccak256(data: bytes) -> bytes:
    """Compute keccak256 hash."""
    return Web3.keccak(data)


def compute_leaf(product_id: int, category_id: int, name: str,
                 market_price: int, low_price: int) -> bytes:
    """
    Compute a leaf hash matching the Solidity contract.
    Uses OpenZeppelin's double-hash standard to prevent second-preimage attacks.
    
    Solidity: keccak256(bytes.concat(keccak256(abi.encode(productId, categoryId, name, marketPrice, lowPrice))))
    """
    # abi.encode(uint256, uint16, string, uint256, uint256)
    inner = abi_encode(
        ["uint256", "uint16", "string", "uint256", "uint256"],
        [product_id, category_id, name, market_price, low_price]
    )
    inner_hash = keccak256(inner)
    # Double hash (OZ standard)
    return keccak256(inner_hash)


def build_merkle_tree(leaves: list[bytes]) -> tuple[bytes, list[list[bytes]]]:
    """
    Build a Merkle tree from leaf hashes.
    Returns (root, tree_levels) where tree_levels[0] = leaves, tree_levels[-1] = [root].
    """
    if not leaves:
        raise ValueError("No leaves to build tree from")

    # Pad to power of 2
    padded = list(leaves)
    while len(padded) & (len(padded) - 1):
        padded.append(b"\x00" * 32)
    if len(padded) == 1:
        padded.append(b"\x00" * 32)

    tree = [padded]
    current = padded

    while len(current) > 1:
        next_level = []
        for i in range(0, len(current), 2):
            left = current[i]
            right = current[i + 1] if i + 1 < len(current) else b"\x00" * 32
            # Sort pair (OpenZeppelin standard — smaller hash first)
            if left < right:
                pair = left + right
            else:
                pair = right + left
            next_level.append(keccak256(pair))
        tree.append(next_level)
        current = next_level

    root = current[0]
    return root, tree


def get_proof(tree: list[list[bytes]], leaf_index: int) -> list[bytes]:
    """Get the Merkle proof for a leaf at the given index."""
    proof = []
    idx = leaf_index

    for level in range(len(tree) - 1):
        layer = tree[level]
        sibling_idx = idx + 1 if idx % 2 == 0 else idx - 1
        if sibling_idx < len(layer):
            proof.append(layer[sibling_idx])
        else:
            proof.append(b"\x00" * 32)
        idx //= 2

    return proof


def load_all_products(db_path: str) -> list[tuple]:
    """Load ALL products from the database with latest prices."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    latest_date = cursor.execute(
        "SELECT MAX(date) FROM price_history"
    ).fetchone()[0]

    rows = cursor.execute("""
        SELECT
            p.product_id,
            c.category_id,
            c.name,
            CAST(p.market_price * 100 AS INTEGER),
            CAST(p.low_price * 100 AS INTEGER)
        FROM price_history p
        JOIN cards c ON p.product_id = c.product_id
        WHERE p.date = ?
          AND p.market_price > 0
        ORDER BY p.product_id ASC
    """, (latest_date,)).fetchall()

    conn.close()
    return rows, latest_date


def build_and_push(deploy_only=False):
    """Build the Merkle tree and push the root on-chain."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"\n  === Merkle Tree Builder: {now} ===")

    # Load all products
    products, data_date = load_all_products(DB_PATH)
    print(f"  Products: {len(products):,}")
    print(f"  Data date: {data_date}")

    if not products:
        print("  ERROR: No products found")
        sys.exit(1)

    # Build leaves
    print("  Building leaves...")
    leaves = []
    product_index = {}  # productId -> leaf index (for proof lookups)

    for i, (pid, cat, name, market, low) in enumerate(products):
        leaf = compute_leaf(pid, cat, name, market, low)
        leaves.append(leaf)
        product_index[pid] = i

    # Build tree
    print("  Building Merkle tree...")
    root, tree = build_merkle_tree(leaves)
    root_hex = "0x" + root.hex()
    print(f"  Root: {root_hex}")
    print(f"  Tree depth: {len(tree)} levels")

    # Save tree cache for proof generation
    cache = {
        "root": root_hex,
        "data_date": data_date,
        "total_products": len(products),
        "built_at": now,
        "product_index": {str(k): v for k, v in product_index.items()},
        # Store leaves and tree as hex for JSON serialization
        "leaves": ["0x" + l.hex() for l in leaves],
        "tree": [["0x" + node.hex() for node in level] for level in tree],
    }

    with open(TREE_CACHE_PATH, "w") as f:
        json.dump(cache, f)
    cache_size_mb = os.path.getsize(TREE_CACHE_PATH) / (1024 * 1024)
    print(f"  Cache saved: {TREE_CACHE_PATH} ({cache_size_mb:.1f} MB)")

    if deploy_only:
        print("  [deploy_only] Skipping on-chain push")
        return

    # Push root on-chain
    print("  Pushing root on-chain...")

    private_key = os.getenv("LITVM_TESTNET_PK", os.getenv("BURNER_PRIVATE_KEY", "")).strip()
    if not private_key:
        print("  ERROR: No private key found in .env")
        sys.exit(1)
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    if not os.path.exists(ABI_PATH):
        print(f"  ERROR: ABI not found: {ABI_PATH}")
        sys.exit(1)
    if not os.path.exists(DEPLOY_PATH):
        print(f"  ERROR: Deployment file not found: {DEPLOY_PATH}")
        sys.exit(1)

    with open(ABI_PATH) as f:
        abi = json.load(f)
    with open(DEPLOY_PATH) as f:
        contract_address = json.load(f)["contract_address"]

    w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 60}))
    if not w3.is_connected():
        print("  ERROR: Cannot connect to RPC")
        sys.exit(1)

    account = w3.eth.account.from_key(private_key)
    wallet = account.address
    oracle = w3.eth.contract(address=contract_address, abi=abi)

    nonce = w3.eth.get_transaction_count(wallet)
    tx = oracle.functions.updateMerkleRoot(
        root, len(products)
    ).build_transaction({
        "chainId": CHAIN_ID,
        "from": wallet,
        "nonce": nonce,
        "gas": 200000,
        "gasPrice": w3.eth.gas_price,
    })

    signed = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"  TX: {tx_hash.hex()}")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    if receipt.status == 1:
        total = oracle.functions.totalRootUpdates().call()
        print(f"  ✅ Root committed (gas: {receipt.gasUsed}, update #{total})")
        print(f"     {len(products):,} products committed in 1 transaction")
    else:
        print(f"  ❌ Transaction failed!")
        sys.exit(1)

    print(f"  === Done ===\n")


def get_proof_for_product(product_id: int) -> dict:
    """
    Get the Merkle proof for a specific product from the cached tree.
    Used by the API endpoint to serve proofs to consumers.
    """
    if not os.path.exists(TREE_CACHE_PATH):
        raise FileNotFoundError("Merkle tree cache not found. Run merkle_builder.py first.")

    with open(TREE_CACHE_PATH) as f:
        cache = json.load(f)

    pid_str = str(product_id)
    if pid_str not in cache["product_index"]:
        raise KeyError(f"Product {product_id} not found in Merkle tree")

    leaf_index = cache["product_index"][pid_str]

    # Reconstruct tree from hex
    tree = [[bytes.fromhex(node[2:]) for node in level] for level in cache["tree"]]

    proof = get_proof(tree, leaf_index)
    proof_hex = ["0x" + p.hex() for p in proof]

    return {
        "product_id": product_id,
        "leaf_index": leaf_index,
        "proof": proof_hex,
        "root": cache["root"],
        "total_products": cache["total_products"],
        "data_date": cache["data_date"],
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Merkle Tree Builder for TCG Price Oracle")
    parser.add_argument("--build-only", action="store_true",
                        help="Build tree and save cache without pushing on-chain")
    parser.add_argument("--proof", type=int, metavar="PRODUCT_ID",
                        help="Get Merkle proof for a specific product ID")
    args = parser.parse_args()

    if args.proof:
        try:
            result = get_proof_for_product(args.proof)
            print(json.dumps(result, indent=2))
        except (FileNotFoundError, KeyError) as e:
            print(f"  ERROR: {e}")
            sys.exit(1)
    else:
        build_and_push(deploy_only=args.build_only)
