require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
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
  },
  // Source verification on the LiteForge Blockscout explorer. Blockscout ignores
  // the apiKey value but hardhat-verify requires a non-empty string.
  etherscan: {
    apiKey: { liteforge: "blockscout" },
    customChains: [
      {
        network: "liteforge",
        chainId: 4441,
        urls: {
          apiURL: "https://liteforge.explorer.caldera.xyz/api",
          browserURL: "https://liteforge.explorer.caldera.xyz"
        }
      }
    ]
  }
};
