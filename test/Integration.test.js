const {expect, assert} = require("chai");

const {fromDepositToTransferPayload, serializeInput} = require("../scripts/lib/PayloadUtils");

const {
  initEthers,
  assertThrowsMessage,
  getTimestamp,
  increaseBlockTimestampBy,
  bytes32Address,
  mockEncodedVm,
  S_SYNR_SWAP,
  SYNR_STAKE,
  SYNR_PASS_STAKE_FOR_BOOST,
  SYNR_PASS_STAKE_FOR_SEEDS,
  BLUEPRINT_STAKE_FOR_BOOST,
} = require("./helpers");
const {upgrades} = require("hardhat");

// tests to be fixed

function normalize(val, n = 18) {
  return "" + val + "0".repeat(n);
}

describe("#Integration test", function () {
  let WormholeMock, wormhole;
  let SyndicateERC20, synr;
  let SyntheticSyndicateERC20, sSynr;
  let Tesseract, mainTesseract, sideTesseract;
  let MainWormholeBridge, mainBridge;
  let SideWormholeBridge, sideBridge;
  let MainPool, mainPool;
  let TesseractV2;
  let SeedToken, seed;
  let SynCityPasses, pass;
  let SeedPool, seedPool;
  let SynCityCoupons, blueprint;

  let deployer, fundOwner, superAdmin, operator, validator, user1, user2, user3, treasury;

  before(async function () {
    initEthers(ethers);
    [deployer, fundOwner, superAdmin, operator, validator, user1, user2, user3, treasury] = await ethers.getSigners();
    SyndicateERC20 = await ethers.getContractFactory("SyndicateERC20");
    SyntheticSyndicateERC20 = await ethers.getContractFactory("SyntheticSyndicateERC20");
    Tesseract = await ethers.getContractFactory("Tesseract");
    TesseractV2 = await ethers.getContractFactory("TesseractV2Mock");
    MainWormholeBridge = await ethers.getContractFactory("MainWormholeBridgeMock");
    SideWormholeBridge = await ethers.getContractFactory("SideWormholeBridgeMock");
    SeedPool = await ethers.getContractFactory("SeedPool");
    MainPool = await ethers.getContractFactory("MainPool");
    SeedToken = await ethers.getContractFactory("SeedToken");
    WormholeMock = await ethers.getContractFactory("WormholeMock");
    SynCityPasses = await ethers.getContractFactory("SynCityPassesMock");
    SynCityCoupons = await ethers.getContractFactory("SynCityCoupons");
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

    await sSynr.connect(superAdmin).mint(fundOwner.address, ethers.utils.parseEther("300000"));
    await sSynr.connect(superAdmin).mint(user2.address, ethers.utils.parseEther("200000"));

    pass = await SynCityPasses.deploy(validator.address);
    await pass.deployed();

    await pass.mintToken(fundOwner.address);
    await pass.mintToken(user1.address);
    await pass.mintToken(user2.address);
    await pass.mintToken(user2.address);

    mainPool = await upgrades.deployProxy(MainPool, [synr.address, sSynr.address, pass.address]);
    await mainPool.deployed();

    mainTesseract = await upgrades.deployProxy(Tesseract, []);
    await mainTesseract.deployed();

    mainBridge = await MainWormholeBridge.deploy(mainTesseract.address, mainPool.address);
    await mainBridge.deployed();

    await sSynr.updateRole(mainPool.address, await sSynr.ROLE_WHITE_LISTED_RECEIVER());
    await mainPool.setBridge(mainBridge.address, true);
    await mainPool.initPool(7, 4000);

    await mainTesseract.setBridge(1, mainBridge.address);

    seed = await SeedToken.deploy();
    await seed.deployed();

    blueprint = await SynCityCoupons.deploy(8000);
    await blueprint.deployed();
    await blueprint.mint(user1.address, 2);
    await blueprint.mint(user3.address, 1);
    await blueprint.mint(fundOwner.address, 1);

    seedPool = await upgrades.deployProxy(SeedPool, [seed.address, blueprint.address]);
    await seedPool.deployed();
    await seedPool.initPool(1000, 7 * 24 * 3600, 9800, 1000, 100, 800, 3000, 10);
    await seedPool.updateNftConf(100000, 1500, 500000, 3000, 150, 1000);

    // process.exit()

    sideTesseract = await upgrades.deployProxy(Tesseract);
    await sideTesseract.deployed();

    sideBridge = await SideWormholeBridge.deploy(sideTesseract.address, seedPool.address);
    await sideBridge.deployed();

    await seedPool.setBridge(sideBridge.address, true);
    await sideTesseract.setBridge(1, sideBridge.address);

    await seed.grantRole(await seed.MINTER_ROLE(), seedPool.address);

    wormhole = await WormholeMock.deploy();
    await mainBridge.wormholeInit(2, wormhole.address);
    await wormhole.deployed();

    await mainBridge.wormholeRegisterContract(4, bytes32Address(sideBridge.address));

    await sideBridge.wormholeInit(4, wormhole.address);
    await sideBridge.wormholeRegisterContract(2, bytes32Address(mainBridge.address));
  }

  async function configure() {}

  beforeEach(async function () {
    await initAndDeploy();
  });

  it("should manage the entire flow", async function () {
    const amount = ethers.utils.parseEther("10000");
    const amount2 = ethers.utils.parseEther("20000");
    const amount3 = ethers.utils.parseEther("5000");

    // stake SYNR in the Tesseract
    let payload = await serializeInput(
      SYNR_STAKE, // SYNR
      365, // 1 year
      amount
    );
    expect(payload).equal("1000000000000000000000036502");

    let payload2 = await serializeInput(
      SYNR_STAKE, // SYNR
      150,
      amount2
    );
    expect(payload2).equal("2000000000000000000000015002");

    let payload3 = await serializeInput(
      S_SYNR_SWAP, // sSYNR
      0, // 1 year
      amount3
    );
    expect(payload3).equal("500000000000000000000000001");

    await synr.connect(fundOwner).approve(mainPool.address, ethers.utils.parseEther("35000"));

    expect(
      await mainTesseract.connect(fundOwner).crossChainTransfer(
        1,
        payload,
        4, // BSC

        1
      )
    )
      .emit(mainTesseract, "DepositSaved")
      .withArgs(fundOwner.address, 0);

    let tvl = await mainPool.tvl();
    expect(tvl.synrAmount).equal(amount);

    let deposit = await mainPool.getDepositByIndex(fundOwner.address, 0);
    expect(deposit.tokenAmountOrID).equal(amount);
    expect(deposit.tokenType).equal(SYNR_STAKE);
    expect(deposit.otherChain).equal(4);

    const finalPayload = await fromDepositToTransferPayload(deposit);

    await sSynr.connect(user2).approve(mainPool.address, ethers.utils.parseEther("30000"));

    expect(
      await mainTesseract.connect(user2).crossChainTransfer(
        1,
        payload3,
        4, // BSC

        1
      )
    )
      .emit(mainTesseract, "DepositSaved")
      .withArgs(user2.address, 0);

    let deposit3 = await mainPool.getDepositByIndex(user2.address, 0);
    expect(deposit3.tokenAmountOrID).equal(amount3);
    expect(deposit3.tokenType).equal(S_SYNR_SWAP);
    expect(deposit3.otherChain).equal(4);
    const finalPayload3 = await fromDepositToTransferPayload(deposit3);

    expect(
      await mainTesseract.connect(fundOwner).crossChainTransfer(
        1,
        payload2,
        4, // BSC

        2
      )
    )
      .emit(mainTesseract, "DepositSaved")
      .withArgs(fundOwner.address, 1);

    tvl = await mainPool.tvl();
    expect(tvl.synrAmount).equal(amount.add(amount2));

    let deposit2 = await mainPool.getDepositByIndex(fundOwner.address, 1);
    expect(deposit2.tokenAmountOrID).equal(amount2);
    expect(deposit2.tokenType).equal(SYNR_STAKE);
    expect(deposit2.otherChain).equal(4);
    const finalPayload2 = await fromDepositToTransferPayload(deposit2);

    expect(await synr.balanceOf(mainPool.address)).equal(amount.add(amount2));

    expect((await mainPool.users(fundOwner.address)).synrAmount).equal("30000000000000000000000");

    expect(await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayload)))
      .emit(sideTesseract, "DepositSaved")
      .withArgs(fundOwner.address, 0);

    let conf2 = await seedPool.conf();
    let tvl2 = await seedPool.tvl();
    let seedAmount = amount.mul(conf2.stakeFactor).mul(conf2.priceRatio).div(1000000);
    expect(tvl2.stakedTokenAmount).equal(seedAmount);

    expect(await seed.balanceOf(fundOwner.address)).equal(0);

    expect(await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayload2)))
      .emit(sideTesseract, "DepositSaved")
      .withArgs(fundOwner.address, 1);

    expect(await seed.balanceOf(fundOwner.address)).equal("2917300862506341958");

    await seed.connect(fundOwner).approve(operator.address, ethers.utils.parseEther("10"));
    // seed token is locked
    expect(await seed.allowance(fundOwner.address, operator.address)).equal(0);

    await seed.unpauseAllowance();

    expect(await seed.allowance(fundOwner.address, operator.address)).equal(ethers.utils.parseEther("10"));

    expect(await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user2.address, finalPayload3)))
      .emit(sideTesseract, "DepositSaved")
      .withArgs(user2.address, 0);

    conf2 = await seedPool.conf();
    tvl2 = await seedPool.tvl();
    let seedAmount2 = amount2.mul(conf2.stakeFactor).mul(conf2.priceRatio).div(1000000);
    let seedAmount3 = amount3.mul(conf2.swapFactor).mul(conf2.priceRatio).div(1000000);

    expect(tvl2.stakedTokenAmount).equal(seedAmount.add(seedAmount2).add(seedAmount3));

    await increaseBlockTimestampBy(20 * 24 * 3600);

    let ts = await getTimestamp();
    const untaxedPendingRewards = await seedPool.untaxedPendingRewards(fundOwner.address, ts + 1);

    let boostWeight = await seedPool.boostWeight(fundOwner.address);
    expect(boostWeight).equal(1e9);

    await seedPool.connect(fundOwner).collectRewards();
    let seedDeposit = await seedPool.getDepositByIndex(fundOwner.address, 0);
    expect(seedDeposit.lastRewardsAt).equal(await getTimestamp());

    ts = await getTimestamp();
    const untaxedPendingRewards3 = await seedPool.untaxedPendingRewards(user2.address, ts + 1);
    const tax = await seedPool.calculateTaxOnRewards(untaxedPendingRewards3);
    expect(await seed.balanceOf(user2.address)).equal(0);

    await seedPool.connect(user2).collectRewards();
    expect(await seed.balanceOf(user2.address)).equal(untaxedPendingRewards3.sub(tax));

    let payload4 = await serializeInput(
      SYNR_PASS_STAKE_FOR_BOOST, // sSYNR
      0,
      9
    );
    expect(payload4).equal("900003");

    // approve the spending of the pass
    await pass.connect(fundOwner).approve(mainPool.address, 9);

    expect(
      await mainTesseract.connect(fundOwner).crossChainTransfer(
        1,
        payload4,
        4, // BSC

        3
      )
    )
      .emit(mainTesseract, "DepositSaved")
      .withArgs(fundOwner.address, 2);

    let deposit4 = await mainPool.getDepositByIndex(fundOwner.address, 2);
    const finalPayload4 = await fromDepositToTransferPayload(deposit4);

    expect(await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayload4)))
      .emit(sideTesseract, "DepositSaved")
      .withArgs(fundOwner.address, 2);

    boostWeight = await seedPool.boostWeight(fundOwner.address);
    expect(boostWeight).equal(1150000000);

    await increaseBlockTimestampBy(20 * 24 * 3600);

    ts = await getTimestamp();

    const untaxedPendingRewardsBoosted = await seedPool.untaxedPendingRewards(fundOwner.address, ts + 1);

    // console.log(untaxedPendingRewards.toString())
    // console.log(untaxedPendingRewardsBoosted.toString())

    await increaseBlockTimestampBy(330 * 24 * 3600);

    expect(seedDeposit.unlockedAt).equal(0);
    expect(seedDeposit.tokenAmount).equal(ethers.utils.parseEther("10000"));
    const seedPayload = await fromDepositToTransferPayload(seedDeposit);

    ts = await getTimestamp();
    // unstake

    expect(await sideTesseract.connect(fundOwner).crossChainTransfer(1, seedPayload, 2, 1))
      .emit(sideTesseract, "DepositUnlocked")
      .withArgs(fundOwner.address, 0);

    // unstake SEED from sSYNR

    expect(await seed.balanceOf(user2.address)).equal("0");

    await seedPool.connect(user2).unstake(0);

    expect(await seed.balanceOf(user2.address)).equal("50000000000000000000000");

    seedDeposit = await seedPool.getDepositByIndex(fundOwner.address, 0);
    expect(seedDeposit.tokenAmountOrID).equal(amount);
    expect(seedDeposit.unlockedAt).equal(ts + 1);
    const synrBalanceBefore = await synr.balanceOf(fundOwner.address);

    expect(await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, seedPayload)))
      .emit(mainTesseract, "DepositUnlocked")
      .withArgs(fundOwner.address, 0);

    const synrBalanceAfter = await synr.balanceOf(fundOwner.address);
    expect(synrBalanceAfter.sub(synrBalanceBefore)).equal(amount);

    let treasuryBalanceBefore = await seed.balanceOf(treasury.address);
    await seedPool.withdrawPenaltiesOrTaxes(10, treasury.address, 0);
    let treasuryBalanceAfter = await seed.balanceOf(treasury.address);
    expect(treasuryBalanceAfter - treasuryBalanceBefore).equal(10);
    await seedPool.withdrawPenaltiesOrTaxes(0, treasury.address, 0);
    expect(await seedPool.taxes()).equal(0);
    await assertThrowsMessage(seedPool.withdrawPenaltiesOrTaxes(10, treasury.address, 0), "SidePool: amount not available");
  });

  it("should verify early unstake", async function () {
    const amount = ethers.utils.parseEther("10000");
    await synr.connect(fundOwner).transferFrom(fundOwner.address, user1.address, amount);

    // stake SYNR in the Tesseract
    const payload = await serializeInput(
      SYNR_STAKE, // SYNR
      300,
      amount
    );

    expect(payload).equal("1000000000000000000000030002");

    await synr.connect(user1).approve(mainPool.address, ethers.utils.parseEther("10000"));

    await mainTesseract.connect(user1).crossChainTransfer(
      1,
      payload,
      4, // BSC

      1
    );

    let deposit = await mainPool.getDepositByIndex(user1.address, 0);
    expect(deposit.tokenAmountOrID).equal(amount);
    expect(deposit.tokenType).equal(SYNR_STAKE);
    expect(deposit.otherChain).equal(4);

    const finalPayload = await fromDepositToTransferPayload(deposit);

    expect(await synr.balanceOf(mainPool.address)).equal(amount);

    await sideTesseract.connect(user1).completeCrossChainTransfer(1, mockEncodedVm(user1.address, finalPayload));

    await increaseBlockTimestampBy(150 * 24 * 3600);

    expect(await seedPool.canUnstakeWithoutTax(user1.address, 0)).equal(false);

    let seedDeposit = await seedPool.getDepositByIndex(user1.address, 0);
    expect(seedDeposit.unlockedAt).equal(0);
    const seedPayload = await fromDepositToTransferPayload(seedDeposit);

    const synrBalanceBefore = await synr.balanceOf(user1.address);

    // unstake
    await sideTesseract.connect(user1).crossChainTransfer(1, seedPayload, 2, 1);

    const ts = await getTimestamp();
    const tax = await mainPool.calculatePenaltyForEarlyUnstake(ts, await mainPool.getDepositByIndex(user1.address, 0));
    expect(amount.sub(tax)).equal("8000000000000000000000");

    await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(user1.address, seedPayload));

    const synrBalanceAfter = await synr.balanceOf(user1.address);
    expect(synrBalanceAfter.sub(synrBalanceBefore)).equal(amount.sub(tax));

    expect(await mainPool.penalties()).equal(tax);
    const synrBalanceBeforePenalty = await synr.balanceOf(user2.address);
    await mainPool.withdrawPenalties(tax, user2.address);
    const synrBalanceAfterPenalty = await synr.balanceOf(user2.address);
    expect(await synrBalanceAfterPenalty).equal(synrBalanceBeforePenalty + tax);
  });

  it("should start the process, upgrade the contract and complete the flow", async function () {
    const amount = ethers.utils.parseEther("10000");

    expect(await mainTesseract.supportedBridgeById(1)).equal("Wormhole");
    expect(mainTesseract.supportedBridgeById(2)).revertedWith("Tesseract: unsupported bridge");

    // stake SYNR in the Tesseract
    const payload = await serializeInput(
      SYNR_STAKE, // SYNR
      365, // 1 year
      amount
    );

    expect(payload).equal("1000000000000000000000036502");

    await synr.connect(fundOwner).approve(mainPool.address, ethers.utils.parseEther("10000"));

    await mainTesseract.connect(fundOwner).crossChainTransfer(
      1,
      payload,
      4, // BSC

      1
    );

    let deposit = await mainPool.getDepositByIndex(fundOwner.address, 0);
    expect(deposit.tokenAmountOrID).equal(amount);
    expect(deposit.tokenType).equal(SYNR_STAKE);
    expect(deposit.otherChain).equal(4);

    const finalPayload = await fromDepositToTransferPayload(deposit);

    expect(await synr.balanceOf(mainPool.address)).equal(amount);

    await sideTesseract.connect(fundOwner).completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayload));

    await increaseBlockTimestampBy(366 * 24 * 3600);

    // upgrade contract

    expect(await mainTesseract.version()).equal(1);

    mainTesseract = await upgrades.upgradeProxy(mainTesseract.address, TesseractV2);

    expect(await mainTesseract.version()).equal(2);
    expect(await mainTesseract.supportedBridgeById(1)).equal("Wormhole");
    expect(await mainTesseract.supportedBridgeById(2)).equal("SomeOther");

    let seedDeposit = await seedPool.getDepositByIndex(fundOwner.address, 0);
    expect(seedDeposit.unlockedAt).equal(0);
    const seedPayload = await fromDepositToTransferPayload(seedDeposit);

    const ts = await getTimestamp();
    // unstake
    await sideTesseract.connect(fundOwner).crossChainTransfer(1, seedPayload, 2, 1);
    seedDeposit = await seedPool.getDepositByIndex(fundOwner.address, 0);

    expect(seedDeposit.unlockedAt).greaterThan(ts);

    const synrBalanceBefore = await synr.balanceOf(fundOwner.address);

    await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, seedPayload));
    const synrBalanceAfter = await synr.balanceOf(fundOwner.address);
    expect(synrBalanceAfter.sub(synrBalanceBefore)).equal(amount);
  });

  it("should stake pass for boost and increase boostWeight", async function () {
    //Stake SYNR TO BE BOOSTED
    const amount = ethers.utils.parseEther("10000");
    const payload = await serializeInput(
      SYNR_STAKE, // SYNR
      365, // 1 year
      amount
    );
    await synr.connect(fundOwner).approve(mainPool.address, ethers.utils.parseEther("10000"));
    await mainTesseract.connect(fundOwner).crossChainTransfer(
      1,
      payload,
      4, // BSC

      1
    );
    let depositSYNR = await mainPool.getDepositByIndex(fundOwner.address, 0);
    const finalPayloadSynr = await fromDepositToTransferPayload(depositSYNR);
    await sideTesseract.connect(fundOwner).completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayloadSynr));

    //STAKE PASS
    let boostWeightBefore = Number((await seedPool.boostWeight(fundOwner.address)).toString());
    // console.log(boostWeightBefore);
    const payloadPass = await serializeInput(
      SYNR_PASS_STAKE_FOR_BOOST,
      365, // 1 year
      9
    );
    expect(payloadPass).equal("936503");
    await pass.connect(fundOwner).approve(mainPool.address, 9);
    await mainTesseract.connect(fundOwner).crossChainTransfer(
      1,
      payloadPass,
      4, // BSC

      1
    );

    let deposit = await mainPool.getDepositByIndex(fundOwner.address, 1);
    expect(deposit.tokenAmountOrID).equal(9);
    expect(deposit.tokenType).equal(SYNR_PASS_STAKE_FOR_BOOST);
    expect(deposit.otherChain).equal(4);

    const finalPayload = await fromDepositToTransferPayload(deposit);
    await sideTesseract.connect(fundOwner).completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayload));

    boostWeightAfter = Number((await seedPool.boostWeight(fundOwner.address)).toString());
    // console.log(boostWeightAfter);
    expect(boostWeightAfter).greaterThan(boostWeightBefore);

    await increaseBlockTimestampBy(366 * 24 * 3600);

    let seedDeposit = await seedPool.getDepositByIndex(fundOwner.address, 1);

    expect(seedDeposit.unlockedAt).equal(0);
    const seedPayload = await fromDepositToTransferPayload(seedDeposit);
    const ts = await getTimestamp();

    // unstake
    await sideTesseract.connect(fundOwner).crossChainTransfer(1, seedPayload, 2, 1);
    seedDeposit = await seedPool.getDepositByIndex(fundOwner.address, 1);

    expect(seedDeposit.unlockedAt).greaterThan(ts);

    const passBefore = await pass.balanceOf(fundOwner.address);

    await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, seedPayload));

    const passAfter = await pass.balanceOf(fundOwner.address);

    expect(passAfter.sub(passBefore)).equal(1);
  });

  it("should stake pass for seed", async function () {
    // stake SYNR in the Tesseract
    const payload = await serializeInput(
      SYNR_PASS_STAKE_FOR_SEEDS,
      365, // 1 year
      9
    );
    expect(payload).equal("936504");
    await pass.connect(fundOwner).approve(mainPool.address, 9);
    await mainTesseract.connect(fundOwner).crossChainTransfer(
      1,
      payload,
      4, // BSC

      1
    );

    let deposit = await mainPool.getDepositByIndex(fundOwner.address, 0);
    expect(deposit.tokenAmountOrID).equal(9);
    expect(deposit.tokenType).equal(SYNR_PASS_STAKE_FOR_SEEDS);
    expect(deposit.otherChain).equal(4);

    const finalPayload = await fromDepositToTransferPayload(deposit);
    await sideTesseract.connect(fundOwner).completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayload));

    await increaseBlockTimestampBy(366 * 24 * 3600);

    let seedDeposit = await seedPool.getDepositByIndex(fundOwner.address, 0);
    expect(seedDeposit.unlockedAt).equal(0);
    const seedPayload = await fromDepositToTransferPayload(seedDeposit);
    const ts = await getTimestamp();

    // unstake
    await sideTesseract.connect(fundOwner).crossChainTransfer(1, seedPayload, 2, 1);
    seedDeposit = await seedPool.getDepositByIndex(fundOwner.address, 0);

    expect(seedDeposit.unlockedAt).greaterThan(ts);

    const passBefore = await pass.balanceOf(fundOwner.address);

    await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, seedPayload));
    const passAfter = await pass.balanceOf(fundOwner.address);
    expect(passAfter.sub(passBefore)).equal(1);
    expect(seedDeposit.tokenType).equal(4);
  });

  it("should stake blueprints for boost and increase boostWeight", async function () {
    let boostWeightBefore = Number((await seedPool.boostWeight(fundOwner.address)).toString());
    const amount = ethers.utils.parseEther("100");
    // stake SYNR in the Tesseract
    const payload = await serializeInput(
      SYNR_STAKE, // SYNR
      365, // 1 year
      amount
    );
    await synr.connect(fundOwner).approve(mainPool.address, ethers.utils.parseEther("100"));
    await mainTesseract.connect(fundOwner).crossChainTransfer(
      1,
      payload,
      4, // BSC

      1
    );
    let deposit = await mainPool.getDepositByIndex(fundOwner.address, 0);
    const finalPayload = await fromDepositToTransferPayload(deposit);
    await sideTesseract.connect(fundOwner).completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayload));
    //console.log(await seedPool.getDepositByIndex(fundOwner.address, 0));
    //stake blueprints for boost

    await blueprint.connect(fundOwner).approve(seedPool.address, 4);
    expect(await seedPool.connect(fundOwner).stake(BLUEPRINT_STAKE_FOR_BOOST, 0, 4))
      .emit(seedPool, "DepositSaved")
      .withArgs(fundOwner.address, 0);

    //console.log(await seedPool.getDepositByIndex(fundOwner.address, 1));
    boostWeightAfter = Number((await seedPool.boostWeight(fundOwner.address)).toString());

    expect(boostWeightAfter).greaterThan(boostWeightBefore);
  });

  it("should stake pass for seed multiple times", async function () {
    // stake SYNR in the Tesseract
    let multiple = 10;
    for (let x = 0; x < multiple; x++) {
      const amount = ethers.utils.parseEther("1000");
      const payload = await serializeInput(
        SYNR_STAKE, // SYNR
        365, // 1 year
        amount
      );
      await synr.connect(fundOwner).approve(mainPool.address, ethers.utils.parseEther("1000"));
      await mainTesseract.connect(fundOwner).crossChainTransfer(
        1,
        payload,
        4, // BSC

        1
      );
      let deposit = await mainPool.getDepositByIndex(fundOwner.address, x);
      const finalPayload = await fromDepositToTransferPayload(deposit);
      await sideTesseract.connect(fundOwner).completeCrossChainTransfer(1, mockEncodedVm(fundOwner.address, finalPayload));
    }
  });
});
