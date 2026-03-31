#!/usr/bin/env bash
set -euo pipefail
npx wrangler pages deploy . --project-name=tycho-tools --branch=main
