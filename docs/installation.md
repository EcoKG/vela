# 📦 Installation Guide

Vela CLI 설치 방법과 프로젝트 초기 설정을 안내합니다.

---

## 요구사항

- **Node.js** ≥ 18 (TUI 기능: ≥ 20)
- **npm** (Node.js에 포함)
- **Git** (선택 — git 통합 기능 사용 시)

---

## 설치

### npm (권장)

```bash
npm install -g vela-cli
```

### curl one-liner

```bash
curl -fsSL https://raw.githubusercontent.com/EcoKG/vela/main/scripts/install.sh | sh
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

`vela chat`을 사용하려면 Anthropic API 키가 필요합니다.

### 방법 1: 환경변수 (간단)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 방법 2: 프로필 저장 (영구)

```bash
vela auth add default
# API 키 입력 프롬프트 표시
# ~/.vela/auth.json에 저장됨
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
2. Hook 파일 복사 (`vela-gate.cjs`, `tracker.cjs`)
3. 에이전트 프롬프트 복사 (25개 MD 파일)
4. `config.json` 생성
5. `.claude/settings.local.json`에 hook 자동 등록

> 이후 Claude Code에서 작업하면 Vela 거버넌스가 자동 적용됩니다.

---

## 빠른 시작

### 독립 에이전트 (vela chat)

```bash
# 인증 후 바로 사용
vela chat

# 모델/예산/라우팅 옵션
vela chat --model opus --budget 10 --auto-route
```

### 거버넌스 파이프라인

```bash
# 프로젝트에서
vela init
vela start "기능 추가" --scale large
```

---

## 트러블슈팅

### `vela` 명령을 찾을 수 없음

npm global bin이 PATH에 포함되어 있는지 확인:

```bash
npm config get prefix
# 출력 경로/bin이 PATH에 있어야 함
```

### API 키 오류

```bash
vela auth status
# 현재 인증 상태 확인

# 환경변수로 직접 설정
export ANTHROPIC_API_KEY=sk-ant-...
```

### TUI가 깨져 보임

Node.js ≥ 20이 필요합니다:

```bash
node --version
# v20.0.0 이상 필요
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

---

## 업데이트

```bash
npm update -g vela-cli
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
