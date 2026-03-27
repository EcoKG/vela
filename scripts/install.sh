#!/bin/sh
# Vela CLI — curl-pipe-sh install script
# Usage: curl -fsSL https://raw.githubusercontent.com/starlyn/vela-cli/main/scripts/install.sh | sh
# Supports: --dry-run, VELA_REPO env override, VELA_VERSION env override
set -eu

# ---------------------------------------------------------------------------
# Configuration (override via env)
# ---------------------------------------------------------------------------
VELA_REPO="${VELA_REPO:-starlyn/vela-cli}"
VELA_VERSION="${VELA_VERSION:-0.1.0}"
TARBALL_NAME="vela-cli-${VELA_VERSION}.tgz"
DOWNLOAD_URL="https://github.com/${VELA_REPO}/releases/download/v${VELA_VERSION}/${TARBALL_NAME}"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      printf "Usage: install.sh [--dry-run] [--help]\n"
      printf "  --dry-run  Show actions without executing\n"
      printf "  --help     Show this message\n"
      exit 0
      ;;
    *)
      printf "Unknown option: %s\n" "$arg" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Color helpers (with non-color fallback)
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || printf '0')" -ge 8 ]; then
  GREEN=$(tput setaf 2)
  RED=$(tput setaf 1)
  CYAN=$(tput setaf 6)
  BOLD=$(tput bold)
  RESET=$(tput sgr0)
else
  GREEN=""
  RED=""
  CYAN=""
  BOLD=""
  RESET=""
fi

info()  { printf "%s✓ %s%s\n" "$GREEN" "$1" "$RESET"; }
error() { printf "%s✗ %s%s\n" "$RED"   "$1" "$RESET" >&2; }
step()  { printf "%s→ %s%s\n" "$CYAN"  "$1" "$RESET"; }

# ---------------------------------------------------------------------------
# Dry-run wrapper — prints instead of executing when DRY_RUN=1
# ---------------------------------------------------------------------------
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "[DRY RUN] %s\n" "$*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
check_prereqs() {
  step "Checking prerequisites..."

  # Check curl
  if ! command -v curl >/dev/null 2>&1; then
    error "curl is not installed. Please install curl and try again."
    exit 1
  fi
  info "curl found"

  # Check node
  if ! command -v node >/dev/null 2>&1; then
    error "Node.js is not installed. Please install Node.js >= 22 and try again."
    exit 1
  fi

  NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 22 ]; then
    error "Node.js >= 22 required (found v$(node -v | sed 's/^v//')). Please upgrade."
    exit 1
  fi
  info "Node.js v$(node -v | sed 's/^v//') found (>= 22 required)"

  # Check npm
  if ! command -v npm >/dev/null 2>&1; then
    error "npm is not installed. Please install npm and try again."
    exit 1
  fi
  info "npm v$(npm -v) found"
}

# ---------------------------------------------------------------------------
# Main install flow
# ---------------------------------------------------------------------------
main() {
  printf "%s%sVela CLI Installer%s\n" "$BOLD" "$CYAN" "$RESET"
  printf "Version: %s | Repo: %s\n\n" "$VELA_VERSION" "$VELA_REPO"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf "[DRY RUN] No changes will be made.\n\n"
  fi

  check_prereqs

  # Download tarball
  step "Downloading ${TARBALL_NAME}..."
  run curl -fsSL -o "$TARBALL_NAME" "$DOWNLOAD_URL"
  if [ "$DRY_RUN" -eq 0 ]; then
    info "Downloaded ${TARBALL_NAME}"
  fi

  # Install globally via npm
  step "Installing vela-cli globally..."
  run npm install -g "./${TARBALL_NAME}"
  if [ "$DRY_RUN" -eq 0 ]; then
    info "Installed vela-cli globally"
  fi

  # Verify installation
  step "Verifying installation..."
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "[DRY RUN] vela --version\n"
  else
    INSTALLED_VERSION=$(vela --version 2>/dev/null || true)
    if [ -z "$INSTALLED_VERSION" ]; then
      error "vela command not found after install. Check that npm global bin is in PATH."
      rm -f "$TARBALL_NAME"
      exit 1
    fi
    info "vela --version: ${INSTALLED_VERSION}"
  fi

  # Cleanup
  step "Cleaning up..."
  run rm -f "$TARBALL_NAME"
  if [ "$DRY_RUN" -eq 0 ]; then
    info "Removed ${TARBALL_NAME}"
  fi

  printf "\n%s%sDone!%s Vela CLI v%s is ready.\n" "$BOLD" "$GREEN" "$RESET" "$VELA_VERSION"
  printf "Run %svela --help%s to get started.\n" "$BOLD" "$RESET"
}

main "$@"
