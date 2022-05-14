const ethers = require("ethers");

const BN = ethers.BigNumber.from;
async function BNMulBy(param, num = 1, repeat = 0) {
  if (repeat) {
    return BN(param.toString()).mul(BN(num + "0".repeat(repeat)));
  }
  return BN(param.toString()).mul(num);
}

const DAY = 24 * 3600;
const WEEK = DAY * 7;
const YEAR = 365 * DAY;

const PayloadUtils = {
  async fromDepositToTransferPayload(deposit) {
    return BN(deposit.tokenType)
      .add(await BNMulBy(deposit.lockedFrom, 100))
      .add(await BNMulBy(deposit.lockedUntil, 1, 12))
      .add(await BNMulBy(deposit.mainIndex, 1, 22))
      .add(await BNMulBy(deposit.tokenAmountOrID, 1, 27));
  },

  async serializeInput(tokenType, lockupTime, tokenAmountOrID) {
    return BN(tokenType)
      .add(await BNMulBy(lockupTime, 100))
      .add(await BNMulBy(tokenAmountOrID, 1, 5));
  },

  calculateUntaxedRewards(deposit, timestamp) {
    if (deposit.tokenAmount === 0 || deposit.lastRewardsAt > deposit.lockedUntil) {
      return 0;
    }
    let when = deposit.lockedUntil > timestamp ? timestamp : deposit.lockedUntil;
    let lockupTime = BN(deposit.lockedUntil.toString()).sub(deposit.lockedFrom);
    let yieldWeight = BN("10000").add(lockupTime.mul(10000).div(365).div(DAY));
    return ethers.BigNumber.from(deposit.tokenAmount.toString())
      .mul(deposit.rewardsFactor)
      .mul(BN(when).sub(deposit.lastRewardsAt))
      .div(365 * DAY)
      .mul(yieldWeight)
      .div(10000);
  },
};

module.exports = PayloadUtils;

/*

function calculateUntaxedRewards(Deposit memory deposit, uint256 timestamp) public view override returns (uint256) {
    if (deposit.tokenAmount == 0) {
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
 */
