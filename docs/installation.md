# 📦 Installation Guide

Vela CLI 설치 방법과 프로젝트 초기 설정을 안내합니다.

---

## 요구사항

- **Node.js** ≥ 18 (TUI 기능: ≥ 20)
- **npm** (Node.js에 포함)
- **Git** (선택 — git 통합 기능 사용 시)

---

## 설치

### curl one-liner (권장)

```bash
curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/scripts/install.sh | sh
```

특정 버전 설치:

```bash
curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/scripts/install.sh | sh -s -- --version 0.2.1
```

설치 스크립트는 다음을 자동으로 수행합니다:
1. Node.js/npm 버전 확인
2. GitHub Releases에서 tarball 다운로드
3. SHA256 체크섬 검증
4. `npm install -g` 실행
5. `vela --version` 설치 확인

### npm (GitHub Releases에서 직접)

```bash
npm install -g https://github.com/EcoKG/vela/releases/download/v0.2.1/vela-cli-0.2.1.tgz
```

### 소스에서 빌드

```bash
git clone https://github.com/EcoKG/vela.git
cd vela
npm install
npm run build
npm link
```

---

## 인증 설정

`vela chat`은 **Dual Provider**를 지원합니다. API 키가 없어도 Claude Code CLI가 설치되어 있으면 자동으로 사용합니다.

### Provider 우선순위

| 우선순위 | Provider | 조건 |
|----------|----------|------|
| 1 | **API** (Anthropic SDK 직접 통신) | `ANTHROPIC_API_KEY` 또는 `~/.vela/auth.json` |
| 2 | **CLI** (Claude Code CLI 위임) | `claude --version` 성공 |
| 3 | **Error** | 둘 다 없으면 안내 메시지 |

### 방법 1: API 키 — 환경변수 (간단)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

셸 프로필에 영구 추가:

```bash
echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.bashrc
source ~/.bashrc
```

### 방법 2: API 키 — 프로필 저장 (영구)

```bash
vela auth add default
# API 키 입력 프롬프트 표시
# ~/.vela/auth.json에 안전하게 저장됨
```

### 방법 3: Claude Code CLI (API 키 불필요)

Claude Code CLI가 이미 설치되어 있으면 별도 설정 없이 바로 사용 가능:

```bash
# Claude Code가 설치되어 있는지 확인
claude --version

# API 키 없이도 바로 사용
vela chat
```

### 인증 확인

```bash
vela auth status
```

---

## 프로젝트 초기화 (거버넌스 엔진)

Claude Code hooks 거버넌스를 사용하려면:

```bash
cd your-project
vela init
```

이 명령이 수행하는 작업:

1. `.vela/` 디렉토리 생성
2. Hook 파일 복사 (`vela-gate.cjs`, `tracker.cjs`, `shared/`)
3. 에이전트 프롬프트 복사 (25개 MD 파일)
4. `config.json` 생성
5. `.claude/settings.local.json`에 hook 자동 등록

```
your-project/
├── .vela/
│   ├── hooks/
│   │   ├── vela-gate.cjs       # PreToolUse — 20개 거버넌스 규칙
│   │   ├── tracker.cjs         # PostToolUse — 이벤트 기록
│   │   └── shared/
│   │       ├── constants.cjs
│   │       └── pipeline.cjs
│   ├── agents/                 # 25개 에이전트 프롬프트
│   ├── config.json
│   └── state/                  # (gitignored)
├── .claude/
│   └── settings.local.json     # Hook 등록 (자동 생성)
└── src/                        # 거버넌스로 보호되는 코드
```

> 이후 Claude Code에서 작업하면 Vela 거버넌스가 자동 적용됩니다.

---

## 빠른 시작

### 독립 에이전트 (vela chat)

```bash
# 인증 후 바로 사용
vela chat

# 옵션과 함께
vela chat --model opus --budget 10 --auto-route

# 한 번만 질문
vela chat -m "이 프로젝트의 구조를 설명해줘"
```

### 거버넌스 파이프라인

```bash
vela init
vela start "OAuth2 인증 추가" --scale large
```

---

## 업데이트

```bash
# curl 설치 스크립트로 재설치 (최신 버전 자동 감지)
curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/scripts/install.sh | sh

# 또는 npm으로 직접
npm install -g https://github.com/EcoKG/vela/releases/download/v0.2.1/vela-cli-0.2.1.tgz
```

---

## 제거

```bash
npm uninstall -g vela-cli
```

프로젝트에서 Vela 제거:

```bash
rm -rf .vela/
rm .claude/settings.local.json
```

---

## 트러블슈팅

### `vela` 명령을 찾을 수 없음

npm global bin이 PATH에 포함되어 있는지 확인:

```bash
# npm global prefix 확인
npm config get prefix

# 출력 경로/bin이 PATH에 있어야 함
# 예: /home/user/.nvm/versions/node/v22.22.1/bin
export PATH="$(npm config get prefix)/bin:$PATH"
```

### API 키 오류

```bash
# 현재 인증 상태 확인
vela auth status

# 환경변수로 직접 설정
export ANTHROPIC_API_KEY=sk-ant-...

# 또는 Claude Code CLI가 있으면 API 키 불필요
claude --version
```

### TUI가 깨져 보임

Node.js ≥ 20이 필요합니다:

```bash
node --version
# v20.0.0 이상이어야 함

# nvm 사용 시
nvm install 22
nvm use 22
```

### Hook이 동작하지 않음

```bash
# hook 파일 존재 확인
ls .vela/hooks/

# Claude Code 설정 확인
cat .claude/settings.local.json

# 재초기화
vela init
```

### native 모듈 빌드 실패 (better-sqlite3)

```bash
# Python과 빌드 도구가 필요합니다
# Ubuntu/Debian:
sudo apt install python3 build-essential

# macOS:
xcode-select --install

# npm rebuild
npm rebuild better-sqlite3
```
