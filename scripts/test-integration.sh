#!/usr/bin/env bash
# scripts/test-integration.sh
# Orchestrates Docker-backed integration tests (D-04).
# Usage: bash scripts/test-integration.sh (invoked by npm run test:integration)
set -euo pipefail

cleanup() {
  echo "Tearing down Docker..."
  docker compose down --remove-orphans
}
trap cleanup EXIT

echo "Starting IMAP container..."
docker compose up -d

echo "Waiting for IMAP to be ready on port 143..."
timeout 60 bash -c 'until docker compose exec -T imap nc -z localhost 143 2>/dev/null; do sleep 1; done'

echo "Running integration tests..."
npx vitest run --config vitest.integration.config.ts

echo "Done."
