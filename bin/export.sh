#!/usr/bin/env bash
# must be run from the root

npx hardhat compile

node scripts/exportABIs.js
cp export/ABIs.json ../syn-staking/src/config/seedABIs.json
cp export/deployed.json ../syn-staking/src/config/.
