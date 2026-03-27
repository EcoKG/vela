<p align="center">
  <br />
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Vela_IAU.svg/280px-Vela_IAU.svg.png" alt="Vela Constellation" width="160" />
  <br />
  <br />
  <strong>⛵ Vela</strong>
  <br />
  <em>Development Governance Engine for AI Coding Agents</em>
  <br />
  <br />
  <a href="#quick-start">Quick Start</a> · <a href="#why-vela">Why Vela</a> · <a href="#architecture">Architecture</a> · <a href="#commands">Commands</a> · <a href="#hooks--enforcement">Hooks</a> · <a href="#documentation">Docs</a>
  <br />
  <br />
</p>

---

> **Vela** (돛자리, the Sail) — 하늘에서 가장 큰 별자리의 일부였던 돛자리처럼,
> AI 코딩 에이전트의 모든 행위에 **방향**을 부여합니다.

AI 코딩 도구는 강력하지만, 방향 없는 힘은 위험합니다.
Vela는 **"언제, 어떤 순서로, 어떤 검증을 거쳐"** 코드를 작성할 수 있는지를 — 프롬프트가 아닌 **구조로** — 강제합니다.

```
지시는 무시될 수 있다. 구조는 우회할 수 없다.
```

## Why Vela

| 문제 | Vela의 답 |
|------|-----------|
| AI가 파이프라인 단계를 건너뛴다 | **Hook enforcement** — 리서치 없이 plan 불가, plan 없이 코드 수정 불가 |
| 시크릿이 코드에 노출된다 | **15가지 패턴 실시간 감지** — API key, JWT, DB URL 즉시 차단 |
| .env를 직접 수정한다 | **민감 파일 보호** — .env, credentials.json, id_rsa 쓰기 차단 |
| 테스트 실패인데 커밋한다 | **빌드/테스트 게이트** — 실패 시 commit 불가 |
| 변경 사항을 추적할 수 없다 | **파이프라인 산출물** — research.md → plan.md → verification.md, trace.jsonl |
| 에이전트 규모 조절이 안 된다 | **적응적 에이전트 전략** — small(solo) / medium(scout) / large(role-separation) |

## Quick Start

```bash
# 1. Install globally
npm install -g vela-cli

# 2. Initialize in your project
cd your-project
vela init

# 3. Start a pipeline
vela start "Add OAuth2 authentication" --scale large
```

그게 전부입니다. Vela가 Claude Code hooks에 자동 등록되고, 이후 모든 AI 코딩 행위에 거버넌스가 적용됩니다.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ⛵  V E L A                            │
│                                                             │
│   ⛵ Gate Keeper        🌟 Gate Guard       🧭 Orchestrator │
│   R/W mode enforcement  Pipeline ordering   State injection │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  P I P E L I N E                                    │   │
│   │                                                     │   │
│   │  init → research → plan → checkpoint → branch       │   │
│   │       → execute → verify → commit → finalize        │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   🔭 Tracker              ✦ TUI Dashboard                  │
│   trace.jsonl logging     Real-time pipeline status         │
│                                                             │
│   🤖 Adaptive Agents                                       │
│   6 roles × 26 prompts   solo / scout / role-separation    │
└─────────────────────────────────────────────────────────────┘
```

### TypeScript. SQLite. Zero Runtime Dependencies.

- **Language:** TypeScript (strict, ESM, `moduleResolution: nodenext`)
- **State:** SQLite via better-sqlite3 — pipelines, milestones, slices, tasks
- **TUI:** Ink v6 + React 19 — real-time dashboard with `vela tui`
- **Hooks:** Claude Code hooks (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart, Compact, SubagentStart, TaskCompleted)
- **Test:** Vitest — **589 tests passing**

### 3-Tier Hierarchy

```
Milestone                  ← 프로젝트 단위
  └── Slice                ← 기능 단위 (demoable vertical increment)
       └── Task            ← 작업 단위 (cascading completion)
```

Task 완료 → Slice 자동 완료 → Milestone 자동 완료. 상위 구조를 수동으로 관리할 필요 없습니다.

## Commands

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
vela tui                           # Real-time TUI dashboard
vela auto start|next|status|pause  # Unattended auto-execution
```

### Git Integration

```bash
vela git branch                    # Create vela/ prefixed branch
vela git commit                    # Conventional commit with pipeline ref
vela git merge                     # Squash merge back to base
```

### Requirements

```bash
vela req create "<title>" --class must
vela req list [--status active]
vela req update <id> --status validated
vela req render                    # Generate REQUIREMENTS.md
```

## Hooks & Enforcement

Vela는 **두 겹의 방어 레이어**로 파이프라인 무결성을 보장합니다.

### ⛵ Gate Keeper — 모드 강제

| Code | Rule |
|------|------|
| VK-01 | Read-only 모드에서 Bash 쓰기 명령 차단 |
| VK-04 | Read-only 모드에서 Write/Edit 차단 |
| VK-05 | 민감 파일 (.env, credentials, id_rsa) 쓰기 차단 |
| VK-06 | 15가지 시크릿 패턴 실시간 감지 및 차단 |

### 🌟 Gate Guard — 파이프라인 순서 강제

| Code | Rule |
|------|------|
| VG-00 | 파이프라인 중 TaskCreate/TaskUpdate 차단 |
| VG-01 | research.md 없이 plan.md 작성 불가 |
| VG-02 | execute 전 소스코드 수정 불가 |
| VG-03 | 빌드/테스트 실패 시 commit 불가 |
| VG-05 | pipeline-state.json 직접 수정 불가 |
| VG-07 | execute/commit/finalize 단계에서만 git commit 허용 |
| VG-08 | verify 완료 전 git push 차단 |
| VG-12 | PM이 직접 소스 수정 차단 — SubAgent 위임 강제 |
| VG-13 | TDD sub-phase: 테스트 먼저, 구현은 다음 |

차단 시 구조화된 JSON 응답과 복구 경로를 자동 제공합니다:

```
⛵ [Vela] ✦ BLOCKED [VG-02]: Source code modification before execute step.
  File: src/app.ts | Step: research
  Recovery: Complete steps first: Research → Plan → Implementation
```

## Pipelines

| Scale | Steps | Use Case |
|-------|-------|----------|
| `--scale large` | init → research → plan → plan-check → checkpoint → branch → execute → verify → commit → finalize | 설계가 필요한 기능 |
| `--scale medium` | init → plan → execute → verify → commit → finalize | 명확한 작업 |
| `--scale small` | init → execute → commit → finalize | 단순 수정 |
| `--type <name>` | Custom `.vela/pipelines/*.json` | 프로젝트별 커스텀 |

## Adaptive Agent Strategy

파이프라인 규모에 따라 에이전트 팀 구성이 자동 결정됩니다.

| Scale | Strategy | Agents |
|-------|----------|--------|
| small | **solo** | PM이 직접 실행 |
| medium | **scout** | PM + 탐색 에이전트 |
| large | **role-separation** | Researcher → Planner → Executor → Debugger → Synthesizer |

6개 핵심 역할, 26개 전문화 프롬프트:

```
researcher/    — hypothesis, architecture, security, quality
planner/       — spec-format, crosslayer
executor/      — tdd
debugger/      — diagnosis, fix-strategy
synthesizer/   — summary generation
pm/            — pipeline-flow, git-strategy, team-rules, model-strategy
```

## Discuss — Conversational Planning

6단계 선형 진행으로 구조화된 기획 세션:

```
vision → reflection → qa → depth-check → requirements → roadmap
```

```bash
vela discuss start                     # Start session
vela discuss advance --data "..."      # Progress through stages
vela discuss render                    # Export to context document
```

## TUI Dashboard

```bash
vela tui
```

```
⛵ Vela ✦ Dashboard
┌─ Pipeline ────────────────────────────────┐
│ standard  🧭 execute  [=====>---] 6/10   │
│ Add OAuth2 authentication                 │
├─ Tasks ───────────────────────────────────┤
│ ✅ T001: Setup auth module                │
│ 🔄 T002: Implement JWT flow              │
│ ○  T003: Add refresh token logic         │
├─ Auto-mode ───────────────────────────────┤
│ ▶ running  │ task 2/5  │ no blockers     │
└───────────────────────────────────────────┘
                              q: quit
```

## Cost Intelligence

```bash
vela cost
```

파이프라인별 tool call 수, agent dispatch 횟수, 실행 시간, artifact 생성량을 추적합니다. PostToolUse hook이 `trace.jsonl`에 모든 이벤트를 기록하고, cost module이 집계합니다.

## Project Structure

```
your-project/
├── .vela/
│   ├── hooks/       # 10 enforcement hooks (CJS)
│   ├── cli/         # Engine CLI (vela-engine, vela-read, vela-write)
│   ├── agents/      # 26 agent prompt files
│   ├── guidelines/  # Coding standards, error handling, testing
│   ├── references/  # Interactive UI, gates reference
│   ├── templates/   # Pipeline & config templates
│   └── config.json  # Project configuration
├── .claude/
│   └── settings.local.json  # Hook registration (auto-generated)
└── src/             # Your code — protected by Vela
```

## Numbers

| Metric | Value |
|--------|-------|
| Source (TypeScript) | 5,060 lines |
| Tests | 9,818 lines |
| Hook enforcement (CJS) | 1,131 lines |
| Agent prompts | 26 files |
| Test cases | 589 passing |
| Tarball size | < 200KB |
| Node.js | ≥ 22 |

## Philosophy

```
  구조로 강제하라, 지시로 의존하지 마라.
  Enforce by structure, not by instruction.
```

Vela는 AI에게 "하지 마세요"라고 말하지 않습니다. 할 수 없게 만듭니다.

- 리서치 없이 plan을 쓸 수 없습니다 — 파일이 없으면 hook이 차단합니다.
- 테스트 없이 커밋할 수 없습니다 — 빌드 실패 시 commit이 거부됩니다.
- 시크릿을 코드에 넣을 수 없습니다 — 15가지 패턴이 실시간으로 감지됩니다.

프롬프트는 무시될 수 있습니다. Hook exit code 2는 무시할 수 없습니다.

## Documentation

상세 문서는 [`docs/`](docs/) 디렉토리에서 확인할 수 있습니다:

| 문서 | 내용 |
|------|------|
| 📦 [Installation Guide](docs/installation.md) | 설치 방법 3가지, 프로젝트 설정, 트러블슈팅 |
| 📖 [Usage Guide](docs/usage.md) | 전체 워크플로우, 파이프라인, 계층 구조, Discuss, Auto-mode |
| 🔒 [Hooks & Enforcement](docs/hooks.md) | Gate Keeper/Guard 상세, 15가지 시크릿 패턴, 차단 메커니즘 |
| ⚙️ [Configuration](docs/configuration.md) | config.json, 커스텀 파이프라인, 에이전트 오버라이드 |
| 💻 [CLI Reference](docs/cli-reference.md) | 모든 명령어 레퍼런스 (옵션, 출력 형식, 예시) |

## License

MIT — Copyright (c) 2026 EcoKG

---

<p align="center">
  <em>⛵ 별을 따라 항해하라 — 모든 파이프라인은 목적지로 향한다</em>
</p>
