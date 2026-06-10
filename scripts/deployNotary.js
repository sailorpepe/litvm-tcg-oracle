const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying GradeNotary with account:", deployer.address);

  // The GradeNotary contract requires the initialOwner address in the constructor
  const GradeNotary = await hre.ethers.getContractFactory("GradeNotary");
  const notary = await GradeNotary.deploy(deployer.address);
  
  await notary.waitForDeployment();

  const address = await notary.getAddress();
  console.log("GradeNotary deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
