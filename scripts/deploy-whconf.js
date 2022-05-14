// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
require("dotenv").config();
const {expect} = require("chai");
const hre = require("hardhat");
const requireOrMock = require("require-or-mock");
const ethers = hre.ethers;
const deployed = requireOrMock("export/deployed.json");
const DeployUtils = require("./lib/DeployUtils");
const wormholeConfig = require("./lib/wormholeConfig");
const net = require("net");
let deployUtils;
const {bytes32Address} = require("../test/helpers");

async function main() {
  deployUtils = new DeployUtils(ethers);
  const {Tx} = deployUtils;
  const chainId = await deployUtils.currentChainId();

  if (/1337$/.test(chainId.toString())) {
    console.error("Network not supported");
    process.exit(1);
  }

  const wormholeContract = wormholeConfig.byChainId[chainId];
  let otherChain, recipientChain, bridge, otherContract;
  if (chainId < 6) {
    otherChain = chainId === 1 ? 56 : chainId === 5 ? 97 : 80001;
    recipientChain = chainId === 1 || chainId === 5 ? 4 : 5;
    bridge = await deployUtils.attach("MainWormholeBridge");
    otherContract = "SideWormholeBridge";
  } else {
    otherChain = chainId === 56 ? 1 : chainId === 97 ? 5 : 3;
    recipientChain = chainId === 56 || chainId === 97 ? 2 : 10001;
    bridge = await deployUtils.attach("SideWormholeBridge");
    otherContract = "MainWormholeBridge";
  }
  await Tx(bridge.wormholeInit(wormholeContract[0], wormholeContract[1], {gasLimit: 200000}), "Configuring wormhole");
  await Tx(
    bridge.wormholeRegisterContract(recipientChain, bytes32Address(deployed[otherChain][otherContract])),
    "Configuring the side chain"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
