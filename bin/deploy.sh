#!/usr/bin/env bash
# must be run from the root

npx hardhat compile

if [[ "$2" == "ropsten" ]]; then
# bin/deploy.sh pool localhost 360000000000000000000 91252 7120725 200
# 1080 is 30%, 990 is 27.5%
  SYN_PER_BLOCK=$3 BLOCK_PER_UPDATE=$4 THREE_YEARS_BLOCKS=$5 WEIGHT=$6 \
    npx hardhat run scripts/deploy-$1.js --network $2
elif [[ "$1" == "syn" || "$1" == "tokens" ]]; then
# bin/deploy.sh syn localhost 10000000000
  MAX_TOTAL_SUPPLY=$3 npx hardhat run scripts/deploy-$1.js --network $2
else
  npx hardhat run scripts/deploy-$1.js --network $2
fi
