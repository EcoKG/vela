<p align="center">
  <br />
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Vela_IAU.svg/280px-Vela_IAU.svg.png" alt="Vela Constellation" width="160" />
  <br />
  <br />
  <strong>⛵ Vela</strong>
  <br />
  <em>AI Coding Agent with Built-in Governance</em>
  <br />
  <code>v0.2.0</code>
  <br />
  <br />
  <a href="#quick-start">Quick Start</a> · <a href="#why-vela">Why Vela</a> · <a href="#vela-chat">Chat Agent</a> · <a href="#governance-engine">Governance</a> · <a href="#architecture">Architecture</a> · <a href="#documentation">Docs</a>
  <br />
  <br />
</p>

---

> **Vela** (돛자리, the Sail) — 하늘에서 가장 큰 별자리의 일부였던 돛자리처럼,
> AI 코딩 에이전트의 모든 행위에 **방향**을 부여합니다.

Vela는 **두 가지 모드**로 동작합니다:

1. **독립 에이전트** (`vela chat`) — Claude와 직접 대화하며, 파일 읽기/쓰기/편집/Bash를 tool_use 루프로 자동 수행
2. **거버넌스 엔진** (Claude Code hooks) — 파이프라인 순서 강제, 시크릿 감지, 모드 기반 읽기/쓰기 제어

```
지시는 무시될 수 있다. 구조는 우회할 수 없다.
Enforce by structure, not by instruction.
```

---

## Why Vela

| 문제 | Vela의 답 |
|------|-----------|
| AI 에이전트를 직접 운영하고 싶다 | **`vela chat`** — Anthropic SDK 직접 통신, SSE 스트리밍 TUI, 4개 tool 자동 실행 |
| API 키가 없어도 쓰고 싶다 | **Dual Provider** — API 키 없으면 Claude Code CLI로 자동 폴백 |
| 비용이 통제되지 않는다 | **예산 상한** — `--budget $5`로 세션 비용 한도, 80% 경고, 100% 차단 |
| 간단한 질문에 비싼 모델을 쓴다 | **동적 라우팅** — 복잡도 기반 haiku/sonnet/opus 자동 선택, 예산 압박 시 다운그레이드 |
| 긴 대화에서 품질이 떨어진다 | **컨텍스트 리셋** — 100K 토큰 자동 트리거 또는 `/fresh`로 Haiku 요약 기반 대화 압축 |
| AI가 파이프라인 단계를 건너뛴다 | **Hook enforcement** — 리서치 없이 plan 불가, plan 없이 코드 수정 불가 |
| 시크릿이 코드에 노출된다 | **15가지 패턴 실시간 감지** — API key, JWT, DB URL, Private key 즉시 차단 |
| 테스트 실패인데 커밋한다 | **빌드/테스트 게이트** — 실패 시 commit 불가 |

---

## Quick Start

### 독립 에이전트 (vela chat)

```bash
# 1. Install
npm install -g vela-cli

# 2. Set API key (또는 Claude Code CLI가 설치되어 있으면 자동 감지)
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Start chatting
vela chat

# With options
vela chat --model opus              # 모델 선택 (sonnet|opus|haiku)
vela chat --budget 5                # $5 예산 한도
vela chat --auto-route              # 복잡도 기반 자동 모델 선택
vela chat --resume                  # 이전 세션 이어서
vela chat -m "파일 구조 보여줘"      # 단발 질문 (one-shot)
```

### 거버넌스 엔진 (Claude Code hooks)

```bash
# 1. 프로젝트 초기화
cd your-project
vela init

# 2. 파이프라인 시작
vela start "Add OAuth2 authentication" --scale large
```

---

## Vela Chat

`vela chat`은 Anthropic SDK로 Claude와 직접 대화하는 **독립 AI 코딩 에이전트**입니다.

### Provider 자동 감지

Vela는 시작 시 사용 가능한 Provider를 자동으로 감지합니다:

| 우선순위 | Provider | 조건 |
|----------|----------|------|
| 1 | **API** (Anthropic SDK 직접 통신) | `ANTHROPIC_API_KEY` 환경변수 또는 `~/.vela/auth.json` 프로필 |
| 2 | **CLI** (Claude Code CLI 위임) | `claude --version` 성공 (30초 TTL 캐시) |
| 3 | **Error** | 둘 다 없으면 안내 메시지 |

API Provider는 SSE 스트리밍 + tool_use 루프를 직접 실행하고,
CLI Provider는 `@anthropic-ai/claude-agent-sdk`의 `query()`를 통해 Claude Code CLI에 위임합니다.

### 기능 일람

| 기능 | 설명 |
|------|------|
| **스트리밍 TUI** | Ink v6 + React 19 기반 인터랙티브 터미널 UI |
| **4개 Tool** | `Read`, `Write`, `Edit`, `Bash` — tool_use 루프 자동 실행 |
| **Dual Provider** | API 키 → Claude Code CLI 자동 폴백 |
| **세션 영속화** | SQLite에 대화 저장, `--resume`으로 복원 |
| **대시보드** | `Ctrl+D` 토글 — 토큰/비용/모델/세션/예산 실시간 표시 |
| **예산 상한** | `--budget <USD>` — 80% 경고, 100% 차단 |
| **동적 모델 라우팅** | `--auto-route` — 메시지 복잡도 기반 haiku/sonnet/opus 자동 선택 |
| **컨텍스트 리셋** | `/fresh` 또는 100K 토큰 자동 트리거 — Haiku 요약 기반 대화 압축 |
| **런타임 모델 전환** | `/model sonnet` — 대화 중 모델 교체 |
| **거버넌스 내장** | 20개 VK-*/VG-* gate 인라인 적용, RetryBudget 연속 차단 관리 |

### 슬래시 명령어

| 명령어 | 기능 |
|--------|------|
| `/help` | 도움말 표시 |
| `/quit` | 종료 |
| `/clear` | 대화 초기화 |
| `/model <name>` | 모델 전환 (`sonnet`, `opus`, `haiku`) |
| `/fresh` | 컨텍스트 리셋 — 대화 요약 후 새로 시작 |
| `/budget [amount]` | 예산 확인 또는 설정 |
| `/auto` | 동적 모델 라우팅 on/off |
| `/sessions` | 저장된 세션 목록 |

### 키보드 단축키

| 단축키 | 기능 |
|--------|------|
| `Ctrl+D` | 대시보드 토글 (토큰/비용/모델/예산) |
| `Ctrl+L` | 화면 클리어 |
| `Escape` | 오버레이 닫기 |

### 인증 관리

3단계 우선순위로 API 키를 탐색합니다:

1. `ANTHROPIC_API_KEY` 환경변수
2. `~/.vela/auth.json` 활성 프로필
3. Claude Code CLI 설치 여부 (API 키 불필요)

```bash
# 프로필 관리
vela auth add <name>     # API 키 프로필 추가
vela auth list           # 프로필 목록
vela auth use <name>     # 활성 프로필 전환
vela auth remove <name>  # 프로필 삭제
vela auth status         # 현재 인증 상태
```

---

## Governance Engine

Vela의 거버넌스 엔진은 **2개의 Claude Code hooks**와 **ESM 거버넌스 모듈**로 구성됩니다.

### Hook 아키텍처

| Hook | 시점 | 역할 |
|------|------|------|
| **⛵ Vela Gate** | PreToolUse | 모드/파이프라인 규칙 강제 — 위반 시 tool 실행 차단 |
| **🔭 Tracker** | PostToolUse | 모든 tool 호출을 `trace.jsonl`에 기록, build/test 신호 수집 |

### Gate 규칙 전체 목록

#### VK — Keeper (보안/시스템 보호)

| Code | 규칙 | 설명 |
|------|------|------|
| VK-01 | Read-only Bash 차단 | Read-only 모드에서 파일시스템 변경 Bash 명령 차단 |
| VK-02 | Explore Bash 차단 | Explore 모드에서 쓰기 Bash 명령 차단 |
| VK-03 | State 파일 보호 | `pipeline-state.json` 직접 수정 차단 |
| VK-04 | Read-only Write/Edit 차단 | Read-only 모드에서 Write/Edit tool 차단 |
| VK-05 | 민감 파일 보호 | `.env`, `credentials.json`, `id_rsa` 등 쓰기 차단 |
| VK-06 | 시크릿 감지 | 15가지 시크릿 패턴 (AWS, GitHub, OpenAI, JWT 등) 실시간 차단 |
| VK-07 | PM 코드 수정 금지 | PM 에이전트의 직접 소스코드 수정 차단 |

#### VG — Guard (파이프라인 순서 강제)

| Code | 규칙 | 설명 |
|------|------|------|
| VG-00 | Task 도구 차단 | 파이프라인 중 TaskCreate/TaskUpdate 차단 |
| VG-01 | Research-first | `research.md` 없이 `plan.md` 작성 불가 |
| VG-02 | Plan-first | Execute 전 소스코드 수정 불가 |
| VG-03 | Build/Test 게이트 | 빌드/테스트 실패 시 commit 불가 |
| VG-04 | Research 보호 | Research 단계에서 코드 수정 차단 |
| VG-05 | 중복 보호 | (VK-03에 통합됨) |
| VG-06 | Plan 단계 보호 | Plan 단계에서 소스코드 수정 차단 |
| VG-07 | Commit 단계 제한 | execute/commit/finalize 단계에서만 git commit 허용 |
| VG-08 | Push 게이트 | Verify 완료 전 git push 차단 |
| VG-09 | Finalize 전 코드 수정 차단 | Finalize 단계에서 새 코드 변경 차단 |
| VG-11 | Checkpoint 강제 | Plan 후 checkpoint 없이 execute 진입 차단 |
| VG-12 | PM 위임 강제 | PM이 직접 소스 수정 시 SubAgent 위임 강제 |
| VG-13 | TDD 순서 강제 | 테스트 먼저, 구현은 다음 |

### ESM 거버넌스 모듈 (vela chat 내장)

`vela chat`에서는 동일한 VK-*/VG-* 규칙이 TypeScript ESM 모듈로 내장됩니다:

```
checkGate(toolName, toolInput, ctx) → GateResult
  └─ 순수 결정 함수: no process.exit, no stderr, no fs mutation
  └─ 호출자가 결과를 해석 (차단/허용/로깅)

RetryBudget
  └─ 동일 게이트 연속 3회 차단 → tool loop 자동 종료
  └─ 성공 시 카운터 리셋

Tracker
  └─ JSONL 기반 tool trace + build/test signal 수집
  └─ vela cost의 데이터 소스
```

### 15가지 시크릿 패턴 (VK-06)

| 패턴 | 대상 |
|------|------|
| `AKIA/ASIA...` | AWS Access Key |
| `ghp_...` / `gho_...` | GitHub Personal Access Token / OAuth |
| `sk-...` (48자) | OpenAI API Key |
| `sk-ant-...` (90자+) | Anthropic API Key |
| `eyJ...` (JWT) | JSON Web Token |
| `sk_live_...` / `rk_live_...` | Stripe Live/Restricted Key |
| `mongodb+srv://` | MongoDB Connection String |
| `postgres://` / `mysql://` | Database Connection String |
| `-----BEGIN PRIVATE KEY-----` | RSA/EC Private Key |
| `xox[bpsar]-...` | Slack Token |
| `AIza...` | Google API Key |
| `SG.....` | SendGrid Key |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         ⛵  V E L A  v0.2.0                     │
│                                                                  │
│  ┌─── Independent Agent ──────────────────────────────────────┐  │
│  │  vela chat                                                 │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ Provider    │  │ Claude Client│  │ Tool Engine      │  │  │
│  │  │ API / CLI   │  │ SSE Streaming│  │ Read/Write/Edit  │  │  │
│  │  │ auto-detect │  │ tool_use loop│  │ Bash + Governance│  │  │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘  │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ Session     │  │ Budget       │  │ Model Router     │  │  │
│  │  │ SQLite      │  │ Manager      │  │ haiku/sonnet/    │  │  │
│  │  │ persist     │  │ warn/block   │  │ opus auto-select │  │  │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘  │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ Context     │  │ Token        │  │ Governance       │  │  │
│  │  │ Manager     │  │ Tracker      │  │ ESM Gates        │  │  │
│  │  │ 100K reset  │  │ cost calc    │  │ 20 VK/VG rules   │  │  │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘  │  │
│  │                                                            │  │
│  │  TUI: 12 React Components (Ink v6 + React 19)             │  │
│  │  ChatApp · Dashboard · MessageList · ToolStatus            │  │
│  │  ChatInput · Header · HelpOverlay · PipelinePanel          │  │
│  │  GovernanceStatus · AutoModeStatus · TaskProgress · App    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── Governance Engine (Claude Code Hooks) ──────────────────┐  │
│  │  ⛵ Vela Gate (PreToolUse)     🔭 Tracker (PostToolUse)    │  │
│  │  R/W mode + pipeline ordering   trace.jsonl recording      │  │
│  │                                                            │  │
│  │  P I P E L I N E                                           │  │
│  │  init → research → plan → checkpoint → branch              │  │
│  │       → execute → verify → commit → finalize               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  🤖 Adaptive Agents — 6 roles × 25 prompts                      │
│     PM · Researcher · Planner · Executor · Debugger · Synthesizer│
│     Strategy: solo / scout / role-separation                     │
└──────────────────────────────────────────────────────────────────┘
```

### 기술 스택

| 항목 | 기술 |
|------|------|
| **Language** | TypeScript (strict, ESM, `moduleResolution: nodenext`, `target: es2022`) |
| **State** | SQLite via `better-sqlite3` — 파이프라인, 세션, 마일스톤, 슬라이스, 태스크 |
| **TUI** | Ink v6 + React 19 — 12개 컴포넌트, 인터랙티브 채팅 + 실시간 대시보드 |
| **API** | `@anthropic-ai/sdk` — SSE 스트리밍, tool_use loop |
| **CLI Adapter** | `@anthropic-ai/claude-agent-sdk` (optional) — Claude Code CLI 위임 |
| **Hooks** | Claude Code hooks — PreToolUse × 1 + PostToolUse × 1 (CJS) |
| **Governance** | ESM 모듈 — 순수 결정 함수 `checkGate()` + `RetryBudget` + `Tracker` |
| **Test** | Vitest — **1,070+ tests passing** |
| **Node.js** | ≥ 18 (TUI: ≥ 20) |

### 모듈 구조

```
src/
├── cli.ts                    # CLI entry point — Commander.js 기반 명령어 라우팅
├── provider.ts               # Provider 자동 감지 (API key → CLI fallback)
├── claude-client.ts          # Anthropic SDK wrapper — SSE 스트리밍 + tool_use
├── claude-code-adapter.ts    # Claude Code CLI SDK adapter — query() 위임
├── claude-code-readiness.ts  # CLI 설치 감지 (30s TTL 캐시)
├── claude-code-types.ts      # claude-agent-sdk 타입 스텁
├── tool-engine.ts            # 4개 Tool 정의 + executor + governance 통합
├── model-router.ts           # 복잡도 분류 + 예산 압박 다운그레이드
├── budget-manager.ts         # 세션 예산 관리 (warning/blocked 상태)
├── context-manager.ts        # 100K 토큰 감지 + Haiku 요약 + 컨텍스트 리셋
├── token-tracker.ts          # 토큰 누적 + 비용 산출 (모델별 가격표)
├── session.ts                # SQLite 세션 CRUD
├── auth.ts                   # API 키 프로필 관리 (~/.vela/auth.json)
├── models.ts                 # 모델 별칭 + 티어 매핑
├── pipeline.ts               # 파이프라인 상태 머신
├── auto-mode.ts              # 자동 실행 모드 (task queue)
├── init.ts                   # 프로젝트 초기화 (.vela/ 스캐폴드)
├── config.ts                 # 프로젝트 설정 관리
├── state.ts                  # 마일스톤/슬라이스/태스크 CRUD
├── hierarchy.ts              # 계층 구조 관리
├── cost.ts                   # trace.jsonl 기반 비용 분석
├── git.ts                    # Git 통합 (branch, commit, merge)
├── requirements.ts           # 요구사항 관리
├── boundary.ts               # 슬라이스 경계 관리
├── discuss.ts                # 대화형 계획 세션 (6단계)
├── agents.ts                 # 에이전트 전략 선택
├── custom-pipeline.ts        # 커스텀 파이프라인 정의
├── continue.ts               # 세션 이어하기
├── version.ts                # 런타임 버전 읽기
├── index.ts                  # Public API exports
│
├── governance/               # ESM 거버넌스 모듈 (1,156 lines)
│   ├── gate.ts               # checkGate() — 순수 결정 함수
│   ├── constants.ts          # 시크릿 패턴, 파일 분류, Bash 패턴
│   ├── pipeline-helpers.ts   # 파이프라인 상태 읽기 헬퍼
│   ├── tracker.ts            # JSONL tool trace + signal 수집
│   ├── retry-budget.ts       # 연속 차단 예산 (default: 3)
│   └── index.ts              # Re-exports
│
├── hooks/                    # Claude Code CJS hooks (884 lines)
│   ├── vela-gate.cjs         # PreToolUse — 20개 VK/VG 규칙 적용
│   ├── tracker.cjs           # PostToolUse — trace.jsonl 기록
│   └── shared/
│       ├── constants.cjs     # 공유 상수
│       └── pipeline.cjs      # 파이프라인 I/O 헬퍼
│
├── agents/                   # 적응형 에이전트 프롬프트 (25 files)
│   ├── vela.md               # Vela 시스템 프롬프트
│   ├── executor.md           # Executor 역할
│   ├── planner.md            # Planner 역할
│   ├── researcher.md         # Researcher 역할
│   ├── pm/                   # PM 에이전트 (7 reference files)
│   ├── executor/             # Executor 상세 (TDD 등)
│   ├── planner/              # Planner 상세 (crosslayer, spec-format)
│   ├── researcher/           # Researcher 상세 (architecture, security 등)
│   ├── debugger/             # Debugger 에이전트
│   └── synthesizer/          # Synthesizer 에이전트
│
└── tui/                      # 터미널 UI 컴포넌트 (1,453 lines)
    ├── ChatApp.tsx            # 메인 채팅 앱 (Provider 분기)
    ├── Dashboard.tsx          # 실시간 대시보드 (토큰/비용/예산)
    ├── MessageList.tsx        # 메시지 렌더링
    ├── ChatInput.tsx          # 입력 컴포넌트
    ├── Header.tsx             # 상단 헤더
    ├── ToolStatus.tsx         # Tool 실행 상태
    ├── GovernanceStatus.tsx   # 거버넌스 상태
    ├── PipelinePanel.tsx      # 파이프라인 진행 상태
    ├── AutoModeStatus.tsx     # 자동 모드 상태
    ├── TaskProgress.tsx       # 태스크 진행률
    ├── HelpOverlay.tsx        # 도움말 오버레이
    ├── App.tsx                # TUI 진입점
    └── shortcuts.ts           # 키보드 단축키 정의
```

---

## CLI Reference

### Chat Agent

```bash
vela chat                              # 인터랙티브 채팅 시작
vela chat --model opus                 # 모델 지정 (sonnet|opus|haiku)
vela chat --budget 5                   # $5 예산 한도
vela chat --auto-route                 # 복잡도 기반 자동 모델 라우팅
vela chat --resume [sessionId]         # 이전 세션 이어서
vela chat -m "질문"                    # One-shot 모드
vela chat sessions                     # 저장된 세션 목록
```

### Authentication

```bash
vela auth add <name>                   # API 키 프로필 추가
vela auth list                         # 프로필 목록
vela auth use <name>                   # 활성 프로필 전환
vela auth remove <name>                # 프로필 삭제
vela auth login                        # 인터랙티브 로그인
vela auth status                       # 현재 인증 상태
```

### Pipeline

```bash
vela init                              # .vela/ 스캐폴드 + hook 등록
vela start "<task>" --scale <size>     # 파이프라인 시작 (small|medium|large)
vela state                             # 현재 파이프라인 상태 (JSON)
vela transition                        # 다음 단계로 전환
vela cancel                            # 활성 파이프라인 취소
```

### Hierarchy

```bash
vela milestone create|list|complete    # 마일스톤 관리
vela slice create|list|complete|boundary  # 슬라이스 관리
vela task create|list|complete         # 태스크 관리
```

### Planning & Intelligence

```bash
vela discuss start                     # 대화형 계획 세션
vela discuss advance --data "..."      # 6단계 진행
vela discuss render                    # 구조화된 컨텍스트 문서 출력
vela agents list                       # 6개 에이전트 역할 목록
vela agents strategy --scale large     # 팀 구성 전략
```

### Observability

```bash
vela cost                              # 파이프라인 비용 & 메트릭 리포트
vela tui                               # 실시간 TUI 대시보드 (Node.js ≥ 20)
```

### Git Integration

```bash
vela git branch                        # vela/ prefixed 브랜치 생성
vela git commit                        # Conventional commit + 파이프라인 참조
vela git merge                         # Squash merge back to base
```

### Requirements

```bash
vela req create R001 --title "..." --class core-capability
vela req list [--status active]
vela req update R001 --status validated
vela req render                        # REQUIREMENTS.md 생성
```

---

## Pipelines

| Scale | Steps | Use Case |
|-------|-------|----------|
| `small` | init → execute → commit → finalize | 단순 수정, 오타 교정 |
| `medium` | init → plan → execute → verify → commit → finalize | 명확한 작업, 기능 추가 |
| `large` | init → research → plan → plan-check → checkpoint → branch → execute → verify → commit → finalize | 설계가 필요한 기능, 복잡한 리팩토링 |

각 단계에서 **모드**(read/explore/write)가 결정되며, Vela Gate가 모드를 벗어나는 tool 호출을 차단합니다.

## Adaptive Agent Strategy

| Scale | Strategy | 에이전트 구성 |
|-------|----------|--------------|
| small | **solo** | PM이 직접 실행 |
| medium | **scout** | PM + 탐색 에이전트 |
| large | **role-separation** | Researcher → Planner → Executor → Debugger → Synthesizer |

---

## Numbers

| Metric | Value |
|--------|-------|
| Source (TypeScript + TSX) | **~11,005 lines** |
| Tests (TypeScript + TSX) | **~16,891 lines** |
| Hook enforcement (CJS) | **~884 lines** |
| Governance ESM module | **~1,156 lines** |
| TUI components | **12 files, ~1,453 lines** |
| Agent prompts | **25 files** |
| Test cases | **1,070+ passing** |
| Total files (npm pack) | **135** |
| Node.js requirement | ≥ 18 (TUI: ≥ 20) |

---

## Project Structure

```
your-project/
├── .vela/
│   ├── hooks/              # 2 enforcement hooks (CJS) + shared/
│   ├── agents/             # 25 agent prompt files
│   ├── config.json         # Project configuration
│   └── state/              # SQLite DB, pipeline state (gitignored)
├── .claude/
│   └── settings.local.json # Hook registration (auto-generated by vela init)
└── src/                    # Your code — protected by Vela governance
```

---

## Philosophy

```
  구조로 강제하라, 지시로 의존하지 마라.
  Enforce by structure, not by instruction.
```

Vela는 AI에게 "하지 마세요"라고 말하지 않습니다. **할 수 없게 만듭니다.**

- **Gate** — 허용되지 않은 tool 호출은 실행 전에 차단됩니다
- **Mode** — 각 파이프라인 단계마다 read/explore/write 모드가 강제됩니다
- **Budget** — 비용 한도에 도달하면 더 이상 요청할 수 없습니다
- **RetryBudget** — 같은 규칙에 3번 연속 차단되면 tool loop가 종료됩니다
- **Tracker** — 모든 tool 호출은 기록됩니다. 어떤 것도 보이지 않게 지나가지 않습니다

---

## Documentation

상세 문서는 [`docs/`](docs/) 디렉토리에서 확인할 수 있습니다:

| 문서 | 내용 |
|------|------|
| 📦 [Installation Guide](docs/installation.md) | 설치 방법, 인증 설정, 트러블슈팅 |
| 📖 [Usage Guide](docs/usage.md) | vela chat 사용법, 파이프라인 워크플로우, 계층 구조 |
| 🔒 [Hooks & Enforcement](docs/hooks.md) | Vela Gate/Tracker 상세, 거버넌스 ESM, 시크릿 패턴 |
| ⚙️ [Configuration](docs/configuration.md) | config.json, auth.json, 커스텀 파이프라인 |
| 💻 [CLI Reference](docs/cli-reference.md) | 모든 명령어 레퍼런스 (chat, auth, pipeline, hierarchy) |

---

## License

MIT — Copyright (c) 2026 EcoKG

---

<p align="center">
  <em>⛵ 별을 따라 항해하라 — 모든 파이프라인은 목적지로 향한다</em>
</p>
