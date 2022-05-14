// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

// Author: Francesco Sullo <francesco@sullo.co>
// (c) 2022+ SuperPower Labs Inc.

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./token/TokenReceiver.sol";
import "./utils/PayloadUtilsUpgradeable.sol";
import "./token/SeedToken.sol";
import "./token/WeedToken.sol";
import "./token/TurfNFT.sol";
import "./token/FarmNFT.sol";
import "./interfaces/IERC721Minimal.sol";

import "hardhat/console.sol";

contract WeedPool is PayloadUtilsUpgradeable, TokenReceiver, Initializable, OwnableUpgradeable, UUPSUpgradeable {
  using SafeMathUpgradeable for uint256;
  using AddressUpgradeable for address;

  event DepositSaved(address indexed user, uint16 indexed mainIndex);

  event DepositUnlocked(address indexed user, uint16 indexed mainIndex);

  event RewardsCollected(address indexed user, uint256 indexed rewards);

  struct Deposit {
    // @dev token type (0: sSYNR, 1: SYNR, 2: SYNR Pass)
    uint8 tokenType;
    // @dev locking period - from
    uint32 lockedFrom;
    // @dev locking period - until
    uint32 lockedUntil;
    // @dev token amount staked
    // SYNR maxTokenSupply is 10 billion * 18 decimals = 1e28
    // which is less type(uint96).max (~79e28)
    uint96 tokenAmountOrID;
    uint32 unlockedAt;
    // @dev mainIndex Since the process is asyncronous, the same deposit can be at a different index
    // on the main net and on the sidechain. This guarantees alignment
    uint16 mainIndex;
    // @dev pool token amount staked
    uint128 tokenAmount; //
    // @dev when claimed rewards last time
    uint32 lastRewardsAt;
    // @dev rewards ratio when staked
    uint32 rewardsFactor;
  }

  /// @dev Data structure representing token holder using a pool
  struct User {
    // @dev Total passes staked
    uint16 farmAmount;
    // @dev Total blueprints staked
    uint16 turfAmount;
    // @dev Total staked amount
    uint128 tokenAmount;
    Deposit[] deposits;
  }

  struct Conf {
    uint16 maximumLockupTime;
    uint32 poolInitAt; // the moment that the pool start operating, i.e., when initPool is first launched
    uint32 rewardsFactor; // initial ratio, decaying every decayInterval of a decayFactor
    uint32 decayInterval; // ex. 7 * 24 * 3600, 7 days
    uint16 decayFactor; // ex. 9850 >> decays of 1.5% every 7 days
    uint32 lastRatioUpdateAt;
    uint32 swapFactor;
    uint32 stakeFactor;
    uint16 taxPoints; // ex 250 = 2.5%
    uint16 burnRatio;
    uint32 priceRatio;
    uint8 coolDownDays; // cool down period for
    uint8 status;
  }

  struct TVL {
    uint16 turfAmount;
    uint16 farmAmount;
    uint128 stakedTokenAmount;
  }

  // users and deposits
  mapping(address => User) public users;
  Conf public conf;

  SeedToken public stakedToken;
  WeedToken public rewardsToken;
  TurfNFT public turf;
  FarmNFT public farm;

  uint256 public penalties;
  uint256 public taxes;
  address public oracle;

  TVL public tvl;

  //  /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address stakedToken_,
      address rewardsToken_) initializer {
      __Ownable_init();
    require(stakedToken_.isContract(), "WeedPool: stakedToken not a contract");
    require(rewardsToken_.isContract(), "WeedPool: rewardsToken not a contract");
    stakedToken = SeedToken(stakedToken_);
    rewardsToken = WeedToken(rewardsToken_);
  }

  function _authorizeUpgrade(address newImplementation) internal virtual override onlyOwner {}

  function initPool(
    uint32 rewardsFactor_,
    uint32 decayInterval_,
    uint16 decayFactor_,
    uint32 swapFactor_,
    uint32 stakeFactor_,
    uint16 taxPoints_,
    uint16 burnRatio_,
    uint8 coolDownDays_
  ) external onlyOwner {
    require(conf.status == 0, "WeedPool: already initiated");
    conf = Conf({
    rewardsFactor: rewardsFactor_,
    decayInterval: decayInterval_,
    decayFactor: decayFactor_,
    maximumLockupTime: 365,
    poolInitAt: uint32(block.timestamp),
    lastRatioUpdateAt: uint32(block.timestamp),
    swapFactor: swapFactor_,
    stakeFactor: stakeFactor_,
    taxPoints: taxPoints_,
    burnRatio: burnRatio_,
    priceRatio: 10000,
    coolDownDays: coolDownDays_,
    status: 1
    });
//    emit PoolInitiatedOrUpdated(
//      rewardsFactor_,
//      decayInterval_,
//      decayFactor_,
//      swapFactor_,
//      stakeFactor_,
//      taxPoints_,
//      burnRatio_,
//      coolDownDays_
//    );
  }

  // put to zero any parameter that remains the same
  function updateConf(
    uint32 decayInterval_,
    uint16 decayFactor_,
    uint32 swapFactor_,
    uint32 stakeFactor_,
    uint16 taxPoints_,
    uint16 burnRatio_,
    uint8 coolDownDays_
  ) external onlyOwner {
    require(conf.status == 1, "WeedPool: not active");
    if (decayInterval_ > 0) {
      conf.decayInterval = decayInterval_;
    }
    if (decayFactor_ > 0) {
      conf.decayFactor = decayFactor_;
    }
    if (swapFactor_ > 0) {
      conf.swapFactor = swapFactor_;
    }
    if (stakeFactor_ > 0) {
      conf.stakeFactor = stakeFactor_;
    }
    if (taxPoints_ > 0) {
      conf.taxPoints = taxPoints_;
    }
    if (burnRatio_ > 0) {
      conf.burnRatio = burnRatio_;
    }
    if (coolDownDays_ > 0) {
      conf.coolDownDays = coolDownDays_;
    }
//    emit PoolInitiatedOrUpdated(
//      0,
//      decayInterval_,
//      decayFactor_,
//      swapFactor_,
//      stakeFactor_,
//      taxPoints_,
//      burnRatio_,
//      coolDownDays_
//    );
  }

  // put to zero any parameter that remains the same
  function updatePriceRatio(uint32 priceRatio_) external {
    require(conf.status == 1, "WeedPool: not active");
    require(oracle != address(0) && _msgSender() == oracle, "WeedPool: not the oracle");
    if (priceRatio_ > 0) {
      conf.priceRatio = priceRatio_;
    }
//    emit PriceRatioUpdated(priceRatio_);
  }

  // put to zero any parameter that remains the same
  function updateOracle(address oracle_) external onlyOwner {
    require(oracle_ != address(0), "WeedPool: not a valid address");
    oracle = oracle_;
  }

  function pausePool(bool paused) external onlyOwner {
    conf.status = paused ? 2 : 1;
//    emit PoolPaused(paused);
  }

  function _updateLastRatioUpdateAt() internal {
    conf.lastRatioUpdateAt = uint32(block.timestamp);
  }

  function shouldUpdateRatio() public view returns (bool) {
    return
    block.timestamp.sub(conf.poolInitAt).div(conf.decayInterval) >
    uint256(conf.lastRatioUpdateAt).sub(conf.poolInitAt).div(conf.decayInterval);
  }

  /**
   * @param deposit The deposit
   * @return the time it will be locked
   */
  function getLockupTime(Deposit memory deposit) public view returns (uint256) {
    return uint256(deposit.lockedUntil).sub(deposit.lockedFrom);
  }

  function updateRatio() public {
    if (shouldUpdateRatio()) {
      uint256 count = block.timestamp.sub(conf.poolInitAt).div(conf.decayInterval) -
      uint256(conf.lastRatioUpdateAt).sub(conf.poolInitAt).div(conf.decayInterval);
      uint256 ratio = uint256(conf.rewardsFactor);
      for (uint256 i = 0; i < count; i++) {
        ratio = ratio.mul(conf.decayFactor).div(10000);
      }
      conf.rewardsFactor = uint32(ratio);
      conf.lastRatioUpdateAt = uint32(block.timestamp);
    }
  }

  /**
   * @param deposit The deposit
   * @return the weighted yield
   */
  function yieldWeight(Deposit memory deposit) public view returns (uint256) {
    return uint256(10000).add(getLockupTime(deposit).mul(10000).div(conf.maximumLockupTime).div(1 days));
  }

  /**
   * @param deposit The deposit
   * @param timestamp Current time of the stake
   * @return the Amount of untaxed reward
   */
  function calculateUntaxedRewards(Deposit memory deposit, uint256 timestamp) public view returns (uint256) {
    if (deposit.tokenAmount == 0 || deposit.tokenType == S_SYNR_SWAP) {
      return 0;
    }
    return
    multiplyByRewardablePeriod(
      uint256(deposit.tokenAmount).mul(deposit.rewardsFactor).mul(yieldWeight(deposit)).div(10000),
      deposit,
      timestamp
    );
  }

  function multiplyByRewardablePeriod(
    uint256 input,
    Deposit memory deposit,
    uint256 timestamp
  ) public view returns (uint256) {
    uint256 lockedUntil = uint256(deposit.lockedUntil);
    if (uint256(deposit.lastRewardsAt) > lockedUntil) {
      return 0;
    }
    uint256 when = lockedUntil > timestamp ? timestamp : lockedUntil;
    return input.mul(when.sub(deposit.lastRewardsAt)).div(365 days);
  }

  /**
   * @notice Calculates the tax for claiming reward
   * @param rewards The rewards of the stake
   */
  function calculateTaxOnRewards(uint256 rewards) public view returns (uint256) {
    return rewards.mul(conf.taxPoints).div(10000);
  }

  function collectRewards() public {
    _collectRewards(_msgSender());
  }

  /**
   * @notice The reward is collected and the tax is substracted
   * @param user_ The user collecting the reward
   */
  function _collectRewards(address user_) internal {
    User storage user = users[user_];
    uint256 rewards;
    for (uint256 i = 0; i < user.deposits.length; i++) {
      rewards += calculateUntaxedRewards(user.deposits[i], block.timestamp);
      user.deposits[i].lastRewardsAt = uint32(block.timestamp);
    }
    if (rewards > 0) {
      uint256 tax = calculateTaxOnRewards(rewards);
      rewardsToken.mint(user_, rewards.sub(tax));
      rewardsToken.mint(address(this), tax);
      taxes += tax;
      emit RewardsCollected(user_, rewards.sub(tax));
    }
  }

  /**
   * @param user_ The user collecting the reward
   * @param timestamp Current time of the stake
   * @return the pending rewards that have yet to be taxed
   */
  function untaxedPendingRewards(address user_, uint256 timestamp) external view returns (uint256) {
    User storage user = users[user_];
    uint256 rewards;
    for (uint256 i = 0; i < user.deposits.length; i++) {
      rewards += calculateUntaxedRewards(user.deposits[i], timestamp);
    }
    return rewards;
  }

  /**
   * @notice Searches for deposit from the user and its index
   * @param user address of user who made deposit being searched
   * @param index index of the deposit being searched
   * @return the deposit
   */
  function getDepositByIndex(address user, uint256 index) public view returns (Deposit memory) {
    require(users[user].deposits[index].tokenAmountOrID > 0, "WeedPool: deposit not found");
    return users[user].deposits[index];
  }

  /**
   * @param user address of user
   * @return the ammount of deposits a user has made
   */
  function getDepositsLength(address user) public view returns (uint256) {
    return users[user].deposits.length;
  }

  function _increaseTvl(uint256 tokenType, uint256 tokenAmount) internal {
    if (
      tokenType == TURF_STAKE
    ) {
      tvl.turfAmount++;
    } else if (
      tokenType == FARM_STAKE
    ) {
      tvl.farmAmount++;
    } else {
      tvl.stakedTokenAmount += uint128(tokenAmount);
    }
  }

  function _decreaseTvl(Deposit memory deposit) internal {
    if (
      deposit.tokenType == TURF_STAKE
    ) {
      tvl.turfAmount--;
    } else if (
      deposit.tokenType == FARM_STAKE
    ) {
      tvl.farmAmount--;
    } else {
      tvl.stakedTokenAmount -= uint128(deposit.tokenAmount);
    }
  }

  /**
   * @notice stakes if the pool is active
   * @param user_ address of user being updated
   * @param tokenType identifies the type of transaction being made
   * @param lockedFrom timestamp when locked
   * @param lockedUntil timestamp when can unstake without penalty
   * @param tokenAmountOrID ammount of tokens being staked, in the case where a SYNR Pass is being staked, it identified its ID
   * @param mainIndex index of deposit being updated
   */
  function _stake(
    address user_,
    uint256 tokenType,
    uint256 lockedFrom,
    uint256 lockedUntil,
    uint256 mainIndex,
    uint256 tokenAmountOrID
  ) internal virtual {
    require(conf.status == 1, "WeedPool: not initiated or paused");
    (, bool exists) = getDepositIndexByMainIndex(user_, mainIndex);
    require(!exists, "WeedPool: payload already used");
    updateRatio();
    _collectRewards(user_);
    uint256 tokenAmount;
    if (tokenType == TURF_STAKE) {
      users[user_].turfAmount++;
      turf.safeTransferFrom(user_, address(this), tokenAmountOrID);
    } else if (tokenType == FARM_STAKE) {
      users[user_].farmAmount++;
      farm.safeTransferFrom(user_, address(this), tokenAmountOrID);
    } else if (tokenType == SEED_SWAP) {
      tokenAmount = tokenAmountOrID;
      // WeedPool must be approve to spend SEED
      stakedToken.transferFrom(user_, address(this), tokenAmount);
      taxes += tokenAmount.sub(tokenAmount.mul(conf.burnRatio).div(10000));
      stakedToken.burn(tokenAmount.mul(conf.burnRatio).div(10000));
    } else {
      revert("WeedPool: invalid tokenType");
    }
    if (tokenAmount != 0) {
      users[user_].tokenAmount = uint128(uint256(users[user_].tokenAmount).add(tokenAmount));
    }
    _increaseTvl(tokenType, tokenAmount);
    // add deposit
    if (tokenType == SEED_SWAP) {
      lockedUntil = lockedFrom + uint256(conf.coolDownDays).mul(1 days);
    }
    uint256 index = users[user_].deposits.length;
    Deposit memory deposit = Deposit({
    tokenType: uint8(tokenType),
    lockedFrom: uint32(lockedFrom),
    lockedUntil: uint32(lockedUntil),
    tokenAmountOrID: uint96(tokenAmountOrID),
    unlockedAt: 0,
    mainIndex: uint16(mainIndex),
    tokenAmount: uint128(tokenAmount),
    lastRewardsAt: uint32(lockedFrom),
    rewardsFactor: conf.rewardsFactor
    });
    users[user_].deposits.push(deposit);
    emit DepositSaved(user_, uint16(index));
  }

  /**
   * @notice gets Percentage Vested at a certain timestamp
   * @param when timestamp where percentage will be calculated
   * @param lockedFrom timestamp when locked
   * @param lockedUntil timestamp when can unstake without penalty
   * @return the percentage vested
   */
  function getVestedPercentage(
    uint256 when,
    uint256 lockedFrom,
    uint256 lockedUntil
  ) public pure returns (uint256) {
    if (lockedUntil == 0) {
      return 10000;
    }
    uint256 lockupTime = lockedUntil.sub(lockedFrom);
    if (lockupTime == 0) {
      return 10000;
    }
    uint256 vestedTime = when.sub(lockedFrom);
    // 300 > 3%
    return vestedTime.mul(10000).div(lockupTime);
  }

  /**
   * @param user address of which trying to unstake
   * @param mainIndex the main index of the deposit
   */
  function canUnstakeWithoutTax(address user, uint256 mainIndex) external view returns (bool) {
    Deposit memory deposit = users[user].deposits[mainIndex];
    return deposit.lockedUntil > 0 && block.timestamp > uint256(deposit.lockedUntil);
  }

  /**
   * @notice Searches for deposit from the user and its index
   * @param user address of user who made deposit being searched
   * @param mainIndex index of the deposit being searched
   * @return the deposit
   */
  function getDepositIndexByMainIndex(address user, uint256 mainIndex) public view returns (uint256, bool) {
    for (uint256 i; i < users[user].deposits.length; i++) {
      if (uint256(users[user].deposits[i].mainIndex) == mainIndex && users[user].deposits[i].lockedFrom > 0) {
        return (i, true);
      }
    }
    return (0, false);
  }

  /**
   * @notice unstakes a deposit, calculates penalty for early unstake
   * @param tokenType identifies the type of transaction being made
   * @param lockedFrom timestamp when locked
   * @param lockedUntil timestamp when can unstake without penalty
   * @param mainIndex index of deposit
   * @param tokenAmountOrID ammount of tokens being staked, in the case where a SYNR Pass is being staked, it identified its ID
   */
  function _unstake(
    address user_,
    uint256 tokenType,
    uint256 lockedFrom,
    uint256 lockedUntil,
    uint256 mainIndex,
    uint256 tokenAmountOrID
  ) internal virtual {
    _collectRewards(user_);
    (uint256 index, bool exists) = getDepositIndexByMainIndex(user_, mainIndex);
    require(exists, "WeedPool: deposit not found");
    Deposit storage deposit = users[user_].deposits[index];
    require(
      uint256(deposit.tokenType) == tokenType &&
      uint256(deposit.lockedFrom) == lockedFrom &&
      uint256(deposit.lockedUntil) == lockedUntil &&
      uint256(deposit.tokenAmountOrID) == tokenAmountOrID,
      "WeedPool: inconsistent deposit"
    );
    if (tokenType == SEED_SWAP) {
      uint256 vestedPercentage = getVestedPercentage(
        block.timestamp,
        uint256(deposit.lockedFrom),
        uint256(deposit.lockedUntil)
      );
      uint256 unstakedAmount;
      if (vestedPercentage < 10000) {
        unstakedAmount = uint256(deposit.tokenAmount).mul(vestedPercentage).div(10000);
        penalties += uint256(deposit.tokenAmount).sub(unstakedAmount);
      } else {
        unstakedAmount = uint256(deposit.tokenAmount);
      }
      stakedToken.transfer(user_, unstakedAmount);
    } else if (tokenType == TURF_STAKE) {
      users[user_].turfAmount--;
      turf.safeTransferFrom(address(this), user_, uint256(deposit.tokenAmountOrID));
    } else if (tokenType == FARM_STAKE) {
      users[user_].farmAmount--;
      farm.safeTransferFrom(address(this), user_, uint256(deposit.tokenAmountOrID));
    } else {
      revert("WeedPool: invalid tokenType");
    }
    _decreaseTvl(deposit);
    deposit.unlockedAt = uint32(block.timestamp);
    emit DepositUnlocked(user_, uint16(index));
  }

  /**
   * @notice Withdraws penalties that has been collected as tax for un-staking early
   * @param amount amount of sSynr to be withdrawn
   * @param beneficiary address to which the withdrawn will go to
   * @param what what is available
   */
  function withdrawPenaltiesOrTaxes(
    uint256 amount,
    address beneficiary,
    uint256 what
  ) external virtual onlyOwner {
    uint256 available = what == 1 ? penalties : taxes;
    require(amount <= available, "WeedPool: amount not available");
    require(beneficiary != address(0), "WeedPool: beneficiary cannot be zero address");
    if (amount == 0) {
      amount = available;
    }
    if (what == 1) {
      penalties -= amount;
      stakedToken.transfer(beneficiary, amount);
    } else {
      taxes -= amount;
      rewardsToken.transfer(beneficiary, amount);
    }
  }

  /**
   * @notice calls _stake function
   * @param tokenType is the type of token
   * @param lockupTime time in days. For how many days the stake will be locked
   * @param tokenAmountOrID amount to be staked
   */
  function stake(
    uint256 tokenType,
    uint256 lockupTime,
    uint256 tokenAmountOrID
  ) external virtual {
    _stake(
      _msgSender(),
      tokenType,
      block.timestamp,
      block.timestamp.add(lockupTime * 1 days),
      type(uint16).max,
      tokenAmountOrID
    );
  }

  function _unstakeDeposit(Deposit memory deposit) internal {
    _unstake(
      _msgSender(),
      uint256(deposit.tokenType),
      uint256(deposit.lockedFrom),
      uint256(deposit.lockedUntil),
      uint256(deposit.mainIndex),
      uint256(deposit.tokenAmountOrID)
    );
  }

  // In SeedFarm you can unstake directly only turfs
  // Must be overridden in FarmingPool
  function unstake(uint256 depositIndex) external virtual {
    Deposit storage deposit = users[_msgSender()].deposits[depositIndex];
    _unstakeDeposit(deposit);
  }

  uint256[50] private __gap;
}
