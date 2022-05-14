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
let deployUtils;

async function main() {
  deployUtils = new DeployUtils(ethers);
  const chainId = await deployUtils.currentChainId();
  const seedAddress = deployed[chainId].SeedToken;
  const weedAddress = deployed[chainId].WeedToken;
  const blueprintAddress = deployed[chainId].SynCityCoupons;

  console.log("Deploying FarmingPool");
  const FarmingPool = await ethers.getContractFactory("FarmingPool");

  const pool = await upgrades.deployProxy(FarmingPool, [seedAddress, weedAddress, blueprintAddress]);
  await pool.deployed();

  const WeedToken = await ethers.getContractFactory("WeedToken");
  const weed = await WeedToken.attach(weedAddress);
  await weed.grantRole(await weed.MINTER_ROLE(), pool.address);

  console.log("FarmingPool deployed at", pool.address);
  await deployUtils.saveDeployed(chainId, ["FarmingPool"], [pool.address]);

  console.log(
    await deployUtils.verifyCodeInstructions(
      "FarmingPool",
      chainId,
      ["address", "address", "address"],
      [seedAddress, weedAddress, blueprintAddress],
      "FarmingPool",
      "pool"
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
