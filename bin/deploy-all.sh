#!/usr/bin/env bash
# must be run from the root

MAIN_NETWORK=localhost
SIDE_NETWORK=localhost

if [[ "$1" == "testnet" ]]; then
MAIN_NETWORK=goerli
SIDE_NETWORK=bsc_testnet
elif [[ "$1" == "testnet2" ]]; then
MAIN_NETWORK=ropsten
SIDE_NETWORK=mumbai
elif [[ "$1" == "mainnet" ]]; then
MAIN_NETWORK=ethereum
SIDE_NETWORK=bsc
fi


echo "Deploying pools to $MAIN_NETWORK and $SIDE_NETWORK..."

npx hardhat run scripts/deploy-mainpool.js --network $MAIN_NETWORK
npx hardhat run scripts/deploy-maint.js --network $MAIN_NETWORK

if [[ "$2" == "tokens" ]]; then
  npx hardhat run scripts/deploy-coupons.js --network $SIDE_NETWORK
  npx hardhat run scripts/deploy-seed.js --network $SIDE_NETWORK
fi

npx hardhat run scripts/deploy-seedpool.js --network $SIDE_NETWORK
npx hardhat run scripts/deploy-sidet.js --network $SIDE_NETWORK

npx hardhat run scripts/deploy-wormhole2.js --network $MAIN_NETWORK
npx hardhat run scripts/deploy-wormhole2.js --network $SIDE_NETWORK

