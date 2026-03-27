# ⛵ Installation Guide

Vela를 설치하는 3가지 방법을 안내합니다.

## Prerequisites

- **Node.js 18** 이상 (TUI는 Node.js ≥20 필요)
- **Claude Code** (Claude Code hooks를 통해 동작)
- **Git** (git integration 사용 시)

---

## Option 1: npm Global Install (Recommended)

```bash
npm install -g vela-cli
```

설치 확인:

```bash
vela --version
# 0.1.0
```

## Option 2: npx (설치 없이 실행)

```bash
npx vela-cli init
npx vela-cli start "Add login page" --scale medium
```

## Option 3: curl (GitHub Releases)

```bash
curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/scripts/install.sh | sh
```

`--dry-run`으로 미리 확인:

```bash
curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/scripts/install.sh | sh -s -- --dry-run
```

환경 변수로 버전 지정:

```bash
VELA_VERSION=0.1.0 curl -fsSL ... | sh
```

---

## Project Setup

설치 후 프로젝트에서 초기화합니다:

```bash
cd your-project
vela init
```

`vela init`이 수행하는 작업:

| 항목 | 설명 |
|------|------|
| `.vela/hooks/` | 2개 enforcement hook 복사 (vela-gate.cjs, tracker.cjs) + shared/ |
| `.vela/agents/` | 25개 agent prompt 파일 복사 |
| `.vela/config.json` | 프로젝트 설정 파일 생성 |
| `.vela/state/` | SQLite DB, 파이프라인 상태 (gitignored) |
| `.claude/settings.local.json` | Claude Code hook 등록 (자동 생성) |

> **멱등성 보장** — `vela init`을 여러 번 실행해도 안전합니다. 이미 초기화된 프로젝트에서도 hook과 agent 파일을 업데이트합니다.

---

## Verify Installation

```bash
# 1. 버전 확인
vela --version

# 2. 프로젝트 초기화 확인
ls .vela/hooks/        # 2개 hook 파일 + shared/
ls .vela/agents/       # 25개 agent prompt

# 3. Claude Code hook 등록 확인
cat .claude/settings.local.json | grep "vela-gate"
```

---

## Update

```bash
# npm
npm update -g vela-cli

# 프로젝트 내 hook/agent 업데이트
vela init   # 새 파일만 추가, 기존 파일 유지
```

---

## Uninstall

```bash
# npm 글로벌 제거
npm uninstall -g vela-cli

# 프로젝트에서 Vela 제거
rm -rf .vela/
# .claude/settings.local.json에서 hook 등록 수동 제거
```

---

## Troubleshooting

### `vela: command not found`

npm 글로벌 bin 디렉토리가 PATH에 있는지 확인:

```bash
npm config get prefix
# 출력된 경로/bin 이 PATH에 포함되어야 합니다
export PATH="$(npm config get prefix)/bin:$PATH"
```

### Hook이 동작하지 않음

```bash
# .claude/settings.local.json에 hook이 등록되었는지 확인
cat .claude/settings.local.json | grep -A2 "PreToolUse"

# hook 파일이 존재하는지 확인
ls .vela/hooks/vela-gate.cjs .vela/hooks/tracker.cjs
```

### Node.js 버전 오류

```bash
node --version  # v18.0.0 이상 필요 (TUI는 v20.0.0 이상)
nvm install 18 && nvm use 18  # nvm 사용 시
```
