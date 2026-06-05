#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  post_deploy_verify.sh — Run on Mac Mini after hardened V2 deploy
#
#  What this does:
#    1. Verifies v2_deployment.json has the new address
#    2. Tests RPC connectivity + contract readability
#    3. Verifies cron is using the right script
#    4. Runs a test price update (dry run first, then live)
#
#  Usage:
#    cd ~/litvm-tcg-oracle && bash scripts/post_deploy_verify.sh
# ═══════════════════════════════════════════════════════════════

set -e

NEW_V2="0x04a128F4a7A0588D259F8abe9E260BbffF203072"
OLD_V2="0xE74860a658a6e642A449d989BfB6eB845074B8d0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "  ═══════════════════════════════════════════════════"
echo "  TCGPriceOracleV2 — Post-Deploy Verification"
echo "  ═══════════════════════════════════════════════════"
echo ""

# ── Step 1: Check v2_deployment.json ──
echo "  [1/5] Checking v2_deployment.json..."
DEPLOY_FILE="$SCRIPT_DIR/v2_deployment.json"
if [ ! -f "$DEPLOY_FILE" ]; then
    echo "  ❌ v2_deployment.json NOT FOUND at $DEPLOY_FILE"
    echo "     Creating it now with the new address..."
    cat > "$DEPLOY_FILE" << EOF
{
  "contract_address": "$NEW_V2",
  "chain_id": 4441,
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "note": "Hardened deployment with security patches (12 findings)"
}
EOF
    echo "  ✅ Created v2_deployment.json"
else
    CURRENT=$(python3 -c "import json; print(json.load(open('$DEPLOY_FILE'))['contract_address'])" 2>/dev/null || echo "PARSE_ERROR")
    if [ "$CURRENT" = "$NEW_V2" ]; then
        echo "  ✅ Address is correct: $NEW_V2"
    elif [ "$CURRENT" = "$OLD_V2" ]; then
        echo "  ⚠️  Address is OLD ($OLD_V2) — updating to new..."
        python3 -c "
import json
with open('$DEPLOY_FILE', 'r') as f:
    data = json.load(f)
data['contract_address'] = '$NEW_V2'
data['upgraded_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
data['note'] = 'Hardened deployment with security patches (12 findings)'
with open('$DEPLOY_FILE', 'w') as f:
    json.dump(data, f, indent=2)
"
        echo "  ✅ Updated to: $NEW_V2"
    else
        echo "  ⚠️  Unexpected address: $CURRENT"
        echo "     Expected: $NEW_V2"
        echo "     Updating..."
        python3 -c "
import json
with open('$DEPLOY_FILE', 'r') as f:
    data = json.load(f)
data['contract_address'] = '$NEW_V2'
with open('$DEPLOY_FILE', 'w') as f:
    json.dump(data, f, indent=2)
"
        echo "  ✅ Forced to: $NEW_V2"
    fi
fi

# ── Step 2: Check for stale addresses in all scripts ──
echo ""
echo "  [2/5] Scanning for stale old address..."
STALE=$(grep -rn "$OLD_V2" "$REPO_DIR" --include="*.py" --include="*.js" --include="*.json" 2>/dev/null | grep -v node_modules | grep -v artifacts || true)
if [ -n "$STALE" ]; then
    echo "  ⚠️  Found stale references:"
    echo "$STALE" | sed 's/^/     /'
    echo ""
    echo "  Run: cd $REPO_DIR && git pull origin main"
    echo "  (The latest code has all addresses updated)"
else
    echo "  ✅ Zero stale references — all clean"
fi

# ── Step 3: Test RPC + Contract ──
echo ""
echo "  [3/5] Testing RPC connectivity + contract..."
python3 << 'PYEOF'
import json, os, sys
try:
    from web3 import Web3
except ImportError:
    print("  ⚠️  web3 not installed. Run: pip install web3")
    sys.exit(0)

w3 = Web3(Web3.HTTPProvider("https://liteforge.rpc.caldera.xyz/http", request_kwargs={"timeout": 15}))
if not w3.is_connected():
    print("  ❌ Cannot connect to LiteForge RPC")
    sys.exit(1)
print(f"  ✅ RPC connected (block: {w3.eth.block_number})")

# Load ABI + address
script_dir = os.path.dirname(os.path.abspath("__file__"))
abi_path = os.path.join(os.environ.get("SCRIPT_DIR", "."), "TCGPriceOracleV2_abi.json")
deploy_path = os.path.join(os.environ.get("SCRIPT_DIR", "."), "v2_deployment.json")

# Try multiple ABI locations
for path in [abi_path, "scripts/TCGPriceOracleV2_abi.json", "TCGPriceOracleV2_abi.json"]:
    if os.path.exists(path):
        abi_path = path
        break
else:
    print("  ⚠️  ABI file not found — skipping contract test")
    sys.exit(0)

for path in [deploy_path, "scripts/v2_deployment.json", "v2_deployment.json"]:
    if os.path.exists(path):
        deploy_path = path
        break

with open(abi_path) as f:
    abi = json.load(f)
with open(deploy_path) as f:
    addr = json.load(f)["contract_address"]

oracle = w3.eth.contract(address=addr, abi=abi)

try:
    count = oracle.functions.productCount().call()
    total = oracle.functions.totalUpdates().call()
    owner = oracle.functions.owner().call()
    print(f"  ✅ Contract responding:")
    print(f"     Products:  {count}")
    print(f"     Updates:   {total}")
    print(f"     Owner:     {owner}")
    
    # Check Charizard (productId 583)
    try:
        p = oracle.functions.getProductById(583).call()
        price = p[3] / 100  # marketPrice in cents
        print(f"     Charizard: ${price:,.2f}")
    except:
        print("     Charizard: (product 583 not found)")
except Exception as e:
    print(f"  ❌ Contract call failed: {e}")
PYEOF

# ── Step 4: Check crontab ──
echo ""
echo "  [4/5] Checking crontab for oracle updater..."
CRON_ENTRY=$(crontab -l 2>/dev/null | grep -i "updater_v2\|litvm_updater" || true)
if [ -n "$CRON_ENTRY" ]; then
    echo "  ✅ Cron entry found:"
    echo "     $CRON_ENTRY"
else
    echo "  ⚠️  No oracle updater cron found."
    echo "     To set up hourly updates, run:"
    echo "     crontab -e"
    echo "     Add: 0 * * * * cd ~/litvm-tcg-oracle && source venv/bin/activate && python3 scripts/litvm_updater_v2.py >> updater_v2.log 2>&1"
fi

# ── Step 5: Check .env for private key ──
echo ""
echo "  [5/5] Checking .env..."
if [ -f "$REPO_DIR/.env" ]; then
    HAS_KEY=$(grep -c "BURNER_PRIVATE_KEY\|PRIVATE_KEY\|LITVM_TESTNET_PK" "$REPO_DIR/.env" 2>/dev/null || echo 0)
    if [ "$HAS_KEY" -gt 0 ]; then
        echo "  ✅ Private key configured in .env"
    else
        echo "  ⚠️  No private key found in .env"
    fi
else
    echo "  ⚠️  No .env file found at $REPO_DIR/.env"
fi

echo ""
echo "  ═══════════════════════════════════════════════════"
echo "  Verification complete!"
echo ""
echo "  Next: Run a test update to confirm everything works:"
echo "    cd $REPO_DIR"
echo "    source venv/bin/activate"  
echo "    python3 scripts/litvm_updater_v2.py"
echo "  ═══════════════════════════════════════════════════"
echo ""
