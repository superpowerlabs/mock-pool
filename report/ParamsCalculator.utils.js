const fs = require("fs-extra");
const path = require("path");
const {expect, assert} = require("chai");
const {parse} = require("csv-parse/sync");

function getJSONFromCSV(input) {
  return parse(input, {
    columns: true,
    delimiter: "\t",
  });
}

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
} = require("../test/helpers");
const {upgrades} = require("hardhat");

// tests to be fixed

function normalize(val, n = 18) {
  return "" + val + "0".repeat(n);
}

describe("#Params Calculator", function () {
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
  let SynCityCouponsSimplified, blueprint;
  let tokenId1, tokenId3;

  let deployer, fundOwner, superAdmin, operator, validator, user1, user2, user3, treasury, user4, user5;

  before(async function () {
    initEthers(ethers);
    [deployer, fundOwner, superAdmin, operator, validator, user1, user2, user3, treasury, user4, user5] =
      await ethers.getSigners();
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
    SynCityCouponsSimplified = await ethers.getContractFactory("SynCityCoupons");
  });

  async function initAndDeploy(
    //[100, 8300] best choice
    stakeFactor = 100,
    swapFactor = 8300,
    sPSynrEquivalent = 100000,
    sPBoostFactor = 1500,
    sPBoostLimit = 500000,
    bPSynrEquivalent = 3000,
    bPBoostFactor = 75,
    bPBoostLimit = 25000,
    ratioFactor = 1000
  ) {
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

    synr.connect(fundOwner).transfer(user1.address, ethers.utils.parseEther("1000000000"));
    synr.connect(fundOwner).transfer(user2.address, ethers.utils.parseEther("1000000000"));
    synr.connect(fundOwner).transfer(user3.address, ethers.utils.parseEther("1000000000"));
    synr.connect(fundOwner).transfer(user4.address, ethers.utils.parseEther("1000000000"));

    sSynr = await SyntheticSyndicateERC20.deploy(superAdmin.address);
    await sSynr.deployed();

    await sSynr.connect(superAdmin).mint(user1.address, ethers.utils.parseEther("1000000000"));
    await sSynr.connect(superAdmin).mint(user2.address, ethers.utils.parseEther("1000000000"));

    pass = await SynCityPasses.deploy(validator.address);
    await pass.deployed();

    await pass.mintToken(user1.address);
    tokenId1 = (await pass.nextTokenId()).sub(1).toNumber();
    await pass.mintToken(user3.address);
    tokenId3 = (await pass.nextTokenId()).sub(1).toNumber();

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

    blueprint = await SynCityCouponsSimplified.deploy(8000);
    await blueprint.deployed();

    await blueprint.mint(user1.address, 2);
    await blueprint.mint(user3.address, 1);
    await blueprint.mint(user4.address, 10);

    seedPool = await upgrades.deployProxy(SeedPool, [seed.address, blueprint.address]);
    await seedPool.deployed();
    await seedPool.initPool(1000, 7 * 24 * 3600, 9800, swapFactor, stakeFactor, 800, 3000, 14);
    await seedPool.updateNftConf(sPSynrEquivalent, sPBoostFactor, sPBoostLimit, bPSynrEquivalent, bPBoostFactor, bPBoostLimit);

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

  it("should verify balance between stakeFactor and swapFactor", async function () {
    const params = [
      // [650, 50000],
      // [550, 45000],
      // [3600, 300000],
      // [680, 48000],
      // [750, 60000],
      // [700, 50000],
      // [720, 49000],

      // best choice
      [100, 220000],
    ];

    let report = [
      [
        "stakeFactor",
        "swapFactor",
        "SYNR/sSYNR amount",
        "SEED after staking SYNR",
        "SEED after swapping sSYNR",
        "Final SEED for SYNR",
        "Final SEED for sSYNR",
        "sSYNR/SYNR",
      ],
    ];

    for (let i = 0; i < params.length; i++) {
      const tokenAmount = "100000";
      const amount = ethers.utils.parseEther(tokenAmount);
      let [stakeFactor, swapFactor] = params[i];

      const row = [stakeFactor, swapFactor, tokenAmount];

      await initAndDeploy(stakeFactor, swapFactor);

      // approve SYNR spend
      await synr.connect(user1).approve(mainPool.address, amount);

      // console.log(amount.toString());

      let payload = await serializeInput(SYNR_STAKE, 365, amount);
      await mainTesseract.connect(user1).crossChainTransfer(1, payload, 4, 1);

      // approve sSYNR spend
      await sSynr.connect(user2).approve(mainPool.address, amount);
      let payload2 = await serializeInput(S_SYNR_SWAP, 0, amount);
      await mainTesseract.connect(user2).crossChainTransfer(1, payload2, 4, 1);

      let deposit = await mainPool.getDepositByIndex(user1.address, 0);
      let finalPayload = await fromDepositToTransferPayload(deposit);

      await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user1.address, finalPayload));

      deposit = await mainPool.getDepositByIndex(user2.address, 0);
      finalPayload = await fromDepositToTransferPayload(deposit);

      await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user2.address, finalPayload));

      await increaseBlockTimestampBy(366 * 24 * 3600);

      // unstake SEED and SYNR
      let seedDeposit = await seedPool.getDepositByIndex(user1.address, 0);
      let seedPayload = await fromDepositToTransferPayload(seedDeposit);

      let stakedSeedFromSYNR = ethers.utils.formatEther(seedDeposit.tokenAmount.toString()).toString().split(".")[0];
      row.push(stakedSeedFromSYNR);

      let seedDeposit2 = await seedPool.getDepositByIndex(user2.address, 0);

      let stakedSeedFromSSYNR = ethers.utils.formatEther(seedDeposit2.tokenAmount.toString()).toString().split(".")[0];
      row.push(stakedSeedFromSSYNR);

      await sideTesseract.connect(user1).crossChainTransfer(1, seedPayload, 2, 1);

      let seedFromSYNR = ethers.utils
        .formatEther((await seed.balanceOf(user1.address)).toString())
        .toString()
        .split(".")[0];

      row.push(seedFromSYNR);

      // unstake SEED from sSYNR

      await seedPool.connect(user2).unstake(0);
      let seedFromSSYNR = ethers.utils
        .formatEther((await seed.balanceOf(user2.address)).toString())
        .toString()
        .split(".")[0];
      row.push(seedFromSSYNR);
      row.push(parseInt(seedFromSSYNR) / parseInt(seedFromSYNR));

      report.push(row);

      if (!i) {
        console.info("APY:", parseInt(seedFromSYNR) / parseInt(stakedSeedFromSYNR));
      }
    }
    await fs.ensureDir(path.resolve(__dirname, "../tmp"));
    report.sort((a, b) => {
      a = a[7];
      b = b[7];
      return a > b ? 1 : a < b ? -1 : 0;
    });
    report = report.map((e) => e.join("\t")).join("\n");
    await fs.writeFile(path.resolve(__dirname, "../tmp/report.csv"), report);
    console.info(getJSONFromCSV(report));

    console.info("Report saved in", path.resolve(__dirname, "../tmp/report.csv"));
  });

  it("should verify balance between sPSynrEquivalent, sPBoostFactor and sPBoostLimit", async function () {
    // 1 SYNR Pass ~= 2 ETH ~= $5,800 ~= 100,000 $SYNR

    const params = [
      [
        100000, // sPSynrEquivalent
        100000, //sPBoostFactor
        1000000, //sPBoostLimit
      ],
      [100000, 500000, 200000],
      [100000, 200000, 500000],
    ];

    let report = [
      [
        "stakedAmount",
        "lockupTime",
        "sPSynrEquivalent",
        "sPBoostFactor",
        "sPBoostLimit",
        "SYNR amount",
        "SEED no pass",
        "SEED after staking SYNR",
        "SEED for Boost",
        "Ratio",
        "Percentage boosted/unboosted",
        "APY",
      ],
    ];

    for (let k = 365; k < 380; k += 92) {
      if (k > 365) {
        k = 365;
      }

      for (let i = 0; i < params.length; i++) {
        let [sPSynrEquivalent, sPBoostFactor, sPBoostLimit] = params[i];
        const tokenAmount = sPBoostLimit.toString();
        const amount = ethers.utils.parseEther(tokenAmount);
        const row = [tokenAmount, k, sPSynrEquivalent, sPBoostFactor, sPBoostLimit, tokenAmount];
        await initAndDeploy(100, 8300, sPSynrEquivalent, sPBoostFactor, sPBoostLimit);

        // approve SYNR spend
        await synr.connect(user1).approve(mainPool.address, amount);
        // console.log(amount.toString());
        let payload = await serializeInput(SYNR_STAKE, k, amount);
        await mainTesseract.connect(user1).crossChainTransfer(1, payload, 4, 1);
        let deposit = await mainPool.getDepositByIndex(user1.address, 0);
        let finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user1.address, finalPayload));

        //approve and transfer SYNR for user2
        await synr.connect(user2).approve(mainPool.address, amount);
        payload = await serializeInput(SYNR_STAKE, k, amount);
        await mainTesseract.connect(user2).crossChainTransfer(1, payload, 4, 1);
        deposit = await mainPool.getDepositByIndex(user2.address, 0);
        finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user2.address, finalPayload));

        //approve and transfer SYNR and boost for user3
        await synr.connect(user3).approve(mainPool.address, amount);
        payload = await serializeInput(SYNR_STAKE, k, amount);
        await mainTesseract.connect(user3).crossChainTransfer(1, payload, 4, 1);
        deposit = await mainPool.getDepositByIndex(user3.address, 0);
        finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user3.address, finalPayload));

        let payloadPass = await serializeInput(
          SYNR_PASS_STAKE_FOR_BOOST,
          k, // 1 year
          tokenId3
        );
        await pass.connect(user3).approve(mainPool.address, tokenId3);
        await mainTesseract.connect(user3).crossChainTransfer(1, payloadPass, 4, 1);

        deposit = await mainPool.getDepositByIndex(user3.address, 1);
        finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user3.address, finalPayload));

        let tokenAmount0 = (await mainPool.getDepositByIndex(user1.address, 0)).tokenAmountOrID;

        //approve and transfer pass for user 1
        payloadPass = await serializeInput(
          SYNR_PASS_STAKE_FOR_SEEDS,
          k, // 1 year
          tokenId1
        );
        await pass.connect(user1).approve(mainPool.address, tokenId1);
        await mainTesseract.connect(user1).crossChainTransfer(1, payloadPass, 4, 1);

        deposit = await mainPool.getDepositByIndex(user1.address, 1);
        finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user1.address, finalPayload));

        let tokenAmount1 = (await mainPool.getDepositByIndex(user1.address, 0)).tokenAmountOrID;

        let tRatio = tokenAmount0.div(tokenAmount1).toNumber();

        // console.log(tRatio)
        // process.exit()

        await increaseBlockTimestampBy(366 * 24 * 3600);

        // unstake SEED and SYNR
        let seedDeposit = await seedPool.getDepositByIndex(user1.address, 0);
        let seedPayload = await fromDepositToTransferPayload(seedDeposit);

        let seedAfterStake = (await seedPool.getDepositByIndex(user2.address, 0)).tokenAmount;

        await sideTesseract.connect(user1).crossChainTransfer(1, seedPayload, 2, 1);

        let seedFromSYNR = ethers.utils
          .formatEther((await seed.balanceOf(user1.address)).toString())
          .toString()
          .split(".")[0];

        // unstake for user2 (no boost)
        seedDeposit = await seedPool.getDepositByIndex(user2.address, 0);
        seedPayload = await fromDepositToTransferPayload(seedDeposit);
        await sideTesseract.connect(user2).crossChainTransfer(1, seedPayload, 2, 1);
        await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(user2.address, seedPayload));

        let noBoostNoExtra = ethers.utils
          .formatEther((await seed.balanceOf(user2.address)).toString())
          .toString()
          .split(".")[0];

        //unstake from user3
        seedDeposit = await seedPool.getDepositByIndex(user3.address, 0);
        seedPayload = await fromDepositToTransferPayload(seedDeposit);
        await sideTesseract.connect(user3).crossChainTransfer(1, seedPayload, 2, 1);
        await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(user3.address, seedPayload));

        let balanceAfterBoost = ethers.utils
          .formatEther((await seed.balanceOf(user3.address)).toString())
          .toString()
          .split(".")[0];
        row.push(noBoostNoExtra);
        row.push(seedFromSYNR);
        row.push(balanceAfterBoost);
        let ratio = (balanceAfterBoost / seedFromSYNR)
          .toString()
          .split(".")
          .map((e) => e.substring(0, 3))
          .join(".");

        row.push(ratio);
        row.push(
          (balanceAfterBoost / noBoostNoExtra)
            .toString()
            .split(".")
            .map((e) => e.substring(0, 3))
            .join(".")
        );
        row.push(
          (noBoostNoExtra / seedAfterStake)
            .toString()
            .split(".")
            .map((e) => e.substring(0, 3))
            .join(".")
        );

        report.push(row);
      }
    }
    await fs.ensureDir(path.resolve(__dirname, "../tmp"));
    // report.sort((a, b) => {
    //   a = a[8];
    //   b = b[8];
    //   return a > b ? 1 : a < b ? -1 : 0;
    // });
    report = report.map((e) => e.join("\t")).join("\n");
    await fs.writeFile(path.resolve(__dirname, "../tmp/report2.csv"), report);
    console.info(getJSONFromCSV(report));

    console.info("Report saved in", path.resolve(__dirname, "../tmp/report2.csv"));
  });

  it("should verify the balance between blueprint boost and pass boost", async function () {
    const params = [
      [
        100000, //sPBoostFactor
        1000000, //sPBoostLimit
        Math.floor(100000 / 20), //bPBoostFactor
        1000000, //bPBoostLimit
      ],
      [
        100000, //sPBoostFactor
        1000000, //sPBoostLimit
        Math.floor(100000 / 10), //bPBoostFactor
        50000, //bPBoostLimit
      ],
      // [500000, 200000, Math.floor(500000 / 20), 200000],
      // [200000, 500000, Math.floor(200000 / 20), 500000],
    ];

    let report = [
      [
        "SYNR amount",
        "lockupTime",
        "sPBoostFactor",
        "sPBoostLimit",
        "bPBoostFactor",
        "bPBoostLimit",
        "Final Boost for Pass without SYNR",
        "Final Boost for Blueprints without SYNR",
        "Ratio",
      ],
    ];

    for (let k = 92; k < 380; k += 92) {
      if (k > 365) {
        k = 365;
      }

      for (let i = 0; i < params.length; i++) {
        const tokenAmount = "100000";
        const amount = ethers.utils.parseEther(tokenAmount);
        let [sPBoostFactor, sPBoostLimit, bPBoostFactor, bPBoostLimit] = params[i];
        const row = [tokenAmount, k, sPBoostFactor, sPBoostLimit, bPBoostFactor, bPBoostLimit];
        await initAndDeploy(100, 8300, 100000, sPBoostFactor, sPBoostLimit, undefined, bPBoostFactor, bPBoostLimit);

        // approve SYNR spend no boost
        await synr.connect(user1).approve(mainPool.address, amount);
        // console.log(amount.toString());
        let payload = await serializeInput(SYNR_STAKE, k, amount);
        await mainTesseract.connect(user1).crossChainTransfer(1, payload, 4, 1);

        let deposit = await mainPool.getDepositByIndex(user1.address, 0);
        let finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user1.address, finalPayload));

        //approve and transfer SYNR and boost for user3
        await synr.connect(user3).approve(mainPool.address, amount);
        payload = await serializeInput(SYNR_STAKE, k, amount);
        await mainTesseract.connect(user3).crossChainTransfer(1, payload, 4, 1);

        deposit = await mainPool.getDepositByIndex(user3.address, 0);
        finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user3.address, finalPayload));

        let payloadPass = await serializeInput(
          SYNR_PASS_STAKE_FOR_BOOST,
          k, // 1 year
          tokenId3
        );
        await pass.connect(user3).approve(mainPool.address, tokenId3);
        await mainTesseract.connect(user3).crossChainTransfer(1, payloadPass, 4, 1);

        deposit = await mainPool.getDepositByIndex(user3.address, 1);
        finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user3.address, finalPayload));

        //approve and transfer blueprint on bsc for user 4
        await synr.connect(user4).approve(mainPool.address, amount);
        payload = await serializeInput(SYNR_STAKE, k, amount);
        await mainTesseract.connect(user4).crossChainTransfer(1, payload, 4, 1);

        deposit = await mainPool.getDepositByIndex(user4.address, 0);
        finalPayload = await fromDepositToTransferPayload(deposit);
        await sideTesseract.completeCrossChainTransfer(1, mockEncodedVm(user4.address, finalPayload));

        await blueprint.connect(user4).approve(seedPool.address, 5);
        await seedPool.connect(user4).stake(BLUEPRINT_STAKE_FOR_BOOST, k, 5);

        await increaseBlockTimestampBy(366 * 24 * 3600);

        // unstake SEED and SYNR
        let seedDeposit = await seedPool.getDepositByIndex(user1.address, 0);
        let seedPayload = await fromDepositToTransferPayload(seedDeposit);

        await sideTesseract.connect(user1).crossChainTransfer(1, seedPayload, 2, 1);

        let seedFromSYNR = ethers.utils
          .formatEther((await seed.balanceOf(user1.address)).toString())
          .toString()
          .split(".")[0];

        //unstake from user3
        seedDeposit = await seedPool.getDepositByIndex(user3.address, 0);
        seedPayload = await fromDepositToTransferPayload(seedDeposit);
        await sideTesseract.connect(user3).crossChainTransfer(1, seedPayload, 2, 1);
        await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(user3.address, seedPayload));

        seedDeposit = await seedPool.getDepositByIndex(user3.address, 1);
        seedPayload = await fromDepositToTransferPayload(seedDeposit);

        await sideTesseract.connect(user3).crossChainTransfer(1, seedPayload, 2, 1);
        await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(user3.address, seedPayload));

        let balanceAfterBoostPass = ethers.utils
          .formatEther((await seed.balanceOf(user3.address)).toString())
          .toString()
          .split(".")[0];
        row.push(balanceAfterBoostPass - seedFromSYNR);

        // unstake from user4
        seedDeposit = await seedPool.getDepositByIndex(user4.address, 0);
        seedPayload = await fromDepositToTransferPayload(seedDeposit);
        await sideTesseract.connect(user4).crossChainTransfer(1, seedPayload, 2, 1);
        await mainTesseract.completeCrossChainTransfer(1, mockEncodedVm(user4.address, seedPayload));

        let balanceAfterBoostBlueprint = ethers.utils
          .formatEther((await seed.balanceOf(user4.address)).toString())
          .toString()
          .split(".")[0];

        row.push(balanceAfterBoostBlueprint - seedFromSYNR);

        row.push(parseInt(balanceAfterBoostBlueprint - seedFromSYNR) / parseInt(balanceAfterBoostPass - seedFromSYNR));
        report.push(row);
      }
    }
    await fs.ensureDir(path.resolve(__dirname, "../tmp"));
    // report.sort((a, b) => {
    //   a = a[7];
    //   b = b[7];
    //   return a > b ? 1 : a < b ? -1 : 0;
    // });
    report = report.map((e) => e.join("\t")).join("\n");
    await fs.writeFile(path.resolve(__dirname, "../tmp/report3.csv"), report);
    console.info(report);

    console.info("Report saved in", path.resolve(__dirname, "../tmp/report3.csv"));
  });
});
