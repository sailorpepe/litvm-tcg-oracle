require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    liteforge: {
      url: "https://liteforge.rpc.caldera.xyz/http",
      chainId: 4441,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [`0x${process.env.DEPLOYER_PRIVATE_KEY.replace(/^0x/, "")}`]
        : []
    }
  }
};
