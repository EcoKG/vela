# ⛵ Vela Engine v1.3 — Sandbox Development System

**Vela**(돛자리)는 Claude Code를 완전히 감싸는 샌드박스 엔진이다.
Claude Code는 독자적으로 작동할 수 없으며, 모든 행위는 Vela의 파이프라인을 통해서만 진행된다.

---

## 사상 (Philosophy)

### 1. ⛵ 통제된 자유 (Controlled Autonomy)

AI 코딩 도구는 강력하지만, 통제 없는 자유는 위험하다. Vela는 Claude Code에게 "무엇을 할 수 있는가"가 아니라 **"언제, 어떤 순서로, 누구의 검증을 거쳐 할 수 있는가"**를 강제한다.

### 2. 🌟 이중 방어 (Defense in Depth)

- **Gate Keeper** + **Gate Guard** — 훅 레벨 이중 차단
- **Reviewer** (독립 subagent) + **PM(Leader)** — 독립 검증과 맥락 판단의 분리
- **Permission deny** + **Hook exit(2)** — Claude Code 시스템 + Vela 코드 레벨
- **GUARD 0**: 파이프라인 중 TaskCreate/TaskUpdate 차단 (자체 계획 수립 방지)
- **pipeline-state.json 보호**: 직접 수정 차단 (엔진만 수정 가능)

### 3. 🔭 추적 가능한 개발 (Traceable Development)

모든 행위가 기록된다. 산출물(research.md, plan.md, review-*.md, approval-*.json), git 커밋에 파이프라인 참조, TreeNode 캐시로 탐색 히스토리 보존.

### 4. ✦ 구조로 강제 (Enforce by Structure)

"규칙을 따라라"는 지시는 무시된다. Vela는 **구조적 강제**를 사용한다:
- 산출물이 없으면 엔진이 전이 차단 (exit gate)
- approval-{step}.json이 없으면 다음 단계 진입 불가
- `--scale` 미지정 시 init 거부 (사용자 선택 강제)

---

## 메커니즘 (How It Works)

```
✦─────────────────────────────────────────────────────────────✦
│                      ⛵ VELA SANDBOX                         │
│                                                              │
│  ⛵ Gate Keeper    🌟 Gate Guard    🧭 Orchestrator          │
│  R/W 모드 강제     파이프라인 순서    매 턴 상태 주입           │
│  PreToolUse       PreToolUse       UserPromptSubmit          │
│                                                              │
│  🧭 PIPELINE ENGINE ────────────────────────────────────     │
│  init → research → plan → plan-check → checkpoint            │
│       → branch → execute → verify → commit → finalize        │
│                                                              │
│  🌟 TEAM MECHANISM ─────────────────────────────────────     │
│  Research: Agent Teams (3명 병렬) → Reviewer → PM(Leader)    │
│  Plan:     Subagent (Planner) → Reviewer → PM(Leader)        │
│  Execute:  Subagent/Teams → Reviewer → PM(Leader)            │
│                                                              │
│  ✦ ARCHITECTURE ENFORCEMENT ────────────────────────────     │
│  Plan Gate: Architecture/ClassSpec/TestStrategy 필수          │
│  Execute: TDD sub-phases (test → implement → refactor)       │
│  approval-{step}.json 없으면 전이 차단                        │
│                                                              │
│  🔭 Tracker    ⛵ Custom CLI    ✦ TreeNode Cache             │
│  행위 추적      vela-read/write  SQLite 경로 캐싱             │
✦─────────────────────────────────────────────────────────────✦
```

### Explore / Develop 듀얼 모드

| 모드 | 상태 | 허용 | 차단 |
|------|------|------|------|
| **⛵ Explore** | 파이프라인 없음 | 읽기, 탐색, 질문 | 쓰기, TaskCreate |
| **🧭 Develop** | 파이프라인 활성 | 파이프라인 단계에 따름 | 단계 건너뛰기, TaskCreate |

---

## 빠른 시작

### 1. Vela 스킬 설치 (1회)

```bash
mkdir -p ~/.claude/skills/vela
git clone https://github.com/EcoKG/vela.git /tmp/vela-install
cp -r /tmp/vela-install/SKILL.md ~/.claude/skills/vela/
cp -r /tmp/vela-install/scripts ~/.claude/skills/vela/
cp -r /tmp/vela-install/templates ~/.claude/skills/vela/
rm -rf /tmp/vela-install
```

### 2. 프로젝트에 Vela 환경 구축

```
/vela
```

또는: `이 프로젝트에 Vela 환경을 구축해줘`

install.js가 자동으로:
- `.vela/` 디렉토리에 훅, CLI, 에이전트 파일 배포
- `.claude/settings.local.json`에 훅 + permission 등록
- `.claude/agents/vela.md` 배포 (기본 에이전트)
- `"agent": "vela"` 설정 (다음 세션부터 자동 Vela PM)
- `CLAUDE.md` 생성 (프로젝트 규칙)
- ⛵ statusLine 등록 (하단 바)

### 3. 개발 시작

```
사용자: "인증 시스템을 추가해줘"

⛵ Vela: 파이프라인 규모를 선택해주세요:
  - small: trivial (init → execute → commit → finalize)
  - medium: quick (init → plan → execute → verify → commit → finalize)
  - large: standard (full 10-step)

사용자: "large"

🧭 Pipeline 시작:
  → init → research (Agent Teams 3명 병렬)
  → plan (Subagent) → plan-check → checkpoint
  → branch → execute (Subagent/Teams) → verify
  → commit → finalize
```

---

## 파이프라인

### 종류

| 종류 | 단계 | 사용자 선택 |
|------|------|-----------|
| **standard** | init → research → plan → plan-check → checkpoint → branch → execute → verify → commit → finalize | `--scale large` |
| **quick** | init → plan → execute → verify → commit → finalize | `--scale medium` |
| **trivial** | init → execute → commit → finalize | `--scale small` |

`--scale`은 필수. 미지정 시 엔진이 거부하고 사용자에게 선택을 요구.

### 단계별 요약

| 단계 | 모드 | 팀 방식 | 산출물 |
|------|------|---------|--------|
| init | read | PM 직접 | meta.json, pipeline-state.json |
| **research** | read | **Agent Teams** (3명 병렬) + Reviewer subagent | research.md, review-research.md, approval-research.json |
| **plan** | write | **Subagent** (Planner) + Reviewer subagent | plan.md, review-plan.md, approval-plan.json |
| plan-check | read | PM 직접 | plan-check.md |
| checkpoint | read | 사용자 승인 | — |
| branch | read | PM 직접 | git branch |
| **execute** | readwrite | **Subagent** (Executor) + Reviewer subagent | review-execute.md, approval-execute.json |
| verify | read | PM 직접 | verification.md |
| commit | read | PM 직접 | diff.patch, git commit |
| finalize | write | PM 직접 | report.md |

---

## 팀 메커니즘

### 단계별 배분 (연구 결과 기반)

| 단계 | 방식 | 근거 |
|------|------|------|
| **Research** | **Agent Teams** (3명 병렬) | 보안/아키텍처/품질 각도 동시 조사. 공식 문서 핵심 사용 사례. |
| **Plan** | **Subagent** (1명) | 단일 일관된 설계 필요. 여러 명이면 충돌. |
| **Execute (소규모)** | **Subagent** (1명) | 파일 충돌 위험. |
| **Execute (대규모)** | **Agent Teams** (모듈별) | 파일 소유권 분리 시 병렬 구현. |
| **Reviewer** | **Subagent** (항상 1명) | 집중된 평가 작업. |
| **Leader** | **PM 겸임** | Agent Teams에서 Lead만 approve/reject 가능. |
| **trivial/quick** | Teams 안 씀 | 토큰 비용 정당화 불가. |

### Research — Agent Teams 병렬 조사

```
PM(Team Lead):
  TeamCreate: "vela-pipeline"
  → security-researcher (보안 취약점 관점)
  → architecture-researcher (아키텍처/구조 관점)
  → quality-researcher (코드 품질/성능 관점)
  → 3명 완료 후 PM이 종합하여 research.md 작성
  → Reviewer subagent: review-research.md 작성
  → PM(Leader): approve/reject → approval-research.json
  → TeamDelete
```

### Plan/Execute — Subagent 순차 처리

```
PM:
  → Planner/Executor subagent 소환 (Agent 도구, team_name 없음)
  → 산출물 작성
  → Reviewer subagent 소환 → review-{step}.md
  → PM(Leader): approve/reject → approval-{step}.json
```

### PM(Leader) 판단 기준

- **APPROVE**: Reviewer 점수 20+/25, critical 0개
- **REJECT**: critical/high 이슈 미해결 → Worker 재소환

---

## 아키텍처 기반 개발 (Standard)

### Plan — 구체적 명세서 (엔진이 구조 강제)

`## Architecture`, `## Class Specification`, `## Test Strategy` 섹션 필수.
각 200bytes 미만이면 transition 차단.

### Execute — TDD Sub-Phase

```
test-write (Red) → implement (Green) → refactor (Refactor)
```

---

## 방어 시스템

### ⛵ Gate Keeper (PreToolUse)

| 게이트 | 규칙 |
|--------|------|
| Bash 차단 | Vela CLI 외 차단 |
| 모드 강제 | 읽기전용 모드에서 Write/Edit 차단 |
| pipeline-state.json 보호 | 직접 수정 차단 |
| 민감파일 보호 | .env, credentials.json 등 차단 |
| 시크릿 감지 | API 키, 토큰 등 15개 패턴 차단 |

### 🌟 Gate Guard (PreToolUse)

| 가드 | 규칙 |
|------|------|
| GUARD 0 | 파이프라인 중 TaskCreate/TaskUpdate/TaskList 차단 |
| GUARD 0.5 | 비-research 단계에서 5회 이상 Read 경고 |
| GUARD 1 | research.md 없이 plan.md 작성 불가 |
| GUARD 2 | execute 전 소스코드 수정 불가 + pipeline-state.json 보호 |
| GUARD 3 | 빌드/테스트 실패 시 git commit 불가 |
| GUARD 4 | verification.md 없이 report.md 불가 |
| GUARD 5 | pipeline-state.json 직접 수정 불가 |
| GUARD 6 | 리비전 한도 초과 차단 |
| GUARD 7 | execute/commit/finalize에서만 git commit |
| GUARD 8 | verify 전 git push 차단 |
| GUARD 9 | 보호 브랜치 커밋 경고 |

### Permission Deny (절대 차단)

`rm -rf`, `git push --force`, `git reset --hard`, `git commit --no-verify`, `git clean -f`

---

## 산출물 구조

```
.vela/artifacts/
└── 2026-03-22/
    └── api-보안-강화-1358/
        ├── meta.json
        ├── pipeline-state.json
        ├── research.md              ← Research 결과
        ├── review-research.md       ← Reviewer 리뷰
        ├── approval-research.json   ← PM(Leader) 승인
        ├── plan.md                  ← 아키텍처 + 클래스 명세서
        ├── review-plan.md           ← Reviewer 리뷰
        ├── approval-plan.json       ← PM(Leader) 승인
        ├── plan-check.md
        ├── review-execute.md        ← Reviewer 리뷰
        ├── approval-execute.json    ← PM(Leader) 승인
        ├── verification.md
        ├── report.md
        ├── diff.patch
        └── trace.jsonl
```

---

## Git 형상관리

- **Init**: dirty tree 차단, .gitignore 자동 관리
- **Branch**: `vela/<slug>-<HHMM>` 자동 생성 (auto/prompt/none)
- **Commit**: Conventional Commits + `Vela-Pipeline:` 참조
- **Cancel**: 체크포인트 hash + 복구 안내

---

## 설치 결과

```
your-project/
├── .vela/
│   ├── hooks/           ← Gate Keeper, Gate Guard, Orchestrator, Tracker
│   ├── cli/             ← vela-engine, vela-read, vela-write
│   ├── agents/          ← vela.md, researcher.md, planner.md, executor.md, reviewer.md, leader.md
│   ├── cache/           ← TreeNode SQLite
│   ├── templates/       ← pipeline.json, config.json
│   ├── statusline.sh    ← ⛵ 하단 바 상태 표시
│   └── install.js
├── .claude/
│   ├── settings.local.json  ← 훅 + permission + agent: "vela"
│   └── agents/vela.md       ← 기본 에이전트
├── CLAUDE.md                ← Vela 규칙
└── (프로젝트 파일)
```

---

## 하단 바 (StatusLine)

```
⛵ Vela ✦ Explore │ Opus 4.6 42%              ← 파이프라인 없음
⛵ Vela ✦ standard 🧭 research │ task… │ 35%  ← 파이프라인 활성
```

---

## 엔진 명령어

```bash
vela-engine init "설명" --scale <small|medium|large>
vela-engine state
vela-engine transition
vela-engine record pass|fail
vela-engine sub-transition
vela-engine branch [--mode auto|prompt|none]
vela-engine commit [--message TEXT]
vela-engine cancel
```

---

## 라이선스

MIT License — Copyright (c) 2026 EcoKG
