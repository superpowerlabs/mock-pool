const {requirePath} = require("require-or-mock");
// if missed, it sets up a mock
requirePath(".env");
requirePath(".env.json");

require("dotenv").config();
require("@nomiclabs/hardhat-waffle");
require("hardhat-contract-sizer");
require("@nomiclabs/hardhat-etherscan");
require("@openzeppelin/hardhat-upgrades");
require("solidity-coverage");
// Go to https://hardhat.org/config/ to learn more

if (process.env.GAS_REPORT === "yes") {
  require("hardhat-gas-reporter");
}

const envJson = require("./.env.json");

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.8.11",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {},
  networks: {
    localhost: {
      url: "http://localhost:8545",
      chainId: 1337,
    },
    ethereum: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: [envJson.mainnet.privateKey],
      chainId: 1,
    },
    bsc: {
      url: "https://bsc-dataseed.binance.org",
      chainId: 56,
      gasPrice: 20000000000,
      accounts: [envJson.mainnet.privateKey],
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${process.env.INFURA_API_KEY}`,
      gasLimit: 6000000,
      accounts: [envJson.testnet.privateKey],
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
      gasLimit: 6000000,
      accounts: [envJson.testnet.privateKey],
    },
    bsc_testnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      // gasPrice: 20000000000,
      gasLimit: 6000000,
      accounts: [envJson.testnet.privateKey],
    },
    mumbai: {
      url: "https://matic-mumbai.chainstacklabs.com",
      chainId: 80001,
      // gasPrice: 20000000000,
      gasLimit: 6000000,
      accounts: [envJson.testnet.privateKey],
    },
  },
  gasReporter: {
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP,
  },
  etherscan: {
    apiKey: process.env.BSCSCAN_KEY,
    // process.env.ETHERSCAN_KEY,
  },
};
