# ⚙️ Configuration

Vela의 설정 파일과 커스터마이징 방법을 안내합니다.

---

## 설정 파일 위치

| 파일 | 위치 | 용도 |
|------|------|------|
| `.vela/config.json` | 프로젝트 루트 | 파이프라인 설정, 프로젝트별 옵션 |
| `~/.vela/auth.json` | 홈 디렉토리 | API 키 프로필 (전역) |
| `.claude/settings.local.json` | 프로젝트 루트 | Claude Code hook 등록 (자동 생성) |

---

## .vela/config.json

`vela init`이 생성하는 프로젝트 설정:

```json
{
  "version": "1.0",
  "pipeline": {
    "default": "standard",
    "scales": ["trivial", "quick", "standard"]
  }
}
```

### 커스텀 파이프라인

`.vela/pipelines/` 디렉토리에 JSON 파일로 커스텀 파이프라인을 정의할 수 있습니다:

```json
{
  "name": "review",
  "description": "Code review pipeline",
  "steps": ["init", "research", "execute", "commit", "finalize"],
  "mode_map": {
    "init": "read",
    "research": "read",
    "execute": "readwrite",
    "commit": "readwrite",
    "finalize": "read"
  }
}
```

사용: `vela start "코드 리뷰" --type review`

---

## ~/.vela/auth.json

API 키 프로필 저장 (v2 형식):

```json
{
  "version": 2,
  "profiles": {
    "default": {
      "apiKey": "sk-ant-...",
      "createdAt": "2026-03-27T10:00:00.000Z"
    },
    "work": {
      "apiKey": "sk-ant-...",
      "createdAt": "2026-03-27T11:00:00.000Z"
    }
  },
  "activeProfile": "default"
}
```

### 인증 우선순위

1. `ANTHROPIC_API_KEY` 환경변수 (최우선)
2. `~/.vela/auth.json`의 활성 프로필
3. 미설정 시 안내 메시지 출력

### 프로필 관리

```bash
vela auth add work        # 새 프로필 추가 (API 키 입력)
vela auth list            # 프로필 목록 (활성 프로필 ✓ 표시)
vela auth use work        # 활성 프로필 전환
vela auth remove work     # 프로필 삭제
vela auth status          # 현재 인증 상태 확인
```

### 마이그레이션

v1 형식 (`{ apiKey, savedAt }`)에서 v2 형식으로 자동 마이그레이션됩니다.

---

## .claude/settings.local.json

`vela init`이 자동 생성하는 Claude Code hook 등록 파일:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hook": "node .vela/hooks/vela-gate.cjs"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hook": "node .vela/hooks/tracker.cjs"
      }
    ]
  }
}
```

이 파일을 직접 편집할 필요는 없습니다. `vela init`이 자동 관리합니다.

---

## 에이전트 오버라이드

`.vela/agents/` 디렉토리의 프롬프트 파일을 직접 편집하여 에이전트 동작을 커스터마이징할 수 있습니다:

```
.vela/agents/
├── index.md              # 마스터 프롬프트
├── researcher/           # 리서치 에이전트
├── planner/              # 기획 에이전트
├── executor/             # 실행 에이전트
├── debugger/             # 디버깅 에이전트
├── synthesizer/          # 요약 에이전트
└── pm/                   # PM 에이전트
```

---

## 환경변수

| 변수 | 설명 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 키 (최우선 인증) |
| `VELA_REPO` | install.sh에서 사용할 GitHub 리포 (기본: `EcoKG/vela`) |
| `VELA_VERSION` | install.sh에서 설치할 버전 (기본: `0.1.1`) |
