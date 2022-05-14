// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface ISyndicateERC20 {
  function safeTransferFrom(
    address _from,
    address _to,
    uint256 _value,
    bytes memory _data
  ) external;
}
