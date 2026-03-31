#!/usr/bin/env bash
set -euo pipefail

# Deploy CF Worker (not Pages — this is a Worker project)
npx wrangler deploy
