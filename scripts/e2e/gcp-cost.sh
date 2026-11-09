#!/usr/bin/env bash
# ─── gcp-cost - estimate what the test project has spent and is spending ───
# Project ddv-node-test-5821 only (never the other GCP project). Prices are on-demand list prices
# (us-central1, USD, Oct 2026) and stopped VMs are counted as running since creation, so
# the total is an upper bound. Real numbers: the Cloud console Billing page.
#   bash scripts/e2e/gcp-cost.sh            # table + totals
#   bash scripts/e2e/gcp-cost.sh --log      # also append a snapshot to memory/gcp-usage.md
set -euo pipefail
export CLOUDSDK_PYTHON="${CLOUDSDK_PYTHON:-/c/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe}"
ACC=$(gcloud auth list --format='value(account)' 2>/dev/null | grep @gmail.com | head -1)
[ -n "$ACC" ] || { echo "gcp-cost: no personal gcloud login found" >&2; exit 1; }
P=ddv-node-test-5821
here="$(cd "$(dirname "$0")/../.." && pwd)"

rows=$(gcloud compute instances list --account "$ACC" --project "$P" \
  --format='csv[no-heading](name,zone.basename(),machineType.basename(),status,creationTimestamp,disks[0].licenses[0].basename())')
disk_gb=$(gcloud compute disks list --account "$ACC" --project "$P" --format='csv[no-heading](sizeGb,type.basename())' |
  awk -F, '{ if ($2=="pd-standard") s+=$1*0.04; else s+=$1*0.10 } END { printf "%.2f", s }')

out=$(echo "$rows" | awk -F, -v now="$(date -u +%s)" '
  BEGIN { c["e2-micro"]=0.0084; c["e2-small"]=0.0168; c["e2-medium"]=0.0335; c["e2-standard-2"]=0.0670;
          c["e2-standard-4"]=0.1340; c["e2-standard-8"]=0.2681; v["e2-micro"]=1; v["e2-small"]=1; v["e2-medium"]=1;
          v["e2-standard-2"]=2; v["e2-standard-4"]=4; v["e2-standard-8"]=8 }
  NF {
    rate = c[$3]; if (rate == "") rate = 0.15
    if ($6 ~ /windows/) rate += 0.046 * v[$3]            # Windows Server licence per vCPU
    if (index($2, "asia") == 1) rate *= 1.2               # rough regional uplift
    cmd = "date -u -d \"" $5 "\" +%s"; cmd | getline t; close(cmd)
    h = (now - t) / 3600; spent = (($4 == "RUNNING") ? rate : 0) * h
    owner = ($1 ~ /^ddv-/) ? "#31" : ($1 ~ /^bw28-/) ? "#28" : ($1 ~ /^snt-/) ? "#1b" : "?"
    printf "%-20s %-4s %-14s %-9s %6.1fh  $%.3f/h  ~$%.2f\n", $1, owner, $3, $4, h, (($4 == "RUNNING") ? rate : 0), spent
    tot += spent; burn += ($4 == "RUNNING") ? rate : 0
  }
  END { printf "TOTAL compute ~$%.2f so far, burn $%.2f/h ($%.0f/day)\n", tot, burn, burn * 24 }')
echo "$out"
echo "disks: ~\$$disk_gb/month"

if [ "${1:-}" = "--log" ]; then
  f="$here/memory/gcp-usage.md"
  [ -f "$f" ] || printf '# GCP usage log (project ddv-node-test-5821)\n\nSnapshots from `scripts/e2e/gcp-cost.sh --log`. Upper-bound estimates from list prices; the Billing page is the truth. Owner budget: ~$100 credit left on 2026-10-21; keep total burn low and delete idle VMs.\n' > "$f"
  { printf '\n## %s\n```\n%s\ndisks: ~$%s/month\n```\n' "$(date -u +'%Y-%m-%d %H:%M UTC')" "$out" "$disk_gb"; } >> "$f"
  echo "logged to $f"
fi
