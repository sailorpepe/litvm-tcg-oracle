/**
 * SoulPredictionOracle — Deployment Script
 *
 * Deploys to LitVM LiteForge testnet (Chain ID 4441).
 * Run FROM THE MAC MINI (it holds the real burner key — the weekly
 * soul-prediction commit cron uses the same wallet as owner).
 *
 * Prerequisites:
 *   1. DEPLOYER_PRIVATE_KEY in .env = the burner wallet
 *      (0x77B82Fe7ADD725017E106CFE6E26Dc8b37C93Fca — the same wallet that
 *      pushes hourly V2 updates; it deploys AND stays owner, no transfer).
 *   2. Wallet has zkLTC for gas.
 *   3. npx hardhat run scripts/deploySoulPrediction.js --network liteforge
 *
 * Post-deployment (all on the Mini):
 *   1. Commit week 1 retroactively-honest: the 2026-07-01 root was already
 *      committed as calldata (tx 2270231…c50) BEFORE outcomes — recommit the
 *      same root here for contract-based verification going forward:
 *        commitRoot(20260701, 0x56da5c8be3b8eaf7cd48cc64fa7a79c9b6b8b8d4a5273ee8a30a3712d3d6331f, 819)
 *   2. Repoint the Monday cron's weekly commitment at commitRoot().
 *   3. IMPORTANT: the tree builder must use the family convention —
 *      double-hashed leaves + sorted-pair keccak internal nodes (identical to
 *      merkle_builder.py / OpenZeppelin MerkleProof). If soul_predictions.py
 *      built the week-1 root differently (e.g. sha256), keep committing the
 *      raw root anyway (timestamped immutability holds) but switch the builder
 *      to the OZ convention so verifyPrediction() works for week 2+.
 *   4. Report the address back to the Studio for: /souls page verify links,
 *      llms.txt contract table, site /litvm page, and the announcement post.
 */

require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "zkLTC");

  const F = await hre.ethers.getContractFactory("SoulPredictionOracle");
  const oracle = await F.deploy();
  await oracle.waitForDeployment();
  const addr = await oracle.getAddress();

  console.log("\n✅ SoulPredictionOracle deployed:", addr);
  console.log("Owner:", await oracle.owner());
  console.log("Explorer: https://liteforge.explorer.caldera.xyz/address/" + addr);
  console.log("\nNext: commitRoot(20260701, 0x56da5c8b…, 819) — see header notes.");
}

main().catch((e) => { console.error(e); process.exit(1); });
