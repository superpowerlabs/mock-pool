// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface ISyntheticSyndicateERC20 {
  function balanceOf(address owner) external view returns (uint256);

  function approve(address spender, uint256 amount) external;

  function isOperatorInRole(address operator, uint256 required) external view returns (bool);

  function transferFrom(
    address to,
    address receiver,
    uint256 tokenId
  ) external;
}
