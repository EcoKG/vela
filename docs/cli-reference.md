# 💻 CLI Reference

모든 Vela CLI 명령어의 상세 레퍼런스입니다.

---

## vela chat — 독립 에이전트

Claude와 직접 대화하는 인터랙티브 TUI 에이전트.

```bash
vela chat [options]
vela chat sessions
```

### Options

| Option | Description |
|--------|-------------|
| `--model <name>` | Claude 모델 선택 (`sonnet`, `opus`, `haiku` 또는 전체 모델 ID) |
| `--budget <amount>` | 세션 예산 한도 (USD). 80%에서 경고, 100%에서 API 호출 차단 |
| `--auto-route` | 동적 모델 라우팅 활성화 — 메시지 복잡도에 따라 haiku/sonnet/opus 자동 선택 |
| `--resume [sessionId]` | 이전 세션 이어서 대화. sessionId 생략 시 마지막 세션 |
| `-s, --system <prompt>` | 시스템 프롬프트 설정 |

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `vela chat sessions` | 저장된 세션 목록 조회 (ID, 생성일, 메시지 수) |

### 슬래시 명령어 (TUI 내부)

| Command | Description |
|---------|-------------|
| `/help` | 도움말 표시 |
| `/quit` | 종료 |
| `/clear` | 대화 초기화 |
| `/model <name>` | 런타임 모델 전환 (sonnet, opus, haiku) |
| `/fresh` | 컨텍스트 리셋 — Haiku로 대화 요약 후 fresh 시작 |
| `/budget [amount]` | 예산 상태 확인 또는 한도 설정 |
| `/auto` | 동적 모델 라우팅 on/off 토글 |
| `/sessions` | 저장된 세션 목록 |

### 키보드 단축키

| Shortcut | Description |
|----------|-------------|
| `Ctrl+D` | 대시보드 토글 (토큰/비용/모델/세션 표시) |
| `Ctrl+L` | 화면 클리어 |
| `Escape` | 오버레이 닫기 |

### Examples

```bash
# 기본 채팅
vela chat

# Opus 모델로 $10 예산 설정
vela chat --model opus --budget 10

# 자동 모델 라우팅 + 이전 세션 이어서
vela chat --auto-route --resume

# 세션 목록 확인
vela chat sessions
```

---

## vela auth — 인증 관리

API 키 프로필을 관리합니다. 프로필은 `~/.vela/auth.json`에 저장됩니다.

```bash
vela auth <subcommand>
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `vela auth add <name>` | 새 API 키 프로필 추가 (인터랙티브 입력) |
| `vela auth list` | 등록된 프로필 목록 (활성 프로필 표시) |
| `vela auth use <name>` | 활성 프로필 전환 |
| `vela auth remove <name>` | 프로필 삭제 |
| `vela auth login` | 인터랙티브 로그인 |
| `vela auth status` | 현재 인증 상태 (env/profile/none) |

### 인증 우선순위

1. `ANTHROPIC_API_KEY` 환경변수
2. `~/.vela/auth.json` 활성 프로필
3. 미설정 시 안내 메시지

---

## vela init — 프로젝트 초기화

```bash
vela init
```

`.vela/` 디렉토리를 생성하고 Claude Code hooks를 자동 등록합니다.

생성되는 파일:
- `.vela/hooks/` — vela-gate.cjs, tracker.cjs, shared/
- `.vela/agents/` — 25개 에이전트 프롬프트
- `.vela/config.json` — 프로젝트 설정
- `.claude/settings.local.json` — Hook 등록

---

## vela start — 파이프라인 시작

```bash
vela start "<description>" [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--scale <size>` | 파이프라인 규모: `small`, `medium`, `large` |
| `--type <name>` | 커스텀 파이프라인 타입 (`.vela/pipelines/*.json`) |

### Examples

```bash
vela start "OAuth2 인증 추가" --scale large
vela start "버그 수정" --scale small
vela start "코드 리뷰" --type review
```

---

## vela state — 파이프라인 상태

```bash
vela state
```

현재 활성 파이프라인의 상태를 JSON으로 출력합니다.

---

## vela transition — 단계 전이

```bash
vela transition
```

파이프라인의 다음 단계로 전이합니다. 전이 조건이 충족되지 않으면 거부됩니다.

---

## vela cancel — 파이프라인 취소

```bash
vela cancel
```

---

## vela milestone — 마일스톤 관리

```bash
vela milestone create "<title>" [--description "<desc>"]
vela milestone list
vela milestone complete <id>
```

---

## vela slice — 슬라이스 관리

```bash
vela slice create "<title>" --milestone <id>
vela slice list --milestone <id>
vela slice boundary <id> --inputs "..." --outputs "..."
vela slice complete <id>
```

---

## vela task — 태스크 관리

```bash
vela task create "<title>" --slice <id>
vela task list --slice <id>
vela task complete <id>
```

---

## vela discuss — 대화형 기획

```bash
vela discuss start
vela discuss advance --data "..."
vela discuss status
vela discuss render [--output <path>]
```

6단계: vision → reflection → qa → depth-check → requirements → roadmap

---

## vela agents — 에이전트 관리

```bash
vela agents list
vela agents show <role>
vela agents strategy --scale <size>
```

---

## vela cost — 비용 분석

```bash
vela cost
```

---

## vela tui — TUI 대시보드

```bash
vela tui
```

Node.js ≥ 20 필요.

---

## vela git — Git 통합

```bash
vela git branch
vela git commit
vela git merge
```

---

## vela req — 요구사항 관리

```bash
vela req create <id> --title "..." --class <class>
vela req list [--status <status>]
vela req update <id> --status <status>
vela req render
```

---

## vela continue — 세션 재개

```bash
vela continue save --milestone <id> --slice <id> [--task <id>] [--notes "..."]
vela continue load
vela continue clear
```
