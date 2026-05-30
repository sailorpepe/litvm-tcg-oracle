/**
 * TCGPriceOracleV2 — Deployment Script
 * 
 * Deploys to LitVM LiteForge testnet (Chain ID 4441).
 * After deployment, registers the initial 50 blue-chip products and
 * optionally transfers ownership to the Mac Mini burner wallet.
 *
 * Prerequisites:
 *   1. Set DEPLOYER_PRIVATE_KEY in .env (sailorpepe.eth or burner)
 *   2. Wallet must have zkLTC for gas (free from faucet: liteforge.hub.caldera.xyz)
 *   3. Run: npx hardhat run scripts/deploy.js --network liteforge
 *
 * Post-deployment:
 *   1. Copy the new contract address
 *   2. Update the Mac Mini's litvm_updater.py with the new address + ABI
 *   3. Update the Vercel API route (app/api/litvm/route.js)
 *   4. Update README.md with the new address
 */

require("dotenv").config();
const hre = require("hardhat");

// Mac Mini burner wallet — receives ownership after deployment
// This is the wallet that pushes hourly price updates from the cron job
const BURNER_WALLET = "0x77B82Fe7ADD725017E106CFE6E26Dc8b37C93Fca";

// Initial 50 blue-chip products (from Mac Mini SQLite, May 28 2026)
// Format: [productId, categoryId, name, marketPrice (cents), lowPrice (cents)]
const INITIAL_PRODUCTS = [
  [98580,  3, "Pokemon Base Set (Shadowless) [1st Edition] Booster Pack", 1875000, 1750000],
  [618895, 2, "FINAL FANTASY - Collector Booster Display Master Case", 2650000, 2300000],
  [9232,   3, "Legendary Treasures Booster Box", 1875000, 1800000],
  [248124, 3, "Evolving Skies Booster Box Case", 1484715, 2000000],
  [450087, 62, "Romance Dawn - Booster Box Case (Wave 2 - White)", 1450000, 2777777],
  [138132, 2, "Revised Edition - Booster Box", 1500000, 1319789],
  [675560, 2, "Secrets of Starhaven - Collector Booster Display Master Case", 1115012, 1269998],
  [513409, 3, "151 Booster Bundle Display Case", 1011859, 1489900],
  [27303,  3, "Team Up Booster Box", 1511129, 1100000],
  [654626, 2, "Edge of Eternities - Collector Booster Display Master Case", 1099907, 2509999],
  [656326, 2, "Lorwyn Eclipsed - Collector Booster Display Case", 1079999, 1280198],
  [27247,  2, "Spectral Tiger (LOOT)", 899999, 899999],
  [485834, 2, "Marvel's Spider-Man - Collector Booster Display Master Case", 823450, 899993],
  [521582, 62, "Kingdoms of Intrigue - Booster Box Case", 610975, 640633],
  [635609, 3, "Paldean Fates Booster Bundle Display Case", 814797, 1499999],
  [545400, 62, "Premium Booster - Booster Box Case", 800031, 1050000],
  [484913, 2, "Universes Beyond: The Lord of the Rings: Tales of Middle-earth -", 735565, 899999],
  [610709, 3, "Southern Islands Collection", 720000, 1985000],
  [617573, 73, "History of Z Booster Box Case", 703211, 1999999],
  [521162, 62, "Memorial Collection - Booster Box Case", 659980, 1188800],
  [618894, 2, "FINAL FANTASY - Collector Booster Display Case", 651632, 720000],
  [628353, 62, "Emperors in the New World - Booster Box Case", 632089, 899999],
  [637463, 62, "Carrying On His Will Booster Box Case", 609853, 590000],
  [619695, 73, "Alpha - Booster Box Case", 1099997, 1000000],
  [506640, 62, "One Piece Romance Dawn Booster Box", 498110, 582500],
  [247655, 3, "Evolving Skies Booster Box", 585748, 650000],
  [450086, 62, "Romance Dawn - Booster Box Case (Wave 1)", 583175, 550000],
  [541092, 62, "Manga Booster 01 Booster Box Case", 570000, 3666969],
  [1196,   2, "Black Lotus [Unlimited]", 445300, 350000],
  [530142, 3, "Prismatic Evolutions - Elite Trainer Box Case", 445898, 462400],
  [528030, 3, "Surging Sparks - Booster Bundle Display Case", 472827, 585000],
  [92168,  2, "Mox Sapphire [Unlimited]", 464500, 350000],
  [594070, 2, "Tarkir Dragonstorm - Collector Booster Display Master Case", 503065, 749500],
  [595411, 2, "Foundations - Collector Booster Display Master Case", 539995, 744998],
  [604262, 3, "Prismatic Evolutions - Booster Bundle Box", 491249, 640000],
  [609238, 3, "Prismatic Evolutions - Mini Tin Display Case", 486600, 640000],
  [620181, 2, "Tarkir Dragonstorm - Play Booster Display Master Case", 521976, 625000],
  [616611, 3, "Prismatic Evolutions - Binder Collection Display Case", 499999, 1068300],
  [616669, 62, "Two Legends - Booster Box Case (OP-08)", 434875, 599000],
  [504452, 2, "Phyrexia: All Will Be One - Collector Booster Display Master Case", 599969, 650000],
  [518638, 3, "Obsidian Flames Booster Box Case", 469429, 750000],
  [498735, 2, "Dominaria Remastered - Collector Booster Display Master Case", 921283, 1350000],
  [496077, 3, "Crown Zenith - Elite Trainer Box Case", 429000, 555000],
  [692964, 3, "Astral Radiance Booster Box", 498817, 530000],
  [541239, 62, "500 Years in the Future Booster Box Case (OP-07)", 486950, 450000],
  [563835, 62, "Wings of the Captain - Booster Box Case (OP-06)", 651171, 810298],
  [454414, 2, "The Lord of the Rings: Tales of Middle-earth - Collector Booster Box", 1000000, 700000],
  [98028,  2, "Mox Ruby [Unlimited]", 489999, 350000],
  [181698, 2, "Time Walk [Unlimited]", 1111129, 999999],
  [296077, 3, "Hidden Fates Elite Trainer Box", 499999, 415000],
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("\n" + "=".repeat(60));
  console.log("  TCGPriceOracleV2 — Deployment");
  console.log("=".repeat(60));
  console.log(`  Network:  LitVM LiteForge (Chain ID 4441)`);
  console.log(`  Deployer: ${deployer.address}`);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:  ${hre.ethers.formatEther(balance)} zkLTC`);
  
  if (balance === 0n) {
    console.error("\n  ERROR: No zkLTC balance. Get testnet tokens from:");
    console.error("  https://liteforge.hub.caldera.xyz\n");
    process.exit(1);
  }
  
  // ─── Deploy ─────────────────────────────────────────────
  console.log("\n  [1/4] Deploying TCGPriceOracleV2...");
  const Oracle = await hre.ethers.getContractFactory("TCGPriceOracleV2");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();
  
  const address = await oracle.getAddress();
  console.log(`  ✅ Deployed at: ${address}`);
  
  // ─── Register Products ──────────────────────────────────
  console.log("\n  [2/4] Registering initial products...");
  
  // Split into batches of 25 to stay well under gas limits
  const BATCH_SIZE = 25;
  let totalRegistered = 0;
  
  for (let i = 0; i < INITIAL_PRODUCTS.length; i += BATCH_SIZE) {
    const batch = INITIAL_PRODUCTS.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(INITIAL_PRODUCTS.length / BATCH_SIZE);
    
    const ids = batch.map(p => p[0]);
    const cats = batch.map(p => p[1]);
    const names = batch.map(p => p[2]);
    const prices = batch.map(p => p[3]);
    const lows = batch.map(p => p[4]);
    
    console.log(`         Batch ${batchNum}/${totalBatches} (${batch.length} products)...`);
    
    const tx = await oracle.batchRegister(ids, cats, names, prices, lows);
    await tx.wait();
    totalRegistered += batch.length;
  }
  
  console.log(`  ✅ Registered ${totalRegistered} products`);
  
  // ─── Verify State ───────────────────────────────────────
  console.log("\n  [3/4] Verifying on-chain state...");
  
  const productCount = await oracle.productCount();
  const totalUpdates = await oracle.totalUpdates();
  const owner = await oracle.owner();
  
  console.log(`         Products:      ${productCount}`);
  console.log(`         Total updates: ${totalUpdates}`);
  console.log(`         Owner:         ${owner}`);
  
  // Spot-check a product
  const [price, timestamp, isFresh] = await oracle.getLatestPrice(98580);
  console.log(`         Charizard:     $${Number(price) / 100} (fresh: ${isFresh})`);
  
  // ─── Transfer Ownership ─────────────────────────────────
  console.log("\n  [4/4] Transferring ownership to burner wallet...");
  console.log(`         Burner: ${BURNER_WALLET}`);
  
  const transferTx = await oracle.transferOwnership(BURNER_WALLET);
  await transferTx.wait();
  
  console.log(`  ✅ Ownership transfer initiated (Ownable2Step)`);
  console.log(`     ⚠️  Burner wallet must call acceptOwnership() to complete.`);
  
  // ─── Summary ────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Contract:  ${address}`);
  console.log(`  Chain:     LitVM LiteForge (4441)`);
  console.log(`  Products:  ${productCount}`);
  console.log(`  Owner:     ${owner} (pending transfer to burner)`);
  console.log(`  Explorer:  https://liteforge.explorer.caldera.xyz/address/${address}`);
  console.log("=".repeat(60));
  
  console.log("\n  NEXT STEPS:");
  console.log("  1. On Mac Mini: call acceptOwnership() from burner wallet");
  console.log("  2. On Mac Mini: update litvm_updater.py with new address + ABI");
  console.log("  3. On Vercel:   update app/api/litvm/route.js with new address");
  console.log("  4. On GitHub:   push contract, tests, deploy script");
  console.log("");
  
  // Export ABI for Mac Mini
  const artifact = await hre.artifacts.readArtifact("TCGPriceOracleV2");
  const fs = require("fs");
  fs.writeFileSync(
    "artifacts/TCGPriceOracleV2_abi.json",
    JSON.stringify(artifact.abi, null, 2)
  );
  console.log("  ABI exported to: artifacts/TCGPriceOracleV2_abi.json");
  console.log("  Copy this file to the Mac Mini for the updater script.\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n  DEPLOYMENT FAILED:", error.message);
    process.exit(1);
  });
