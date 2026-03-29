#!/bin/sh
# Vela CLI — curl-pipe-sh install script
# Usage: curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/scripts/install.sh | sh
# Supports: --dry-run, --version <ver>, VELA_REPO env override
set -eu

# ---------------------------------------------------------------------------
# Configuration (override via env or --version flag)
# ---------------------------------------------------------------------------
VELA_REPO="${VELA_REPO:-EcoKG/vela}"
VELA_VERSION="${VELA_VERSION:-0.3.0}"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
DRY_RUN=0
SKIP_NEXT=0
for arg in "$@"; do
  if [ "$SKIP_NEXT" -eq 1 ]; then
    SKIP_NEXT=0
    continue
  fi
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --version)
      SKIP_NEXT=1
      ;;
    --help|-h)
      printf "Usage: install.sh [--dry-run] [--version <ver>] [--help]\n"
      printf "  --dry-run        Show actions without executing\n"
      printf "  --version <ver>  Install specific version (default: %s)\n" "$VELA_VERSION"
      printf "  --help           Show this message\n"
      printf "\nEnvironment:\n"
      printf "  VELA_REPO     GitHub repo (default: EcoKG/vela)\n"
      printf "  VELA_VERSION  Version to install (overridden by --version flag)\n"
      exit 0
      ;;
    *)
      printf 'Error: unknown argument: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

# Parse --version <value> (two-arg form)
i=1
while [ "$i" -le "$#" ]; do
  eval "arg=\${$i}"
  if [ "$arg" = "--version" ]; then
    next=$((i + 1))
    if [ "$next" -le "$#" ]; then
      eval "VELA_VERSION=\${$next}"
    else
      printf "Error: --version requires a value\n" >&2
      exit 1
    fi
  fi
  i=$((i + 1))
done

TARBALL_NAME="vela-cli-${VELA_VERSION}.tgz"
CHECKSUM_NAME="${TARBALL_NAME}.sha256"
DOWNLOAD_URL="https://github.com/${VELA_REPO}/releases/download/v${VELA_VERSION}/${TARBALL_NAME}"
CHECKSUM_URL="https://github.com/${VELA_REPO}/releases/download/v${VELA_VERSION}/${CHECKSUM_NAME}"

# ---------------------------------------------------------------------------
# Color helpers (with non-color fallback)
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || printf '0')" -ge 8 ]; then
  GREEN=$(tput setaf 2)
  RED=$(tput setaf 1)
  CYAN=$(tput setaf 6)
  YELLOW=$(tput setaf 3)
  BOLD=$(tput bold)
  RESET=$(tput sgr0)
else
  GREEN=""
  RED=""
  CYAN=""
  YELLOW=""
  BOLD=""
  RESET=""
fi

info()  { printf "%s✓ %s%s\n" "$GREEN"  "$1" "$RESET"; }
warn()  { printf "%s⚠ %s%s\n" "$YELLOW" "$1" "$RESET"; }
error() { printf "%s✗ %s%s\n" "$RED"    "$1" "$RESET" >&2; }
step()  { printf "%s→ %s%s\n" "$CYAN"   "$1" "$RESET"; }

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

  # Check curl or wget
  if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
    info "curl found"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
    info "wget found (curl not available, using wget)"
  else
    error "Neither curl nor wget is installed. Please install one and try again."
    exit 1
  fi

  # Check node
  if ! command -v node >/dev/null 2>&1; then
    error "Node.js is not installed. Please install Node.js >= 18 and try again."
    printf "\n  Install Node.js: https://nodejs.org/\n"
    printf "  Or via nvm:      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash\n"
    printf "                   nvm install 22\n\n"
    exit 1
  fi

  NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    error "Node.js >= 18 required (found v$(node -v | sed 's/^v//')). Please upgrade."
    exit 1
  fi
  info "Node.js v$(node -v | sed 's/^v//') found (>= 18 required)"

  # Check npm
  if ! command -v npm >/dev/null 2>&1; then
    error "npm is not installed. Please install npm and try again."
    exit 1
  fi
  info "npm v$(npm -v) found"
}

# ---------------------------------------------------------------------------
# Download helper — works with curl or wget
# ---------------------------------------------------------------------------
download() {
  url="$1"
  output="$2"
  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL -o "$output" "$url"
  else
    wget -q -O "$output" "$url"
  fi
}

# ---------------------------------------------------------------------------
# SHA256 verification
# ---------------------------------------------------------------------------
verify_checksum() {
  tarball="$1"
  checksum_file="$2"

  expected=$(cut -d ' ' -f1 "$checksum_file")

  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tarball" | cut -d ' ' -f1)
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$tarball" | cut -d ' ' -f1)
  else
    warn "Neither sha256sum nor shasum found — skipping checksum verification"
    return 0
  fi

  if [ "$actual" = "$expected" ]; then
    info "SHA256 checksum verified"
    return 0
  else
    error "SHA256 mismatch!"
    printf "  Expected: %s\n" "$expected" >&2
    printf "  Actual:   %s\n" "$actual" >&2
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Main install flow
# ---------------------------------------------------------------------------
main() {
  printf "\n%s%s⛵ Vela CLI Installer%s\n" "$BOLD" "$CYAN" "$RESET"
  printf "Version: %s | Repo: %s\n\n" "$VELA_VERSION" "$VELA_REPO"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf "[DRY RUN] No changes will be made.\n\n"
  fi

  check_prereqs

  # Create temp directory for clean install
  TMPDIR_INSTALL=$(mktemp -d 2>/dev/null || mktemp -d -t 'vela-install')
  trap 'rm -rf "$TMPDIR_INSTALL"' EXIT

  # Download tarball
  step "Downloading ${TARBALL_NAME} from GitHub Releases..."
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "[DRY RUN] download %s → %s/%s\n" "$DOWNLOAD_URL" "$TMPDIR_INSTALL" "$TARBALL_NAME"
  else
    if ! download "$DOWNLOAD_URL" "$TMPDIR_INSTALL/$TARBALL_NAME"; then
      error "Failed to download ${TARBALL_NAME}"
      printf "\n  Check that version v%s exists at:\n" "$VELA_VERSION"
      printf "  https://github.com/%s/releases/tag/v%s\n\n" "$VELA_REPO" "$VELA_VERSION"
      exit 1
    fi
    info "Downloaded ${TARBALL_NAME} ($(wc -c < "$TMPDIR_INSTALL/$TARBALL_NAME" | tr -d ' ') bytes)"
  fi

  # Download and verify checksum
  step "Verifying SHA256 checksum..."
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "[DRY RUN] download %s\n" "$CHECKSUM_URL"
    printf "[DRY RUN] verify checksum\n"
  else
    if download "$CHECKSUM_URL" "$TMPDIR_INSTALL/$CHECKSUM_NAME" 2>/dev/null; then
      if ! verify_checksum "$TMPDIR_INSTALL/$TARBALL_NAME" "$TMPDIR_INSTALL/$CHECKSUM_NAME"; then
        error "Checksum verification failed. The download may be corrupted."
        exit 1
      fi
    else
      warn "Checksum file not available — skipping verification"
    fi
  fi

  # Install globally via npm
  step "Installing vela-cli globally via npm..."
  run npm install -g "$TMPDIR_INSTALL/$TARBALL_NAME"
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
      error "vela command not found after install."
      printf "\n  npm global bin directory may not be in your PATH.\n"
      printf "  Try adding this to your shell profile:\n\n"
      NPM_PREFIX=$(npm config get prefix 2>/dev/null || echo "/usr/local")
      printf "    export PATH=\"%s/bin:\$PATH\"\n\n" "$NPM_PREFIX"
      exit 1
    fi
    info "vela --version: ${INSTALLED_VERSION}"
  fi

  # Success
  printf "\n%s%s✓ Done!%s Vela CLI v%s is installed.\n\n" "$BOLD" "$GREEN" "$RESET" "$VELA_VERSION"
  printf "  %sGet started:%s\n" "$BOLD" "$RESET"
  printf "    vela chat                  # Start chatting with Claude\n"
  printf "    vela chat --model opus     # Use a specific model\n"
  printf "    vela chat --budget 5       # Set \$5 budget limit\n"
  printf "    vela init                  # Initialize governance in a project\n"
  printf "    vela --help                # See all commands\n\n"
  printf "  %sAuthentication:%s\n" "$BOLD" "$RESET"
  printf "    export ANTHROPIC_API_KEY=sk-ant-...   # Set API key\n"
  printf "    vela auth add default                 # Or save a profile\n\n"
}

main "$@"
