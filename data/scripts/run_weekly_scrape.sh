#!/usr/bin/env bash
# Weekly NoBroker scrape — wipes old listings, then re-scrapes all localities.
# Scheduled via macOS launchd (see: data/scripts/com.blr-explorer.weekly-scrape.plist)
# To run manually:  bash data/scripts/run_weekly_scrape.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="$REPO_DIR/.venv/bin/python"
SCRIPT="$REPO_DIR/data/scripts/scrape_listings.py"
LOG_DIR="$REPO_DIR/data/logs"

mkdir -p "$LOG_DIR"
LOGFILE="$LOG_DIR/scrape_$(date +%Y-%m-%d).log"

echo "=== Weekly scrape started $(date) ===" | tee -a "$LOGFILE"
cd "$REPO_DIR"
PYTHONUNBUFFERED=1 "$VENV" "$SCRIPT" --wipe 2>&1 | tee -a "$LOGFILE"
echo "=== Done $(date) ===" | tee -a "$LOGFILE"

# Keep only last 8 logs (8 weeks)
ls -t "$LOG_DIR"/scrape_*.log 2>/dev/null | tail -n +9 | xargs rm -f
