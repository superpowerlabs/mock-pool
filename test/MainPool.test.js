const {expect, assert, use} = require("chai");

const {serializeInput} = require("../scripts/lib/PayloadUtils");

const {
  initEthers,
  assertThrowsMessage,
  getTimestamp,
  increaseBlockTimestampBy,
  SYNR_STAKE,
  S_SYNR_SWAP,
  SYNR_PASS_STAKE_FOR_BOOST,
  SYNR_PASS_STAKE_FOR_SEEDS,
} = require("./helpers");
const {upgrades} = require("hardhat");

// tests to be fixed

function normalize(val, n = 18) {
  return "" + val + "0".repeat(n);
}

// test unit coming soon

describe("#MainPool", function () {
  let SyndicateERC20, synr;
  let SyntheticSyndicateERC20, sSynr;
  let MainPool, mainPool;
  let SynCityPasses, pass;

  const BN = ethers.BigNumber.from;

  let deployer, fundOwner, superAdmin, operator, validator, user1, user2, marketplace, treasury;

  before(async function () {
    initEthers(ethers);
    [deployer, fundOwner, superAdmin, operator, validator, user1, user2, marketplace, treasury] = await ethers.getSigners();
    SyndicateERC20 = await ethers.getContractFactory("SyndicateERC20");
    SyntheticSyndicateERC20 = await ethers.getContractFactory("SyntheticSyndicateERC20");
    MainPool = await ethers.getContractFactory("MainPoolMock");
    SynCityPasses = await ethers.getContractFactory("SynCityPasses");
  });

  async function initAndDeploy() {
    const maxTotalSupply = 10000000000; // 10 billions
    synr = await SyndicateERC20.deploy(fundOwner.address, maxTotalSupply, superAdmin.address);
    await synr.deployed();
    let features =
      (await synr.FEATURE_TRANSFERS_ON_BEHALF()) +
      (await synr.FEATURE_TRANSFERS()) +
      (await synr.FEATURE_UNSAFE_TRANSFERS()) +
      (await synr.FEATURE_DELEGATIONS()) +
      (await synr.FEATURE_DELEGATIONS_ON_BEHALF());
    await synr.updateFeatures(features);

    sSynr = await SyntheticSyndicateERC20.deploy(superAdmin.address);
    await sSynr.deployed();

    pass = await SynCityPasses.deploy(validator.address);
    await pass.deployed();

    mainPool = await upgrades.deployProxy(MainPool, [synr.address, sSynr.address, pass.address]);
    await mainPool.deployed();

    await sSynr.updateRole(mainPool.address, await sSynr.ROLE_WHITE_LISTED_RECEIVER());
    await mainPool.initPool(7, 4000);
  }

  async function configure() {}

  describe("#calculatePenaltyForEarlyUnstake", async function () {
    beforeEach(async function () {
      await initAndDeploy();
    });

    it("should calculate taxes properly", async function () {
      // console.log(await synr.balanceOf(user1.address))
      const amount = ethers.utils.parseEther("10000");
      await synr.connect(fundOwner).transferFrom(fundOwner.address, user1.address, amount);
      const payload = await serializeInput(
        SYNR_STAKE, // SYNR
        365, //  year
        amount
      );
      expect(payload).equal("1000000000000000000000036502");
      await synr.connect(user1).approve(mainPool.address, ethers.utils.parseEther("10000"));
      expect(await mainPool.connect(user1).stake(user1.address, payload, 4))
        .emit(mainPool, "DepositSaved")
        .withArgs(user1.address, 0);
      await increaseBlockTimestampBy(182.5 * 24 * 3600);
      const deposit = await mainPool.getDepositByIndex(user1.address, 0);
      // console.log(deposit.lockedFrom, deposit.lockedUntil);
      const vestedPercentage = await mainPool.getVestedPercentage(getTimestamp(), deposit.lockedFrom, deposit.lockedUntil);
      expect(vestedPercentage).equal(5000);
      const unvested = ethers.BigNumber.from(deposit.tokenAmountOrID.toString())
        .mul(10000 - vestedPercentage)
        .div(10000);
      const percentage = (await mainPool.conf()).earlyUnstakePenalty / 100;
      const unvestedPenalty = unvested.mul(percentage).div(100);
      expect(await mainPool.calculatePenaltyForEarlyUnstake(getTimestamp(), deposit)).equal(unvestedPenalty);
    });
  });

  describe("#withdrawPenalties", async function () {
    beforeEach(async function () {
      await initAndDeploy();
    });

    it("should withdraw any ammount Taxes", async function () {
      const amount = ethers.utils.parseEther("10000");
      await synr.connect(fundOwner).transferFrom(fundOwner.address, user1.address, amount);
      const payload = await serializeInput(
        SYNR_STAKE, // SYNR
        365, // 1 year
        amount
      );
      await synr.connect(user1).approve(mainPool.address, ethers.utils.parseEther("10000"));
      await mainPool.connect(user1).stake(user1.address, payload, 4);
      await increaseBlockTimestampBy(182.5 * 24 * 3600);
      const deposit = await mainPool.getDepositByIndex(user1.address, 0);
      await mainPool
        .connect(user1)
        .unstake(
          user1.address,
          deposit.tokenType,
          deposit.lockedFrom,
          deposit.lockedUntil,
          deposit.mainIndex,
          deposit.tokenAmountOrID
        );
      const tax = await mainPool.penalties();
      const balanceBefore = await synr.balanceOf(user1.address);
      await mainPool.withdrawPenalties(tax.div(2), user1.address);
      expect(await synr.balanceOf(user1.address)).equal(balanceBefore.add(tax.div(2)));
      expect(await mainPool.penalties()).equal(tax.div(2));
    });

    it("should revert if amount not available", async function () {
      const amount = ethers.utils.parseEther("10000");
      await assertThrowsMessage(mainPool.withdrawPenalties(amount, user1.address), "MainPool: amount not available");
    });

    it("should all Taxes when using 0", async function () {
      const amount = ethers.utils.parseEther("10000");
      await synr.connect(fundOwner).transferFrom(fundOwner.address, user1.address, amount);
      const payload = await serializeInput(
        SYNR_STAKE, // SYNR
        365, // 1 year
        amount
      );
      await synr.connect(user1).approve(mainPool.address, ethers.utils.parseEther("10000"));
      await mainPool.connect(user1).stake(user1.address, payload, 4);
      await increaseBlockTimestampBy(182.5 * 24 * 3600);
      const deposit = await mainPool.getDepositByIndex(user1.address, 0);
      await mainPool
        .connect(user1)
        .unstake(
          user1.address,
          deposit.tokenType,
          deposit.lockedFrom,
          deposit.lockedUntil,
          deposit.mainIndex,
          deposit.tokenAmountOrID
        );
      const tax = await mainPool.penalties();
      const balanceBefore = await synr.balanceOf(user1.address);
      await mainPool.withdrawPenalties(0, user1.address);
      expect(await synr.balanceOf(user1.address)).equal(balanceBefore.add(tax));
      expect(await mainPool.penalties()).equal(0);
    });
  });

  describe("#Deposit", async function () {
    beforeEach(async function () {
      await initAndDeploy();
    });

    it("should return length of deposits", async function () {
      const amount = ethers.utils.parseEther("10000");
      await synr.connect(fundOwner).transferFrom(fundOwner.address, user1.address, amount);
      const payload = "100000000000000000000036502";
      await synr.connect(user1).approve(mainPool.address, ethers.utils.parseEther("10000"));
      expect(await mainPool.connect(user1).stake(user1.address, payload, 4))
        .emit(mainPool, "DepositSaved")
        .withArgs(user1.address, 0);
      const lenght = await mainPool.getDepositsLength(user1.address);
      expect(parseInt(lenght)).equal(1);
    });

    it("should return deposit by index", async function () {
      const amount = ethers.utils.parseEther("10000");
      await synr.connect(fundOwner).transferFrom(fundOwner.address, user1.address, amount);
      const payload = "100000000000000000000036502";
      await synr.connect(user1).approve(mainPool.address, ethers.utils.parseEther("10000"));
      expect(await mainPool.connect(user1).stake(user1.address, payload, 4))
        .emit(mainPool, "DepositSaved")
        .withArgs(user1.address, 0);
      console.log(await mainPool.getDepositsLength(user1.address));
      const deposit = await mainPool.getDepositByIndex(user1.address, 0);
      expect(parseInt(deposit)).equal(SYNR_STAKE, deposit.lockedFrom, deposit.lockedUntil, 0, amount);
    });
  });

  describe("#withdrawSSynr", async function () {
    beforeEach(async function () {
      await initAndDeploy();
    });

    it("should Withdraw the sSYNR", async function () {
      const amount = ethers.utils.parseEther("10000");
      await sSynr.mint(mainPool.address, amount);
      await sSynr.updateRole(treasury.address, await sSynr.ROLE_WHITE_LISTED_RECEIVER());
      await mainPool.withdrawSSynr(0, treasury.address);
      expect(await sSynr.balanceOf(treasury.address)).equal(amount);
    });
  });
});
