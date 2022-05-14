const {expect, assert} = require("chai");

const {
  initEthers,
  assertThrowsMessage,
  getTimestamp,
  increaseBlockTimestampBy,
  bytes32Address,
  SEED_SWAP,
  BLUEPRINT_STAKE_FOR_BOOST,
  SYNR_PASS_STAKE_FOR_SEEDS,
} = require("./helpers");
const {upgrades} = require("hardhat");

// tests to be fixed

function normalize(val, n = 18) {
  return "" + val + "0".repeat(n);
}

// test unit coming soon

describe("#FarmingPool", function () {
  let SeedToken, seed;
  let WeedToken, weed;
  let coupon;
  let FarmingPool, pool;
  let SynCityCoupons, blueprint;
  let week = 7 * 24 * 3600;

  let user0sSeeds = "250000000";

  let deployer, user0, user1, user2, marketplace, treasury;

  before(async function () {
    initEthers(ethers);
    [deployer, user0, user1, user2, marketplace, treasury] = await ethers.getSigners();
    SeedToken = await ethers.getContractFactory("SeedToken");
    WeedToken = await ethers.getContractFactory("WeedToken");
    FarmingPool = await ethers.getContractFactory("FarmingPool");
    SynCityCoupons = await ethers.getContractFactory("SynCityCoupons");
  });

  async function initAndDeploy(initPool) {
    seed = await SeedToken.deploy();
    await seed.deployed();

    weed = await WeedToken.deploy();
    await weed.deployed();

    blueprint = await SynCityCoupons.deploy(8000);
    await blueprint.deployed();

    pool = await upgrades.deployProxy(FarmingPool, [seed.address, weed.address, blueprint.address]);
    await pool.deployed();

    if (initPool) {
      await pool.initPool(1000, week, 9800, 1000, 100, 800, 3000, 10);
      await pool.updateNftConf(
        0,
        0,
        0, // << those are ignored
        3000,
        150,
        1000
      );
    }

    await seed.grantRole(await seed.MINTER_ROLE(), deployer.address);
    await seed.mint(user0.address, ethers.utils.parseEther(user0sSeeds));

    await weed.grantRole(await weed.MINTER_ROLE(), pool.address);
  }

  let deposit;

  describe("#initPool", async function () {
    beforeEach(async function () {
      await initAndDeploy();
    });

    it("should revert if already initiated", async function () {
      await pool.initPool(1000, week, 9800, 1000, 100, 800, 3000, 10);
      expect(pool.initPool(1000, week, 9800, 1000, 100, 1000, 3000, 10)).revertedWith("SidePool: already initiated");
    });

    it("should revert if wrong parameters", async function () {
      await assertThrowsMessage(pool.initPool(1000, week, 129800, 1000, 100, 800, 3000, 10), "value out-of-bounds");
      await assertThrowsMessage(pool.initPool(1000, 1e12, 9800, 1000, 100, 800, 3000, 10), "value out-of-bounds");
      await assertThrowsMessage(pool.initPool(1e10, week, 9800, 1000, 100, 800, 3000, 10), "value out-of-bounds");
    });
  });

  describe("#getLockupTime", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
      //
      const amount = ethers.utils.parseEther("9650");
      const lockedFrom = await getTimestamp();
      const lockedUntil = lockedFrom + 3600 * 24 * 180;
      deposit = {
        tokenType: SEED_SWAP,
        lockedFrom,
        lockedUntil,
        tokenAmountOrID: amount,
        tokenAmount: amount.mul(100),
        unlockedAt: 0,
        mainIndex: 0,
        lastRewardsAt: lockedFrom,
        rewardsFactor: 1000,
      };
    });

    it("should calculate the yield weight", async function () {
      expect(await pool.getLockupTime(deposit)).equal(15552000);
    });
  });

  describe("#yieldWeight", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
    });

    it("should calculate the yield weight", async function () {
      // 14962 means a weight of 1.4962
      expect(await pool.yieldWeight(deposit)).equal(14931);
    });
  });

  describe("#shouldUpdateRatio", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
    });

    it("should be updated", async function () {
      await increaseBlockTimestampBy(23 * 24 * 3600);
      expect(await pool.shouldUpdateRatio()).equal(true);
    });

    it("should not be updated", async function () {
      await increaseBlockTimestampBy(3 * 24 * 3600);
      expect(await pool.shouldUpdateRatio()).equal(false);
    });
  });

  describe("#calculateUntaxedRewards", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
      const amount = ethers.utils.parseEther("9650");
      const lockedFrom = await getTimestamp();
      const lockedUntil = lockedFrom + 3600 * 24 * 180;
      deposit = {
        tokenType: SEED_SWAP,
        lockedFrom,
        lockedUntil,
        tokenAmountOrID: amount,
        unlockedAt: 0,
        mainIndex: 0,
        tokenAmount: amount.mul(100),
        lastRewardsAt: lockedFrom,
        rewardsFactor: 1000,
      };
    });

    it("should calculate the rewards", async function () {
      await increaseBlockTimestampBy(21 * 24 * 3600);
      expect(await pool.calculateUntaxedRewards(deposit, await getTimestamp())).equal("82897730136986301369863013");
    });
  });

  describe("#updateRatio", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
    });

    it("should update rewardsFactor", async function () {
      await increaseBlockTimestampBy(23 * 24 * 3600);
      await pool.updateRatio();
      const conf = await pool.conf();
      expect(conf.rewardsFactor).equal(940);
      expect(conf.lastRatioUpdateAt).equal(await getTimestamp());
      expect(await pool.shouldUpdateRatio()).equal(false);
    });

    it("should not update rewardsFactor", async function () {
      await increaseBlockTimestampBy(13 * 24 * 3600);
      await pool.updateRatio();
      let conf = await pool.conf();
      expect(conf.rewardsFactor).equal(980);
      await pool.updateRatio();
      conf = await pool.conf();
      expect(conf.rewardsFactor).equal(980);
    });
  });

  describe("#stake", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
    });

    it("should revert if staking seed when allowance is paused", async function () {
      const amount = ethers.utils.parseEther("1500000");
      await seed.connect(user0).approve(pool.address, amount);
      const balanceBefore = await seed.balanceOf(user0.address);
      expect(balanceBefore).equal(normalize(user0sSeeds));

      expect(pool.connect(user0).stake(SEED_SWAP, 0, amount)).revertedWith("ERC20: insufficient allowance");
    });

    it("should stake some seed", async function () {
      const amount = ethers.utils.parseEther("1500000");
      await seed.connect(user0).approve(pool.address, amount);
      const balanceBefore = await seed.balanceOf(user0.address);
      expect(balanceBefore).equal(normalize(user0sSeeds));

      await seed.unpauseAllowance();

      const lockedUntil = (await getTimestamp()) + 1 + 24 * 3600 * 10;
      expect(await pool.connect(user0).stake(SEED_SWAP, 0, amount))
        .emit(pool, "DepositSaved")
        .withArgs(user0.address, 0);

      let deposit = await pool.getDepositByIndex(user0.address, 0);
      expect(deposit.tokenAmountOrID).equal(amount);
      expect(deposit.tokenType).equal(SEED_SWAP);
      expect(deposit.lockedUntil).equal(lockedUntil);
    });

    it("should stake some seed and collect rewards", async function () {
      const amount = ethers.utils.parseEther("1500000");
      await seed.connect(user0).approve(pool.address, amount);
      const balanceBefore = await seed.balanceOf(user0.address);
      expect(balanceBefore).equal(normalize(user0sSeeds));

      await seed.unpauseAllowance();

      const lockedUntil = (await getTimestamp()) + 1 + 24 * 3600 * 10;
      expect(await pool.connect(user0).stake(SEED_SWAP, 0, amount))
        .emit(pool, "DepositSaved")
        .withArgs(user0.address, 0);

      await increaseBlockTimestampBy(50 * 24 * 3600);

      await pool.connect(user0).collectRewards();
      expect(await weed.balanceOf(user0.address)).equal("38840383561643835616438356");
    });

    it("should stake some blueprints", async function () {
      let amount = 2;
      await blueprint.mint(user0.address, 5);
      await blueprint.connect(user0).approve(pool.address, amount);
      expect(await pool.connect(user0).stake(BLUEPRINT_STAKE_FOR_BOOST, 0, amount))
        .emit(pool, "DepositSaved")
        .withArgs(user0.address, 0);

      let deposit = await pool.getDepositByIndex(user0.address, 0);
      const lockedUntil = await getTimestamp();
      expect(deposit.tokenAmountOrID).equal(amount);
      expect(deposit.tokenType).equal(BLUEPRINT_STAKE_FOR_BOOST);
      expect(deposit.lockedUntil).equal(lockedUntil);
    });

    it("should revert if not seed or blueprints", async function () {
      const amount = ethers.utils.parseEther("1500000");
      await assertThrowsMessage(
        pool.connect(user0).stake(SYNR_PASS_STAKE_FOR_SEEDS, 0, amount),
        "FarmingPool: unsupported token"
      );
    });
  });

  describe("#unstake", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
    });

    it("should unstake blueprints", async function () {
      let id = 2;
      await blueprint.mint(user0.address, 5);
      await blueprint.connect(user0).approve(pool.address, id);
      await pool.connect(user0).stake(BLUEPRINT_STAKE_FOR_BOOST, 0, id);

      expect(await pool.connect(user0).unstake(0))
        .emit(pool, "DepositUnlocked")
        .withArgs(user0.address, 0);
    });

    it("should revert if unstake is not blueprint", async function () {
      const amount = ethers.utils.parseEther("1500000");
      await seed.connect(user0).approve(pool.address, amount);
      await seed.unpauseAllowance();
      await pool.connect(user0).stake(SEED_SWAP, 0, amount);
      await assertThrowsMessage(pool.connect(user0).unstake(0), "FarmingPool: only blueprints can be unstaked");
    });
  });
});
