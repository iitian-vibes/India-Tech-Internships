#!/usr/bin/env bash
# Idempotent label setup for this repo. Safe to re-run any time (e.g. after labels are accidentally deleted);
# `--force` means it edits the colour/description if the label already exists instead of failing.
#
#   ./scripts/setup-labels.sh
#
set -euo pipefail
REPO="iitian-vibes/India-Tech-Internships"

gh label create submission     --repo "$REPO" --color 1D76DB --description "A student-submitted internship" --force
gh label create checks-passed  --repo "$REPO" --color 0E8A16 --description "Automatic checks passed" --force
gh label create needs-fix      --repo "$REPO" --color D93F0B --description "Automatic checks failed, needs edit" --force
gh label create verified       --repo "$REPO" --color 5319E7 --description "Hand-verified by a maintainer" --force
gh label create approved       --repo "$REPO" --color 0E8A16 --description "Approved; triggers adding it to the list" --force
gh label create health         --repo "$REPO" --color B60205 --description "Daily update problems" --force

echo "Labels set up on $REPO."
