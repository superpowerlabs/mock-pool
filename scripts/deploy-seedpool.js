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
  const seedAddress = deployed[chainId].SeedToken;
  const blueprintAddress = deployed[chainId].SynCityCoupons;

  const SeedPool = await ethers.getContractFactory("SeedPool");

  console.log("Deploying SeedPool");
  const seedPool = await upgrades.deployProxy(SeedPool, [seedAddress, blueprintAddress]);
  await seedPool.deployed();

  console.log("SeedPool deployed at", seedPool.address);
  await deployUtils.saveDeployed(chainId, ["SeedPool"], [seedPool.address]);

  console.log(await deployUtils.verifyCodeInstructions("SeedPool", chainId, "SeedPool", "pool"));

  await Tx(seedPool.initPool(1000, 7 * 24 * 3600, 9800, 1000, 100, 800, 3000, 10), "Init pool"); //, {gasLimit: 85000});
  await Tx(seedPool.updateNftConf(100000, 100000, 1000000, 3000, 150, 1000, {gasLimit: 60000}), "updateNftConf");

  const SeedToken = await ethers.getContractFactory("SeedToken");
  const seed = await SeedToken.attach(seedAddress);

  await Tx(
    seed.grantRole(await seed.MINTER_ROLE(), seedPool.address, {
      gasLimit: 66340,
    }),
    "Give the pool minting permissions on Seed"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
