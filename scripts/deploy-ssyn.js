require("dotenv").config();
const hre = require("hardhat");
const ethers = hre.ethers;

const DeployUtils = require("./lib/DeployUtils");
let deployUtils;

async function main() {
  deployUtils = new DeployUtils(ethers);
  const chainId = await deployUtils.currentChainId();
  let [, , localSuperAdmin] = await ethers.getSigners();

  const network = chainId === 1 ? "ethereum" : chainId === 3 ? "ropsten" : "localhost";

  const superAdmin = chainId === 1337 ? localSuperAdmin.address : process.env.SUPER_ADMIN;

  console.log("Deploying SyntheticSyndicateERC20...");
  const SSYN = await ethers.getContractFactory("SyntheticSyndicateERC20");
  const ssyn = await SSYN.deploy(superAdmin);
  await ssyn.deployed();

  console.log(`
To verify SyntheticSyndicateERC20 source code:
    
  npx hardhat verify --show-stack-traces \\
      --network ${network} \\
      ${ssyn.address}  \\
      ${superAdmin}
      
`);

  console.log("SyntheticSyndicateERC20 deployed at", ssyn.address);
  await deployUtils.saveDeployed(chainId, ["SyntheticSyndicateERC20"], [ssyn.address]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
