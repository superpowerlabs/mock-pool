#!/usr/bin/env bash
# must be run from the root

MAIN_NETWORK=localhost
SIDE_NETWORK=localhost

if [[ "$1" == "testnet" ]]; then
MAIN_NETWORK=goerli
SIDE_NETWORK=bsc_testnet
fi

if [[ "$1" == "mainnet" ]]; then
MAIN_NETWORK=ethereum
SIDE_NETWORK=bsc
fi

echo "Deploying pools to $MAIN_NETWORK and $SIDE_NETWORK..."

npx hardhat run scripts/deploy-maint.js --network $MAIN_NETWORK

npx hardhat run scripts/deploy-sidet.js --network $SIDE_NETWORK

npx hardhat run scripts/deploy-wormhole2.js --network $MAIN_NETWORK
npx hardhat run scripts/deploy-wormhole2.js --network $SIDE_NETWORK

