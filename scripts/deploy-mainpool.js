// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
require("dotenv").config();
const hre = require("hardhat");
const requireOrMock = require("require-or-mock");
const ethers = hre.ethers;
const deployed = requireOrMock("export/deployed.json");
const DeployUtils = require("./lib/DeployUtils");
const {upgrades} = require("hardhat");
let deployUtils;

async function main() {
  deployUtils = new DeployUtils(ethers);
  const {Tx} = deployUtils;
  const chainId = await deployUtils.currentChainId();

  const synrAddress = deployed[chainId].SyndicateERC20;
  const sSynrAddress = deployed[chainId].SyntheticSyndicateERC20;
  const synrPassAddress = deployed[chainId].SynCityPasses;

  const MainPool = await ethers.getContractFactory("MainPool");

  console.log("Deploying MainPool");
  const mainPool = await upgrades.deployProxy(MainPool, [synrAddress, sSynrAddress, synrPassAddress]);
  await mainPool.deployed();
  //
  // const MainPool = await ethers.getContractFactory("MainPool");
  // const mainPool = await MainPool.attach("0x906B067e392e2c5f9E4f101f36C0b8CdA4885EBf");

  console.log("MainPool deployed at", mainPool.address);

  console.log("Setting MainPool as a sSYNR receiver");
  const SyntheticSyndicateERC20 = await ethers.getContractFactory("SyntheticSyndicateERC20");
  const sSynr = await SyntheticSyndicateERC20.attach(sSynrAddress);
  await sSynr.updateRole(mainPool.address, await sSynr.ROLE_WHITE_LISTED_RECEIVER());

  await Tx(mainPool.initPool(16 * 7, 4000, {gasLimit: 70000}), "Init MainPool");

  await deployUtils.saveDeployed(chainId, ["MainPool"], [mainPool.address]);

  console.log(await deployUtils.verifyCodeInstructions("MainPool", chainId, "MainPool", "pool"));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
