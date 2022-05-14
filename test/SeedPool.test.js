const {expect, assert} = require("chai");

const {
  initEthers,
  assertThrowsMessage,
  getTimestamp,
  increaseBlockTimestampBy,
  bytes32Address,
  BLUEPRINT_STAKE_FOR_BOOST,
  SEED_SWAP,
} = require("./helpers");
const {upgrades} = require("hardhat");

// tests to be fixed

function normalize(val, n = 18) {
  return "" + val + "0".repeat(n);
}

// test unit coming soon

describe("#SeedPool", function () {
  let SeedToken, seed;
  let WeedToken, weed;
  let coupon;
  let SeedPool, pool;
  let SynCityCoupons, blueprint;
  let week = 7 * 24 * 3600;

  let user0sSeeds = "250000000";
  let user0sBlueprint = "25";

  let deployer, user0, user1, user2, bridge;

  before(async function () {
    initEthers(ethers);
    [deployer, user0, user1, user2, bridge] = await ethers.getSigners();
    SeedToken = await ethers.getContractFactory("SeedToken");
    WeedToken = await ethers.getContractFactory("WeedToken");
    SeedPool = await ethers.getContractFactory("SeedPoolMock");
    SynCityCoupons = await ethers.getContractFactory("SynCityCoupons");
  });

  async function initAndDeploy(initPool) {
    seed = await SeedToken.deploy();
    await seed.deployed();

    weed = await WeedToken.deploy();
    await weed.deployed();

    blueprint = await SynCityCoupons.deploy(8000);
    await blueprint.deployed();

    pool = await upgrades.deployProxy(SeedPool, [seed.address, blueprint.address]);
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
    await blueprint.mint(user0.address, user0sBlueprint);
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
        tokenType: BLUEPRINT_STAKE_FOR_BOOST,
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
        tokenType: BLUEPRINT_STAKE_FOR_BOOST,
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

    it("should stake blueprint", async function () {
      await blueprint.connect(user0).approve(pool.address, 4);
      expect(await pool.connect(user0).stake(BLUEPRINT_STAKE_FOR_BOOST, 0, 4))
        .emit(pool, "DepositSaved")
        .withArgs(user0.address, 0);

      const lockedUntil = await getTimestamp();
      let deposit = await pool.getDepositByIndex(user0.address, 0);
      expect(deposit.tokenAmountOrID).equal(4);
      expect(deposit.tokenType).equal(BLUEPRINT_STAKE_FOR_BOOST);
      expect(deposit.lockedUntil).equal(lockedUntil);
    });

    it("should revert unsupported token", async function () {
      const amount = ethers.utils.parseEther("1500000");
      await seed.connect(user0).approve(pool.address, amount);
      const balanceBefore = await seed.balanceOf(user0.address);
      expect(balanceBefore).equal(normalize(user0sSeeds));

      expect(pool.connect(user0).stake(SEED_SWAP, 0, amount)).revertedWith("SeedPool: unsupported token");
    });
  });

  describe("#stakeViaBridge", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
    });

    it("should not stake blueprint via bridge", async function () {
      const amount = ethers.utils.parseEther("1500000");
      await blueprint.connect(user0).approve(pool.address, 4);

      const lockedFrom = await getTimestamp();

      expect(
        pool.connect(user0).stakeViaBridge(user0.address, BLUEPRINT_STAKE_FOR_BOOST, lockedFrom, 0, 0, amount)
      ).revertedWith("SeedPool: forbidden");

      await pool.setBridge(bridge.address, true);

      expect(
        pool.connect(user0).stakeViaBridge(user0.address, BLUEPRINT_STAKE_FOR_BOOST, lockedFrom, 0, 0, amount)
      ).revertedWith("SeedPool: unsupported token");
    });
  });

  describe("#unstakeViaBridge", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
    });

    it("should unstake blueprint via bridge", async function () {
      const amount = ethers.utils.parseEther("1500000");
      await blueprint.connect(user0).approve(pool.address, 4);

      expect(await pool.connect(user0).stake(BLUEPRINT_STAKE_FOR_BOOST, 0, 4))
        .emit(pool, "DepositSaved")
        .withArgs(user0.address, 0);
      const lockedFrom = await getTimestamp();
      expect(
        pool.connect(user0).unstakeViaBridge(user0.address, BLUEPRINT_STAKE_FOR_BOOST, lockedFrom, 0, 0, amount)
      ).revertedWith("SeedPool: forbidden");
    });
  });

  describe("#unstake", async function () {
    beforeEach(async function () {
      await initAndDeploy(true);
    });

    it("should unstake blueprints", async function () {
      await blueprint.mint(user0.address, 4);
      await blueprint.connect(user0).approve(pool.address, 4);
      await pool.connect(user0).stake(BLUEPRINT_STAKE_FOR_BOOST, 0, 4);
      expect(await pool.connect(user0).unstake(0))
        .emit(pool, "DepositUnlocked")
        .withArgs(user0.address, 0);
    });
  });
});
