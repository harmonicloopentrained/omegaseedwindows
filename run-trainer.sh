#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
MODE="${MODE:-learn80}"
CYCLES="${CYCLES:-500}"
RAM_MB="${RAM_MB:-2048}"
PAGE_SIZE="${PAGE_SIZE:-96}"
INPUT="${INPUT:-saves/omegaseed_save_epoch_89229.json}"
OUT="${OUT:-runs/linux_${MODE}_$(date +%Y%m%d_%H%M%S)}"
node tools/train-node.js --mode "$MODE" --cycles "$CYCLES" --ram-mb "$RAM_MB" --page-size "$PAGE_SIZE" --input "$INPUT" --out "$OUT"
