#!/usr/bin/env bash
set -euo pipefail

# Vela CLI — Release packaging script
# Builds the project, creates an npm tarball, and generates a SHA256 checksum.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "==> Building project..."
npm run build

echo "==> Packing tarball..."
npm pack

# Find the generated tarball (handles version changes)
TARBALL=$(ls -1t vela-cli-*.tgz 2>/dev/null | head -1)

if [ -z "$TARBALL" ]; then
  echo "ERROR: No tarball produced by npm pack" >&2
  exit 1
fi

echo "==> Generating SHA256 checksum..."
shasum -a 256 "$TARBALL" > "${TARBALL}.sha256"

# Print summary
SIZE=$(wc -c < "$TARBALL" | tr -d ' ')
SIZE_KB=$((SIZE / 1024))
CHECKSUM=$(cut -d ' ' -f1 "${TARBALL}.sha256")

echo ""
echo "Release artifact ready:"
echo "  File:     $TARBALL"
echo "  Size:     ${SIZE_KB}KB ($SIZE bytes)"
echo "  SHA256:   $CHECKSUM"
echo "  Checksum: ${TARBALL}.sha256"
