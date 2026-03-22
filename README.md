# Vela Engine v1.1 — Sandbox Development System

**Vela**는 Claude Code를 완전히 감싸는 샌드박스 엔진이다.
Claude Code는 독자적으로 작동할 수 없으며, 모든 행위는 Vela의 파이프라인을 통해서만 진행된다.

---

## 사상 (Philosophy)

Vela는 세 가지 핵심 사상 위에 설계되었다.

### 1. 통제된 자유 (Controlled Autonomy)

AI 코딩 도구는 강력하지만, 통제 없는 자유는 위험하다. Vela는 Claude Code에게 "무엇을 할 수 있는가"가 아니라 **"언제, 어떤 순서로, 누구의 검증을 거쳐 할 수 있는가"**를 강제한다. 파일 하나를 수정하더라도 파이프라인을 거치고, 코드 한 줄을 커밋하더라도 검증을 통과해야 한다.

### 2. 이중 방어 (Defense in Depth)

단일 방어선은 뚫린다. Vela는 모든 행위에 최소 두 개의 독립적 방어 레이어를 적용한다:

- **Gate Keeper** (수문장) + **Gate Guard** (가이드라인) — 훅 레벨 이중 차단
- **팀 메커니즘** (Worker → Leader) — 작업자와 검증자의 분리
- **Permission deny** + **Hook exit(2)** — Claude Code 시스템 레벨 + Vela 코드 레벨

### 3. 추적 가능한 개발 (Traceable Development)

모든 행위는 기록된다. 파이프라인의 각 단계에서 산출물(research.md, plan.md, verification.md)이 생성되고, git 커밋에는 파이프라인 참조가 포함되며, TreeNode 캐시는 탐색 히스토리를 보존한다. "왜 이렇게 수정했는가?"를 항상 추적할 수 있다.

---

## 메커니즘 (How It Works)

```
┌─────────────────────────────────────────────────────────────┐
│                      VELA SANDBOX                           │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Gate Keeper  │  │  Gate Guard  │  │  Orchestrator │      │
│  │  (수문장)      │  │  (가이드라인)  │  │  (상태주입)    │      │
│  │  R/W 모드 강제 │  │  파이프라인 순서│  │  매 턴 컨텍스트│      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │ PreToolUse      │ PreToolUse      │ UserPrompt    │
│         ▼                 ▼                 ▼               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   PIPELINE ENGINE                    │    │
│  │                                                      │    │
│  │  init → research → plan → plan-check → checkpoint   │    │
│  │       → branch → execute → verify → commit          │    │
│  │       → finalize                                     │    │
│  │                                                      │    │
│  │  ┌─────────────────────────────────────────────┐     │    │
│  │  │            TEAM MECHANISM                    │     │    │
│  │  │  PM → Worker (Researcher/Planner/Executor)  │     │    │
│  │  │     → Leader (검증/승인/거부)                  │     │    │
│  │  └─────────────────────────────────────────────┘     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Custom CLI   │  │  TreeNode    │  │  Tracker     │      │
│  │  (vela-read)  │  │  (SQLite)    │  │  (PostTool)  │      │
│  │  (vela-write) │  │  경로 캐싱    │  │  행위 추적    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 행위 흐름

1. 사용자가 메시지를 보내면 **Orchestrator**가 파이프라인 상태를 Claude에게 주입
2. Claude가 도구를 사용하려 하면 **Gate Keeper**가 모드(read/write/readwrite)를 확인
3. 동시에 **Gate Guard**가 파이프라인 순서 준수 여부를 확인
4. 두 게이트를 모두 통과하면 도구 실행
5. 실행 후 **Tracker**가 행위를 기록하고 빌드/테스트 신호를 감지

---

## 설치 방법

### 요구사항

- Node.js 18+
- Claude Code CLI
- Git (선택, git 형상관리 사용 시)
- SQLite3 CLI (선택, TreeNode 캐시 사용 시)

### 설치

```bash
# 1. 스킬을 Claude Code에 등록
#    Claude Code에서 /vela:vela-init 실행

# 2. 또는 수동 설치
git clone https://github.com/EcoKG/vela.git
cd your-project
cp -r /path/to/vela/scripts/* .vela/
cp /path/to/vela/templates/* .vela/templates/
node .vela/install.js
node .vela/install.js verify
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
- **팀**: Vela-Researcher → Vela-Leader
- **수행**: 프로젝트 구조 탐색, 취약점/이슈 식별, 의존성 분석
- **Leader 검증**: "이 리서치로 충분한가?" — 불충분하면 reject, Researcher 재작업
- **TreeNode**: 탐색한 파일 경로를 SQLite에 캐싱
- **산출물**: `research.md`

#### 3. Plan (구현 계획)
- **모드**: write
- **팀**: Vela-Planner → Vela-Leader
- **수행**: 파일별 변경 계획, 리스크 평가, 실행 순서 정의
- **Leader 검증**: "이 계획으로 충분한가?" — 누락된 부분이 있으면 reject, Planner 재작업
- **Gate**: research.md가 없으면 plan.md 작성 차단
- **산출물**: `plan.md`

#### 4. Plan-Check (계획 검증)
- **모드**: read
- **수행**: research→plan 매핑 검증, 갭 분석, 실현 가능성 확인
- **산출물**: `plan-check.md`

#### 5. Checkpoint (사용자 승인)
- **모드**: read
- **수행**: 사용자에게 계획 제시, 승인/거부 대기
- **Gate**: 사용자 승인 없이 execute 진입 불가

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
- **팀**: Vela-Executor → Vela-Leader
- **수행**: 소스코드 수정, 기능 구현, 리팩토링
- **Leader 검증**: "구현이 충분한가?" — 불충분하면 reject, Executor 재작업
- **Gate**: execute 단계 전 소스코드 수정 차단
- **산출물**: `task-summary.md`

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

## 팀 메커니즘

Research, Plan, Execute 단계에서 **팀 기반 실행**이 활성화된다.

### 팀 구성

| 역할 | 단계 | 책임 |
|------|------|------|
| **PM** | 전 단계 | 파이프라인 조율, Worker/Leader 소환 |
| **Vela-Researcher** | research | 프로젝트 분석, research.md 작성 |
| **Vela-Planner** | plan | 구현 계획 수립, plan.md 작성 |
| **Vela-Executor** | execute | 코드 구현, 소스코드 수정 |
| **Vela-Leader** | research/plan/execute | 산출물 검토, 승인 또는 거부 |

### 실행 루프

```
PM → Worker 소환 (team-dispatch researcher/planner/executor)
     → Worker 작업 수행
     → PM → Leader 소환 (team-dispatch leader)
     → Leader 검토: "이걸로 충분한가?"
         ├─ approve → 단계 완료, 다음 단계로 전이
         └─ reject + 피드백 → Worker 재소환 (iteration 증가)
```

### 명령어

```bash
# Worker 소환 및 결과 기록
node .vela/cli/vela-engine.js team-dispatch researcher|planner|executor
node .vela/cli/vela-engine.js team-record researcher|planner|executor pass

# Leader 검토
node .vela/cli/vela-engine.js team-dispatch leader
node .vela/cli/vela-engine.js team-record leader approve
node .vela/cli/vela-engine.js team-record leader reject --feedback "피드백 내용"
```

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
        ├── plan.md                    ← 구현 계획
        ├── plan-check.md              ← 계획 검증
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

# 팀 관리
vela-engine team-dispatch researcher|planner|executor|leader
vela-engine team-record <role> pass|fail|reject|approve [--feedback TEXT]

# Git 관리
vela-engine branch [--mode auto|prompt|none]             # 브랜치 생성
vela-engine commit [--message TEXT]                       # 변경사항 커밋
```

---

## 라이선스

MIT License

Copyright (c) 2026 EcoKG
