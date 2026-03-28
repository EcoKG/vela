#!/usr/bin/env bash
set -euo pipefail

# Vela CLI — Release packaging & publishing script
# Builds, packs, checksums, and optionally uploads to GitHub Releases.
#
# Usage:
#   ./scripts/release.sh              # Build + pack + checksum (local only)
#   ./scripts/release.sh --publish    # Build + pack + checksum + GitHub Release
#   ./scripts/release.sh --dry-run    # Show what would happen

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Parse flags
PUBLISH=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      echo "Usage: release.sh [--publish] [--dry-run] [--help]"
      echo "  --publish  Upload to GitHub Releases (requires gh CLI)"
      echo "  --dry-run  Show actions without executing"
      echo "  --help     Show this message"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

# Read version from package.json
VERSION=$(node -e "console.log(require('./package.json').version)")
TAG="v${VERSION}"
TARBALL="vela-cli-${VERSION}.tgz"
CHECKSUM="${TARBALL}.sha256"

echo "═══════════════════════════════════════════════════"
echo "  ⛵ Vela CLI Release — v${VERSION}"
echo "═══════════════════════════════════════════════════"
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[DRY RUN] No changes will be made."
  echo ""
fi

# ── Step 1: Clean build ──────────────────────────────────────
echo "==> Step 1: Clean build..."
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[DRY RUN] rm -rf dist && npm run build"
else
  rm -rf dist
  npm run build
  echo "    ✓ Build complete"
fi

# ── Step 2: Run tests ────────────────────────────────────────
echo "==> Step 2: Running tests..."
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[DRY RUN] npm test"
else
  npm test
  echo "    ✓ Tests passed"
fi

# ── Step 3: Verify CLI works ─────────────────────────────────
echo "==> Step 3: Verifying CLI..."
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[DRY RUN] node dist/cli.js --version"
else
  CLI_VERSION=$(node dist/cli.js --version)
  if [ "$CLI_VERSION" != "$VERSION" ]; then
    echo "ERROR: CLI version ($CLI_VERSION) doesn't match package.json ($VERSION)" >&2
    exit 1
  fi
  echo "    ✓ vela --version: ${CLI_VERSION}"
fi

# ── Step 4: Pack tarball ─────────────────────────────────────
echo "==> Step 4: Creating tarball..."
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[DRY RUN] npm pack"
else
  rm -f vela-cli-*.tgz vela-cli-*.tgz.sha256
  npm pack --quiet
  if [ ! -f "$TARBALL" ]; then
    echo "ERROR: Expected $TARBALL but not found" >&2
    exit 1
  fi
  echo "    ✓ Created ${TARBALL}"
fi

# ── Step 5: Generate checksum ────────────────────────────────
echo "==> Step 5: Generating SHA256 checksum..."
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[DRY RUN] shasum -a 256 ${TARBALL} > ${CHECKSUM}"
else
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$TARBALL" > "$CHECKSUM"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$TARBALL" > "$CHECKSUM"
  else
    echo "ERROR: Neither sha256sum nor shasum found" >&2
    exit 1
  fi
  echo "    ✓ Checksum: $(cut -d ' ' -f1 "$CHECKSUM")"
fi

# ── Step 6: Verify tarball installs correctly ────────────────
echo "==> Step 6: Verifying tarball installs..."
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[DRY RUN] npm install -g ./${TARBALL} && vela --version && npm uninstall -g vela-cli"
else
  # Install from tarball to verify it works
  INSTALL_TMP=$(mktemp -d)
  trap 'rm -rf "$INSTALL_TMP"' EXIT

  # Use npm --prefix to install in temp dir to avoid clobbering existing install
  npm install --prefix "$INSTALL_TMP" "./${TARBALL}" --quiet 2>/dev/null
  TEST_VERSION=$("$INSTALL_TMP/node_modules/.bin/vela" --version 2>/dev/null || echo "")
  if [ "$TEST_VERSION" = "$VERSION" ]; then
    echo "    ✓ Tarball installs and runs correctly (v${TEST_VERSION})"
  else
    echo "    ⚠ Warning: Could not verify tarball locally (got: '${TEST_VERSION}')"
  fi
  rm -rf "$INSTALL_TMP"
  trap - EXIT
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Release artifacts ready:"
SIZE=$(wc -c < "$TARBALL" 2>/dev/null | tr -d ' ' || echo "?")
SIZE_KB=$((SIZE / 1024))
echo "    File:     $TARBALL"
echo "    Size:     ${SIZE_KB}KB ($SIZE bytes)"
echo "    Checksum: $(cut -d ' ' -f1 "$CHECKSUM" 2>/dev/null || echo '?')"
echo "    Tag:      $TAG"
echo "═══════════════════════════════════════════════════"

# ── Step 7: Publish to GitHub Releases ───────────────────────
if [ "$PUBLISH" -eq 1 ]; then
  echo ""
  echo "==> Step 7: Publishing to GitHub Releases..."

  if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: gh (GitHub CLI) is required for --publish. Install: https://cli.github.com/" >&2
    exit 1
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[DRY RUN] git push origin main"
    echo "[DRY RUN] gh release create $TAG $TARBALL $CHECKSUM --title \"$TAG\" --generate-notes"
  else
    echo "    Pushing latest commits..."
    git push origin main

    # Check if release already exists
    if gh release view "$TAG" >/dev/null 2>&1; then
      echo "    Release $TAG already exists. Updating assets..."
      gh release upload "$TAG" "$TARBALL" "$CHECKSUM" --clobber
      echo "    ✓ Updated assets on existing release $TAG"
    else
      echo "    Creating release $TAG..."
      gh release create "$TAG" \
        "$TARBALL" "$CHECKSUM" \
        --title "$TAG — Vela CLI" \
        --generate-notes
      echo "    ✓ Published release $TAG"
    fi

    echo ""
    echo "  Install on any machine:"
    echo "    curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/scripts/install.sh | sh"
    echo ""
    echo "  Or directly:"
    echo "    npm install -g https://github.com/EcoKG/vela/releases/download/${TAG}/${TARBALL}"
    echo ""
  fi
else
  echo ""
  echo "  To publish: ./scripts/release.sh --publish"
  echo "  To install: npm install -g ./${TARBALL}"
  echo ""
fi
