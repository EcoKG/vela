# Vela Engine v1.2 — Sandbox Development System

**Vela**는 Claude Code를 완전히 감싸는 샌드박스 엔진이다.
Claude Code는 독자적으로 작동할 수 없으며, 모든 행위는 Vela의 파이프라인을 통해서만 진행된다.

---

## 사상 (Philosophy)

Vela는 네 가지 핵심 사상 위에 설계되었다.

### 1. 통제된 자유 (Controlled Autonomy)

AI 코딩 도구는 강력하지만, 통제 없는 자유는 위험하다. Vela는 Claude Code에게 "무엇을 할 수 있는가"가 아니라 **"언제, 어떤 순서로, 누구의 검증을 거쳐 할 수 있는가"**를 강제한다. 파일 하나를 수정하더라도 파이프라인을 거치고, 코드 한 줄을 커밋하더라도 검증을 통과해야 한다.

### 2. 이중 방어 (Defense in Depth)

단일 방어선은 뚫린다. Vela는 모든 행위에 최소 두 개의 독립적 방어 레이어를 적용한다:

- **Gate Keeper** (수문장) + **Gate Guard** (가이드라인) — 훅 레벨 이중 차단
- **Reviewer** (독립 subagent) + **Leader** (최종 판단) — 독립 검증과 맥락 판단의 분리
- **Permission deny** + **Hook exit(2)** — Claude Code 시스템 레벨 + Vela 코드 레벨

### 3. 추적 가능한 개발 (Traceable Development)

모든 행위는 기록된다. 파이프라인의 각 단계에서 산출물(research.md, plan.md, verification.md)이 생성되고, git 커밋에는 파이프라인 참조가 포함되며, TreeNode 캐시는 탐색 히스토리를 보존한다. "왜 이렇게 수정했는가?"를 항상 추적할 수 있다.

### 4. 구조로 강제, 지시로 의존하지 않음 (Enforce by Structure)

"Clean Architecture를 따라라"는 지시는 무시될 수 있다. Vela는 지시 대신 **구조적 강제**를 사용한다:
- plan.md에 `## Architecture`, `## Class Specification`, `## Test Strategy` 섹션이 없으면 엔진이 전이를 차단
- Reviewer subagent가 산출물을 독립적으로 평가하여 Leader에게 구체적 근거를 제공
- 빈 껍데기 산출물은 최소 크기(200bytes) 검증으로 차단

---

## 메커니즘 (How It Works)

```
┌──────────────────────────────────────────────────────────────────┐
│                         VELA SANDBOX                              │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  Gate Keeper  │  │  Gate Guard  │  │  Orchestrator │            │
│  │  (수문장)      │  │  (가이드라인)  │  │  (상태주입)    │            │
│  │  R/W 모드 강제 │  │  파이프라인 순서│  │  매 턴 컨텍스트│            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │ PreToolUse      │ PreToolUse      │ UserPrompt          │
│         ▼                 ▼                 ▼                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                    PIPELINE ENGINE                          │   │
│  │                                                             │   │
│  │  init → research → plan → plan-check → checkpoint          │   │
│  │       → branch → execute → verify → commit → finalize      │   │
│  │                                                             │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │              3-TIER REVIEW                            │   │   │
│  │  │  Worker (Researcher/Planner/Executor)                 │   │   │
│  │  │    → Reviewer (독립 subagent, 편향 없는 품질 점검)      │   │   │
│  │  │    → Leader (Reviewer 리포트 기반 최종 판단)            │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  │                                                             │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │           ARCHITECTURE ENFORCEMENT                    │   │   │
│  │  │  Plan Gate: Architecture/ClassSpec/TestStrategy 필수  │   │   │
│  │  │  Execute: TDD sub-phases (test → implement → refactor)│   │   │
│  │  │  review-{step}.md 없으면 전이 차단                      │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  Custom CLI   │  │  TreeNode    │  │  Tracker     │            │
│  │  (vela-read)  │  │  (SQLite)    │  │  (PostTool)  │            │
│  │  (vela-write) │  │  경로 캐싱    │  │  행위 추적    │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
└──────────────────────────────────────────────────────────────────┘
```

### 행위 흐름

1. 사용자가 메시지를 보내면 **Orchestrator**가 파이프라인 상태를 Claude에게 주입
2. Claude가 도구를 사용하려 하면 **Gate Keeper**가 모드(read/write/readwrite)를 확인
3. 동시에 **Gate Guard**가 파이프라인 순서 준수 여부를 확인
4. 두 게이트를 모두 통과하면 도구 실행
5. 실행 후 **Tracker**가 행위를 기록하고 빌드/테스트 신호를 감지

---

## 빠른 시작

### 1. Vela 스킬 설치 (1회)

```bash
# Claude Code 글로벌 스킬로 등록
mkdir -p ~/.claude/skills/vela
git clone https://github.com/EcoKG/vela.git /tmp/vela-install
cp -r /tmp/vela-install/SKILL.md ~/.claude/skills/vela/
cp -r /tmp/vela-install/scripts ~/.claude/skills/vela/
cp -r /tmp/vela-install/templates ~/.claude/skills/vela/
rm -rf /tmp/vela-install
```

### 2. 프로젝트에 Vela 환경 구축

아무 프로젝트 디렉토리에서 Claude Code를 열고:

```
/vela
```

또는 자연어로:

```
이 프로젝트에 Vela 환경을 구축해줘
```

Claude가 SKILL.md를 읽고 `.vela/` 디렉토리를 생성하며, 훅을 `.claude/settings.local.json`에 등록한다.

### 3. 개발 시작

Vela 환경이 구축된 후에는 **모든 개발 요청이 파이프라인을 통해 진행된다**:

```
사용자: "인증 시스템을 추가해줘"

Vela: 규모 자동 감지 → standard 파이프라인 시작
  → init (git 상태 체크)
  → research (Researcher 분석 → Reviewer 검증 → Leader 승인)
  → plan (Planner 설계 → Reviewer 아키텍처 리뷰 → Leader 승인)
  → plan-check → checkpoint (사용자 승인)
  → branch (feature 브랜치 생성)
  → execute (TDD: test → implement → refactor → Reviewer → Leader)
  → verify → commit (conventional commit) → finalize (report)
```

파이프라인 외의 파일 수정은 **Gate Guard가 자동 차단**한다.

---

## 설치 상세

### 요구사항

- Node.js 18+
- Claude Code CLI
- Git (선택, git 형상관리 사용 시)
- SQLite3 CLI (선택, TreeNode 캐시 사용 시)

### 수동 설치 (스킬 없이 직접 설정)

```bash
cd your-project
git clone https://github.com/EcoKG/vela.git /tmp/vela-setup
mkdir -p .vela
cp -r /tmp/vela-setup/scripts/* .vela/
cp -r /tmp/vela-setup/templates .vela/templates/
cp /tmp/vela-setup/templates/config.json .vela/config.json
node .vela/install.js
node .vela/install.js verify
rm -rf /tmp/vela-setup
```

### 설치 결과

프로젝트에 `.vela/` 디렉토리가 생성되고, `.claude/settings.local.json`에 훅과 permission이 등록된다.

```
your-project/
├── .vela/
│   ├── config.json                    ← Vela 설정
│   ├── install.js                     ← 훅 설치 관리자
│   ├── hooks/
│   │   ├── vela-gate-keeper.js        ← 수문장 (PreToolUse)
│   │   ├── vela-gate-guard.js         ← 가이드라인 (PreToolUse)
│   │   ├── vela-orchestrator.js       ← 상태주입 (UserPromptSubmit)
│   │   ├── vela-tracker.js            ← 추적기 (PostToolUse)
│   │   └── shared/
│   │       ├── constants.js           ← 공유 상수
│   │       └── pipeline.js            ← 파이프라인 유틸
│   ├── cli/
│   │   ├── vela-engine.js             ← 파이프라인 엔진
│   │   ├── vela-read.js               ← 샌드박스 읽기 도구
│   │   └── vela-write.js              ← 샌드박스 쓰기 도구
│   ├── cache/
│   │   └── treenode.js                ← SQLite 경로 캐시
│   └── templates/
│       ├── pipeline.json              ← 파이프라인 정의
│       └── config.json                ← 기본 설정
├── .claude/
│   └── settings.local.json            ← 프로젝트 로컬 훅 등록
└── (기존 프로젝트 파일)
```

---

## 파이프라인 상세

### 파이프라인 종류

| 종류 | 단계 | 자동 선택 조건 |
|------|------|--------------|
| **standard** | init → research → plan → plan-check → checkpoint → branch → execute → verify → commit → finalize | 6+ 파일, 300+ 라인 |
| **quick** | init → plan → execute → verify → commit → finalize | 3 파일 이하, 100 라인 이하 |
| **trivial** | init → execute → commit → finalize | 1 파일, 10 라인 이하 |

### 단계별 상세 설명

#### 1. Init (초기화)
- **모드**: read
- **수행**: 파이프라인 생성, 규모 자동 감지, 아티팩트 디렉토리 생성
- **Git**: 저장소 상태 스냅샷 (브랜치, HEAD hash, clean 여부)
- **Gate**: dirty tree 감지 시 차단, `.gitignore`에 Vela 항목 자동 추가
- **산출물**: `meta.json`, `pipeline-state.json`

```bash
node .vela/cli/vela-engine.js init "작업 설명" [--type code] [--scale large]
```

#### 2. Research (리서치 & 분석)
- **모드**: read (쓰기 차단)
- **팀**: Vela-Researcher → **Vela-Reviewer (subagent)** → Vela-Leader
- **수행**: 프로젝트 구조 탐색, 취약점/이슈 식별, 의존성 분석
- **Reviewer**: research.md의 완전성과 정확성을 독립 평가
- **Leader**: Reviewer 리포트 기반으로 approve/reject 판단
- **TreeNode**: 탐색한 파일 경로를 SQLite에 캐싱
- **산출물**: `research.md`, `review-research.md`

#### 3. Plan (구현 계획)
- **모드**: write
- **팀**: Vela-Planner → **Vela-Reviewer** → Vela-Leader (각 독립 에이전트)
- **수행**: 아키텍처 설계, 클래스 명세서, 테스트 전략 작성
- **Architecture Gate**: `## Architecture`, `## Class Specification`, `## Test Strategy` 섹션이 없거나 200bytes 미만이면 전이 차단
- **Reviewer**: 아키텍처 품질을 5개 관점(Layer Separation, DDD, SOLID, Test Strategy, Class Spec)에서 X/25로 평가
- **Leader**: Reviewer가 critical/high 이슈를 발견하면 reject → Planner 재작업
- **Gate**: research.md가 없으면 plan.md 작성 차단
- **산출물**: `plan.md`, `review-plan.md`

#### 4. Plan-Check (계획 검증)
- **모드**: read
- **수행**: research→plan 매핑 검증, 갭 분석, 실현 가능성 확인
- **산출물**: `plan-check.md`

#### 5. Checkpoint (사용자 승인)
- **모드**: read
- **수행**: 사용자에게 계획 제시, 승인/거부 대기
- **Gate**: 사용자 승인 없이 execute 진입 불가
- **참고**: 사용자는 plan.md의 아키텍처 설계와 Reviewer 리포트를 함께 확인

#### 6. Branch (브랜치 생성)
- **모드**: read
- **수행**: feature 브랜치 생성 (`vela/<slug>-<HHMM>`)
- **모드 선택**: auto (자동 생성) / prompt (명령어 제안) / none (스킵)
- **보호 브랜치**: main/master/develop에 있을 때만 새 브랜치 생성
- **비-코드 작업**: 문서, 분석 등은 스킵

```bash
node .vela/cli/vela-engine.js branch [--mode auto|prompt|none]
```

#### 7. Execute (구현)
- **모드**: readwrite (읽기/쓰기 모두 허용)
- **팀**: Vela-Executor → **Vela-Reviewer** → Vela-Leader (각 독립 에이전트)
- **TDD Sub-Phases** (standard 파이프라인):
  - `test-write` (Red) → 테스트 먼저 작성
  - `implement` (Green) → 테스트 통과하는 코드 작성
  - `refactor` (Refactor) → 구조 정리, 아키텍처 정렬
- **Reviewer**: 구현이 plan.md의 Class Specification과 일치하는지 독립 평가
- **Leader**: Reviewer 리포트 기반 approve/reject. `review-execute.md` 없으면 전이 차단
- **Gate**: execute 단계 전 소스코드 수정 차단
- **산출물**: `task-summary.md`, `review-execute.md`

```bash
node .vela/cli/vela-engine.js sub-transition  # sub-phase 전진
```

#### 8. Verify (검증)
- **모드**: read
- **수행**: 구현 결과 독립 검증, 요구사항 충족 확인
- **산출물**: `verification.md`

#### 9. Commit (커밋)
- **모드**: read
- **수행**: 변경사항 원자적 커밋
- **Conventional Commits**: `feat(slug): 설명` / `fix(slug): 설명`
- **파이프라인 참조**: 커밋 본문에 `Vela-Pipeline: <artifact-dir>` 포함
- **diff 캡처**: `diff.patch` 아티팩트 자동 생성
- **보호**: `.vela/` 내부 파일은 커밋에서 자동 제외

```bash
node .vela/cli/vela-engine.js commit [--message "custom message"]
```

#### 10. Finalize (마무리)
- **모드**: write
- **수행**: 최종 보고서 생성, commit hash와 브랜치 정보 포함
- **PR**: 선택적 Pull Request 생성 안내
- **산출물**: `report.md`

---

## 팀 메커니즘 — Agent Teams

Research, Plan, Execute 단계에서 **Claude Code Agent Teams**를 사용한다.
모든 역할이 **독립 Claude 인스턴스**로 실행되며, 별도 컨텍스트를 가진다.

### 팀 구성

| 역할 | 실행 방식 | 책임 |
|------|----------|------|
| **PM (Team Lead)** | 메인 세션 | 파이프라인 조율, 에이전트 소환/종료, 엔진 명령 실행 |
| **Vela-Researcher** | **독립 에이전트** | 프로젝트 분석, research.md 작성 |
| **Vela-Planner** | **독립 에이전트** | 아키텍처 설계, 클래스 명세서, plan.md 작성 |
| **Vela-Executor** | **독립 에이전트** | TDD 기반 코드 구현 |
| **Vela-Reviewer** | **독립 에이전트** | 산출물 품질 점검, review-{step}.md 작성 (X/25 점수) |
| **Vela-Leader** | **독립 에이전트** | Reviewer 리포트 기반 최종 판단, approval-{step}.json 작성 |

각 에이전트의 지시사항은 `.vela/agents/` 디렉토리에 정의:
`researcher.md`, `planner.md`, `executor.md`, `reviewer.md`, `leader.md`

### 왜 Agent Teams인가?

같은 세션에서 모든 역할을 수행하면 형식적 approve 경향이 발생한다.
테스트 결과:

| | 같은 세션 (V1) | 독립 에이전트 (V2) |
|---|---|---|
| Plan reject 발생 | 0/5 (0%) | 4/5 (80%) |
| Critical/High 이슈 발견 | 0개 | 14개 |
| 최악 사례 (Upload) | 10/25 | 24/25 |

독립 에이전트는 Worker의 사고 과정을 공유하지 않으므로 편향 없는 판단이 가능하다.

### 실행 루프

```
PM(Team Lead)
  → Worker 에이전트 소환 (Agent 도구)
     → Worker: 독립 컨텍스트에서 작업 → 산출물 작성
  → Reviewer 에이전트 소환
     → Reviewer: 산출물만 읽고 review-{step}.md 작성 (점수 + 이슈)
  → Leader 에이전트 소환
     → Leader: Reviewer 리포트 + 산출물 읽고 approval-{step}.json 작성
        ├─ approve → PM이 vela-engine transition 호출
        └─ reject → PM이 Worker에게 피드백 전달 → 재작업
```

### 승인 메커니즘 — 파일 기반

- **Reviewer** → `review-{step}.md` (점수 X/25, 이슈 목록)
- **Leader** → `approval-{step}.json` (`decision: "approve"` 또는 `"reject"`)
- 엔진 exit gate가 `approval-{step}.json` 확인
- 파일이 없거나 `approve`가 아니면 **transition 차단**

```json
{
  "step": "plan",
  "decision": "approve",
  "reviewer_score": "22/25",
  "justification": "모든 critical 이슈 해결됨"
}
```

---

## 아키텍처 기반 개발 (Standard Pipeline)

Standard 파이프라인에서는 추상적 원칙이 아닌 **구체적 설계 명세서**를 기반으로 개발한다.

### Plan 단계 — 구체적 명세서 작성

Planner는 plan.md에 반드시 다음 섹션을 포함해야 한다.
**섹션이 없거나 200bytes 미만이면 엔진이 전이를 차단한다.**

```markdown
## Architecture
레이어 구조, 의존성 방향, 모듈 분리 설계

## Class Specification
구체적 인터페이스, 클래스, 메서드 정의:

Interface: ProductRepository
  - findById(id: string): Promise<Product>
  - save(product: Product): Promise<void>

Class: CreateProductUseCase
  - constructor(repo: ProductRepository)
  - execute(command: CreateProductCommand): Promise<Product>

## Test Strategy
테스트 케이스 목록:
- "should create product with valid data"
- "should throw when name is empty"
```

이 명세서는 Executor에게 "설계도"로 전달된다.
추상적 원칙이 아닌 구체적 스펙이므로 무시하기 어렵다.

### Execute 단계 — TDD Sub-Phase

Standard 파이프라인의 execute는 세 개의 sub-phase를 순서대로 진행한다:

```
test-write (Red)    → 테스트 먼저 작성
implement (Green)   → 테스트 통과하는 코드 작성
refactor (Refactor) → 구조 정리, 아키텍처 정렬
```

```bash
node .vela/cli/vela-engine.js state           # sub-phase 확인
node .vela/cli/vela-engine.js sub-transition  # sub-phase 전진
```

### Reviewer의 역할 — 명세서 대조

Reviewer subagent는 **구체적 대조**를 수행한다:
- "plan.md의 Class Specification과 실제 구현이 일치하는가?"
- "Test Strategy의 테스트 케이스가 실제로 구현되었는가?"
- "의존성 방향이 Clean Architecture 원칙을 따르는가?"
- "Aggregate Root, Value Object 등 DDD 패턴이 적절한가?"

Reviewer의 리포트(`review-{step}.md`)가 artifact에 없으면 엔진이 전이를 차단한다.

---

## 방어 시스템

### Gate Keeper (수문장) — PreToolUse

모든 도구 호출 전에 실행되어 R/W 모드를 강제한다.

| 게이트 | 규칙 |
|--------|------|
| Bash 차단 | Vela CLI 외 Bash 사용 차단. 읽기 모드에서 안전 명령만 허용 |
| 모드 강제 | 읽기전용 모드에서 Write/Edit 차단 |
| 민감파일 보호 | .env, credentials.json 등 쓰기 차단 |
| 시크릿 감지 | API 키, 토큰, 비밀키 등 15개 패턴 감지 시 차단 |

### Gate Guard (가이드라인) — PreToolUse

파이프라인 순서를 강제한다. **무시, 우회, 변형 불가**.

| 가드 | 규칙 |
|------|------|
| GUARD 1 | research.md 없이 plan.md 작성 불가 |
| GUARD 2 | execute 단계 전 소스코드 수정 불가 |
| GUARD 3 | 빌드/테스트 실패 시 git commit 불가 |
| GUARD 4 | verification.md 없이 report.md 작성 불가 |
| GUARD 5 | pipeline-state.json 직접 수정 불가 |
| GUARD 6 | 단계별 리비전 한도 초과 시 차단 |
| GUARD 7 | execute/commit/finalize에서만 git commit 허용 |
| GUARD 8 | verify 완료 전 git push 차단 |
| GUARD 9 | 보호 브랜치 직접 커밋 경고 |

### Permission Deny (절대 차단)

Claude Code 시스템 레벨에서 차단. 어떤 범위에서든 deny = 허용 불가.

- `rm -rf`, `rm -r` — 파괴적 삭제
- `git push --force/--force-with-lease/-f`, `git push origin +*` — 강제 푸시
- `git reset --hard` — 하드 리셋
- `git commit --no-verify/-n` — 훅 우회
- `git clean -f/-fd` — 미추적 파일 삭제

---

## 산출물 구조

모든 파이프라인 산출물은 `.vela/artifacts/` 아래에 날짜/슬러그별로 저장된다.

```
.vela/artifacts/
└── 2026-03-22/
    └── api-보안-강화-1358/
        ├── meta.json                  ← 요청 메타데이터
        ├── pipeline-state.json        ← 파이프라인 상태 (엔진 전용)
        ├── research.md                ← 리서치 결과
        ├── review-research.md         ← Reviewer 리서치 리뷰
        ├── approval-research.json     ← Leader 리서치 승인
        ├── plan.md                    ← 아키텍처 설계 + 클래스 명세서
        ├── review-plan.md             ← Reviewer 아키텍처 리뷰
        ├── approval-plan.json         ← Leader 계획 승인
        ├── plan-check.md              ← 계획 검증
        ├── review-execute.md          ← Reviewer 구현 리뷰
        ├── approval-execute.json      ← Leader 구현 승인
        ├── verification.md            ← 구현 검증
        ├── report.md                  ← 최종 보고서
        ├── diff.patch                 ← 변경사항 diff
        └── trace.jsonl                ← 행위 로그
```

---

## Git 형상관리

### 커밋 히스토리 예시

```
85a77d9 feat(api-보안-강화): API 보안 강화: bcrypt, JWT, rate limiting
9a5749c chore: add .vela/ to gitignore
831d23f Initial commit
```

### 브랜치 구조

```
  master                          ← base branch (보호)
* vela/api-보안-강화-1358         ← pipeline branch
```

---

## 설정

`.vela/config.json`에서 Vela 동작을 설정할 수 있다.

```json
{
  "sandbox": {
    "enabled": true,
    "strict_mode": true,
    "bash_policy": "blocked"
  },
  "pipeline": {
    "default": "standard",
    "auto_scale": true,
    "enforce_all_steps": true
  },
  "gate_keeper": {
    "enabled": true,
    "mode_auto_detect": true
  },
  "gate_guard": {
    "enabled": true,
    "bypass_allowed": false
  },
  "cache": {
    "enabled": true,
    "treenode_enabled": true
  }
}
```

---

## 훅 관리

훅은 **프로젝트 로컬** (`.claude/settings.local.json`)에 등록된다.
다른 프로젝트에 영향을 주지 않으며, 프로젝트 삭제 시 자동 정리된다.

```bash
node .vela/install.js              # 훅 + permission 설치
node .vela/install.js verify       # 설치 검증
node .vela/install.js uninstall    # 완전 제거
node .vela/install.js status       # 현재 상태 확인
```

---

## 엔진 명령어 전체

```bash
# 파이프라인 관리
vela-engine init "설명" [--type TYPE] [--scale SCALE]   # 파이프라인 시작
vela-engine state                                        # 현재 상태 조회
vela-engine transition                                   # 다음 단계 전이
vela-engine dispatch [--role ROLE]                       # 에이전트 스펙
vela-engine record pass|fail|reject [--summary TEXT]     # 결과 기록
vela-engine cancel                                       # 파이프라인 취소

# Sub-Phase 관리
vela-engine sub-transition                               # sub-phase 전진

# Git 관리
vela-engine branch [--mode auto|prompt|none]             # 브랜치 생성
vela-engine commit [--message TEXT]                       # 변경사항 커밋
```

---

## 라이선스

MIT License

Copyright (c) 2026 EcoKG
