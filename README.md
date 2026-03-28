<p align="center">
  <br />
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Vela_IAU.svg/280px-Vela_IAU.svg.png" alt="Vela Constellation" width="160" />
  <br />
  <br />
  <strong>⛵ Vela</strong>
  <br />
  <em>AI Coding Agent with Built-in Governance</em>
  <br />
  <br />
  <a href="#quick-start">Quick Start</a> · <a href="#why-vela">Why Vela</a> · <a href="#vela-chat">Chat Agent</a> · <a href="#architecture">Architecture</a> · <a href="#hooks--enforcement">Hooks</a> · <a href="#documentation">Docs</a>
  <br />
  <br />
</p>

---

> **Vela** (돛자리, the Sail) — 하늘에서 가장 큰 별자리의 일부였던 돛자리처럼,
> AI 코딩 에이전트의 모든 행위에 **방향**을 부여합니다.

Vela는 두 가지 모드로 동작합니다:

1. **독립 에이전트** — `vela chat`으로 Claude와 직접 대화하고, 파일 읽기/쓰기/편집/Bash 실행을 tool_use 루프로 자동 수행
2. **거버넌스 엔진** — Claude Code hooks 위에서 파이프라인 순서 강제, 시크릿 감지, 모드 기반 읽기/쓰기 제어 수행

```
지시는 무시될 수 있다. 구조는 우회할 수 없다.
```

## Why Vela

| 문제 | Vela의 답 |
|------|-----------|
| AI 에이전트를 직접 운영하고 싶다 | **`vela chat`** — Anthropic SDK 직접 통신, 스트리밍 TUI, 4개 tool 자동 실행 |
| 비용이 통제되지 않는다 | **예산 상한** — `--budget $5`로 세션 비용 한도 설정, 80% 경고, 100% 차단 |
| 간단한 질문에 비싼 모델을 쓴다 | **동적 라우팅** — 복잡도 기반 haiku/sonnet/opus 자동 선택, 예산 압박 시 다운그레이드 |
| 긴 대화에서 품질이 떨어진다 | **컨텍스트 리셋** — 100K 토큰 자동 트리거 또는 `/fresh`로 Haiku 요약 기반 대화 압축 |
| AI가 파이프라인 단계를 건너뛴다 | **Hook enforcement** — 리서치 없이 plan 불가, plan 없이 코드 수정 불가 |
| 시크릿이 코드에 노출된다 | **15가지 패턴 실시간 감지** — API key, JWT, DB URL 즉시 차단 |
| 테스트 실패인데 커밋한다 | **빌드/테스트 게이트** — 실패 시 commit 불가 |

## Quick Start

### 독립 에이전트 (vela chat)

```bash
# 1. Install
npm install -g vela-cli

# 2. Set API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Start chatting
vela chat

# With options
vela chat --model opus              # 모델 선택
vela chat --budget 5                # $5 예산 한도
vela chat --auto-route              # 복잡도 기반 자동 모델 선택
vela chat --resume                  # 이전 세션 이어서
```

### 거버넌스 엔진 (Claude Code hooks)

```bash
# 1. Initialize in your project
cd your-project
vela init

# 2. Start a pipeline
vela start "Add OAuth2 authentication" --scale large
```

## Vela Chat

`vela chat`은 Anthropic SDK로 Claude와 직접 대화하는 독립 에이전트입니다.

### 기능

| 기능 | 설명 |
|------|------|
| **스트리밍 TUI** | Ink v6 + React 19 기반 인터랙티브 터미널 UI |
| **4개 Tool** | Read, Write, Edit, Bash — tool_use 루프 자동 실행 |
| **세션 영속화** | SQLite에 대화 저장, `--resume`으로 복원 |
| **대시보드** | Ctrl+D로 토글 — 토큰/비용/모델/세션 실시간 표시 |
| **예산 상한** | `--budget <USD>` — 80% 경고, 100% 차단, 대시보드 잔여 예산 표시 |
| **동적 모델 라우팅** | `--auto-route` — 메시지 복잡도 기반 haiku/sonnet/opus 자동 선택 |
| **컨텍스트 리셋** | `/fresh` 또는 100K 토큰 자동 트리거 — Haiku 요약 기반 대화 압축 |
| **모델 전환** | `/model sonnet` — 런타임 모델 전환 |
| **거버넌스 내장** | 17 VK-*/VG-* gate 인라인 적용, RetryBudget 연속 차단 예산 |

### 슬래시 명령어

| 명령어 | 기능 |
|--------|------|
| `/help` | 도움말 표시 |
| `/quit` | 종료 |
| `/clear` | 대화 초기화 |
| `/model <name>` | 모델 전환 (sonnet, opus, haiku) |
| `/fresh` | 컨텍스트 리셋 — 대화 요약 후 새로 시작 |
| `/budget [amount]` | 예산 확인 또는 설정 |
| `/auto` | 동적 모델 라우팅 on/off |
| `/sessions` | 저장된 세션 목록 |

### 키보드 단축키

| 단축키 | 기능 |
|--------|------|
| `Ctrl+D` | 대시보드 토글 |
| `Ctrl+L` | 화면 클리어 |
| `Escape` | 오버레이 닫기 |

### 인증

3단계 우선순위:

1. `ANTHROPIC_API_KEY` 환경변수
2. `~/.vela/auth.json` 활성 프로필
3. 미설정 시 안내 메시지

```bash
# 프로필 관리
vela auth add <name>     # API 키 프로필 추가
vela auth list           # 프로필 목록
vela auth use <name>     # 활성 프로필 전환
vela auth remove <name>  # 프로필 삭제
vela auth status         # 현재 인증 상태
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ⛵  V E L A                            │
│                                                             │
│  ┌─── Independent Agent ────────────────────────────────┐   │
│  │  vela chat                                           │   │
│  │  Anthropic SDK + SSE Streaming + Tool Loop           │   │
│  │                                                      │   │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────┐            │   │
│  │  │ Session │ │ Budget   │ │ Model     │            │   │
│  │  │ SQLite  │ │ Manager  │ │ Router    │            │   │
│  │  └─────────┘ └──────────┘ └───────────┘            │   │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────┐            │   │
│  │  │ Context │ │ Token    │ │ Governance│            │   │
│  │  │ Manager │ │ Tracker  │ │ ESM Gates │            │   │
│  │  └─────────┘ └──────────┘ └───────────┘            │   │
│  │                                                      │   │
│  │  TUI: ChatApp + Dashboard + MessageList + ToolStatus │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Governance Engine (Claude Code Hooks) ────────────┐   │
│  │  ⛵ Vela Gate (PreToolUse)    🔭 Tracker (PostToolUse) │   │
│  │  R/W mode + pipeline ordering  trace.jsonl            │   │
│  │                                                       │   │
│  │  P I P E L I N E                                      │   │
│  │  init → research → plan → checkpoint → branch         │   │
│  │       → execute → verify → commit → finalize          │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  🤖 Adaptive Agents — 6 roles × 25 prompts                 │
│     solo / scout / role-separation                          │
└─────────────────────────────────────────────────────────────┘
```

### TypeScript. SQLite. Zero Runtime Dependencies.

- **Language:** TypeScript (strict, ESM, `moduleResolution: nodenext`)
- **State:** SQLite via better-sqlite3 — pipelines, sessions, milestones, slices, tasks
- **TUI:** Ink v6 + React 19 — interactive chat + real-time dashboard
- **API:** @anthropic-ai/sdk — SSE streaming, tool_use loop
- **Hooks:** Claude Code hooks — PreToolUse × 1 (vela-gate) + PostToolUse × 1 (tracker)
- **Test:** Vitest — **1,038+ tests passing**

## Commands

### Chat Agent

```bash
vela chat                          # Interactive chat with Claude
vela chat --model opus             # Specify model (sonnet|opus|haiku)
vela chat --budget 5               # Set $5 budget limit
vela chat --auto-route             # Enable complexity-based auto model routing
vela chat --resume [sessionId]     # Resume previous session
vela chat sessions                 # List saved sessions
```

### Authentication

```bash
vela auth add <name>               # Add API key profile
vela auth list                     # List profiles
vela auth use <name>               # Switch active profile
vela auth remove <name>            # Remove profile
vela auth login                    # Interactive login
vela auth status                   # Current auth status
```

### Core Pipeline

```bash
vela init                          # .vela/ scaffold + hook registration
vela start "<task>" --scale <size> # Start pipeline (small|medium|large)
vela state                         # Current pipeline status (JSON)
vela transition                    # Advance to next step
vela cancel                        # Cancel active pipeline
```

### Hierarchy

```bash
vela milestone create|list|complete
vela slice create|list|complete|boundary
vela task create|list|complete
```

### Planning & Intelligence

```bash
vela discuss start                 # Conversational planning session
vela discuss advance --data "..."  # Advance through 6 stages
vela discuss render                # Export to structured context doc
vela agents list                   # 6 core agent roles
vela agents strategy --scale large # Agent team composition
```

### Observability

```bash
vela cost                          # Pipeline cost & metrics report
vela tui                           # Real-time TUI dashboard (Node.js ≥20)
```

### Git Integration

```bash
vela git branch                    # Create vela/ prefixed branch
vela git commit                    # Conventional commit with pipeline ref
vela git merge                     # Squash merge back to base
```

### Requirements

```bash
vela req create R001 --title "..." --class core-capability
vela req list [--status active]
vela req update R001 --status validated
vela req render                    # Generate REQUIREMENTS.md
```

## Hooks & Enforcement

Vela는 **2개의 Claude Code hooks**로 파이프라인 무결성을 보장합니다.

### ⛵ Vela Gate — 모드 강제 + 파이프라인 순서 강제 (PreToolUse)

| Code | Rule |
|------|------|
| VK-01 | Read-only 모드에서 Bash 쓰기 명령 차단 |
| VK-03 | pipeline-state.json 직접 수정 차단 |
| VK-04 | Read-only 모드에서 Write/Edit 차단 |
| VK-05 | 민감 파일 (.env, credentials, id_rsa) 쓰기 차단 |
| VK-06 | 15가지 시크릿 패턴 실시간 감지 및 차단 |
| VG-00 | 파이프라인 중 TaskCreate/TaskUpdate 차단 |
| VG-01 | research.md 없이 plan.md 작성 불가 |
| VG-02 | execute 전 소스코드 수정 불가 |
| VG-03 | 빌드/테스트 실패 시 commit 불가 |
| VG-07 | execute/commit/finalize 단계에서만 git commit 허용 |
| VG-08 | verify 완료 전 git push 차단 |
| VG-12 | PM이 직접 소스 수정 차단 — SubAgent 위임 강제 |
| VG-13 | TDD sub-phase: 테스트 먼저, 구현은 다음 |

### 거버넌스 ESM 모듈 (vela chat 내장)

`vela chat`에서는 동일한 VK-*/VG-* 규칙이 ESM 모듈로 내장되어 tool 실행 전에 인라인 적용됩니다:

- `checkGate()` — 순수 결정 함수, 부작용 없음
- `RetryBudget` — 연속 차단 3회 시 tool loop 종료
- `tracker` — JSONL tool trace + build/test signal 기록

### 🔭 Tracker — 이벤트 기록 (PostToolUse)

모든 tool 호출을 `trace.jsonl`에 기록합니다. `vela cost`의 데이터 소스.

## Pipelines

| Scale | Steps | Use Case |
|-------|-------|----------|
| `--scale large` | init → research → plan → plan-check → checkpoint → branch → execute → verify → commit → finalize | 설계가 필요한 기능 |
| `--scale medium` | init → plan → execute → verify → commit → finalize | 명확한 작업 |
| `--scale small` | init → execute → commit → finalize | 단순 수정 |

## Adaptive Agent Strategy

| Scale | Strategy | Agents |
|-------|----------|--------|
| small | **solo** | PM이 직접 실행 |
| medium | **scout** | PM + 탐색 에이전트 |
| large | **role-separation** | Researcher → Planner → Executor → Debugger → Synthesizer |

## Numbers

| Metric | Value |
|--------|-------|
| Source (TypeScript) | ~9,636 lines |
| Tests (TypeScript) | ~16,251 lines |
| Hook enforcement (CJS) | ~587 lines |
| Agent prompts | 25 files |
| Test cases | 1,038+ passing |
| Tarball size | ~112 KB |
| Node.js | ≥ 18 (TUI: ≥ 20) |

## Project Structure

```
your-project/
├── .vela/
│   ├── hooks/       # 2 enforcement hooks (CJS) + shared/
│   ├── agents/      # 25 agent prompt files
│   ├── config.json  # Project configuration
│   └── state/       # SQLite DB, pipeline state (gitignored)
├── .claude/
│   └── settings.local.json  # Hook registration (auto-generated)
└── src/             # Your code — protected by Vela
```

## Philosophy

```
  구조로 강제하라, 지시로 의존하지 마라.
  Enforce by structure, not by instruction.
```

Vela는 AI에게 "하지 마세요"라고 말하지 않습니다. 할 수 없게 만듭니다.

## Documentation

상세 문서는 [`docs/`](docs/) 디렉토리에서 확인할 수 있습니다:

| 문서 | 내용 |
|------|------|
| 📦 [Installation Guide](docs/installation.md) | 설치 방법, 인증 설정, 트러블슈팅 |
| 📖 [Usage Guide](docs/usage.md) | vela chat 사용법, 파이프라인 워크플로우, 계층 구조 |
| 🔒 [Hooks & Enforcement](docs/hooks.md) | Vela Gate/Tracker 상세, 거버넌스 ESM, 시크릿 패턴 |
| ⚙️ [Configuration](docs/configuration.md) | config.json, auth.json, 커스텀 파이프라인 |
| 💻 [CLI Reference](docs/cli-reference.md) | 모든 명령어 레퍼런스 (chat, auth, pipeline, hierarchy) |

## License

MIT — Copyright (c) 2026 EcoKG

---

<p align="center">
  <em>⛵ 별을 따라 항해하라 — 모든 파이프라인은 목적지로 향한다</em>
</p>
