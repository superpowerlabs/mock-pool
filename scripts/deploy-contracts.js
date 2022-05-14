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
const wormholeConfig = require("./lib/wormholeConfig");
const {bytes32Address} = require("../test/helpers");

let deployUtils;

async function main() {
  deployUtils = new DeployUtils(ethers);
  const {Tx} = deployUtils;
  const chainId = await deployUtils.currentChainId();

  let pool;

  if (chainId < 6) {
    const sSynr = await deployUtils.attach("SyntheticSyndicateERC20");
    pool = await deployUtils.deployProxy(
      "MainPool",
      deployed[chainId].SyndicateERC20,
      sSynr.address,
      deployed[chainId].SynCityPasses
    );
    await deployUtils.Tx(sSynr.updateRole(pool.address, await sSynr.ROLE_WHITE_LISTED_RECEIVER()), "Whitelisting the pool");
    await deployUtils.Tx(pool.initPool(7, 4000, {gasLimit: 70000}), "Init main pool");
  } else {
    const seed = await deployUtils.attach("SeedToken");
    pool = await deployUtils.deployProxy("SeedPool", deployed[chainId].SeedToken, deployed[chainId].SynCityCoupons);
    await deployUtils.Tx(
      pool.initPool(1000, 7 * 24 * 3600, 9800, 1000, 100, 800, 3000, 10, {gasLimit: 90000}),
      "Init SeedPool"
    );
    await deployUtils.Tx(pool.updateNftConf(100000, 1500, 500000, 3000, 150, 1000, {gasLimit: 60000}), "Init NFT Conf");
    await deployUtils.Tx(
      seed.grantRole(await seed.MINTER_ROLE(), pool.address),
      "Granting the pool minting role for SeedToken"
    );
  }

  const tesseract = await deployUtils.deployProxy("Tesseract");

  const bridgeName = chainId < 6 ? "MainWormholeBridge" : "SideWormholeBridge";
  const bridge = await deployUtils.deploy(bridgeName, tesseract.address, pool.address);

  await deployUtils.Tx(pool.setBridge(bridge.address, true), "Set bridge in pool");
  await deployUtils.Tx(tesseract.setBridge(1, bridge.address), "Se bridge in tesseract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
