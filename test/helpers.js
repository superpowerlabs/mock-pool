const {assert} = require("chai");
const {hexZeroPad} = require("@ethersproject/bytes");
const Helpers = {
  initEthers(ethers) {
    this.ethers = ethers;
  },

  async assertThrowsMessage(promise, message) {
    const notThrew = "It did not throw";
    try {
      await promise;
      throw new Error(notThrew);
    } catch (e) {
      const isTrue = e.message.indexOf(message) > -1;
      if (!isTrue) {
        console.error("Expected:", message);
        console.error("Received:", e.message);
        if (e.message !== notThrew) {
          console.error();
          console.error(e);
        }
      }
      assert.isTrue(isTrue);
    }
  },

  async getTimestamp() {
    return (await this.ethers.provider.getBlock()).timestamp;
  },

  async increaseBlockTimestampBy(offset) {
    await this.ethers.provider.send("evm_increaseTime", [offset]);
    await this.ethers.provider.send("evm_mine");
  },

  bytes32Address(address) {
    return hexZeroPad(address, 32);
  },

  mockEncodedVm(addr, payload) {
    addr = addr.substring(2);
    payload = hexZeroPad(this.ethers.BigNumber.from(payload).toHexString(), 32).substring(2);
    let vaaBytes = [];
    for (let k = 0; k < addr.length; k += 2) {
      vaaBytes.push(parseInt(addr.substring(k, k + 2), 16));
    }
    for (let k = 0; k < payload.length; k += 2) {
      vaaBytes.push(parseInt(payload.substring(k, k + 2), 16));
    }
    return new Int32Array(vaaBytes);
  },
};

Helpers.S_SYNR_SWAP = 1;
Helpers.SYNR_STAKE = 2;
Helpers.SYNR_PASS_STAKE_FOR_BOOST = 3;
Helpers.SYNR_PASS_STAKE_FOR_SEEDS = 4;
Helpers.BLUEPRINT_STAKE_FOR_BOOST = 5;
Helpers.BLUEPRINT_STAKE_FOR_SEEDS = 6;
Helpers.SEED_SWAP = 7;

module.exports = Helpers;
