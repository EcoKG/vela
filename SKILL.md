---
name: vela
description: "Vela 샌드박스 엔진을 프로젝트에 구축하는 스킬. Claude Code의 모든 행위를 파이프라인 기반으로 통제하는 완전한 샌드박스 시스템을 설치하고 운영한다. /vela:vela-init 으로 프로젝트에 Vela 환경을 구축한다. Gate Keeper(수문장)가 읽기/쓰기를 통제하고, Gate Guard(가이드라인)가 파이프라인 이탈을 차단하며, 커스텀 CLI로 모든 파일 작업을 수행한다. 사용자가 프로젝트 환경 구축, 개발 파이프라인 설정, 샌드박스 기반 개발 시스템이 필요할 때 반드시 이 스킬을 사용해야 한다. Vela, 벨라, 샌드박스, 파이프라인, 게이트, 엔진 등의 키워드가 언급되면 이 스킬을 트리거한다."
---

# Vela Engine v1.0 — Sandbox Development System

Vela는 Claude Code를 완전히 감싸는 샌드박스 엔진이다. Claude Code는 독자적으로 작동할 수 없으며, 모든 세션과 행위는 Vela 엔진의 파이프라인을 통해 진행된다.

## 핵심 원칙

1. **샌드박스 강제**: Claude Code의 모든 행위는 Vela 파이프라인 안에서만 실행된다
2. **Gate Keeper (수문장)**: 읽기/쓰기 접근을 모드에 따라 차단/허용한다
3. **Gate Guard (가이드라인)**: 파이프라인 이탈 시 강제 복귀시킨다. 무시/우회/변형 불가
4. **커스텀 CLI**: Bash 대신 Vela의 독자 CLI 도구를 사용한다
5. **TreeNode 캐시**: 읽기전용 탐색 결과를 SQLite로 캐싱해서 재탐색을 방지한다
6. **훅 제어**: 모든 행위는 훅을 통해 무조건 제어된다

## /vela:vela-init — 환경 구축

이 커맨드가 호출되면 현재 프로젝트에 Vela 환경을 구축한다.

### 초기화 절차

1. **언어 선택 질문**
   사용자에게 CLI 도구의 스크립트 언어를 질문한다 (Node.js 또는 Python).
   가장 빠른 처리가 가능한 것을 추천하되 최종 선택은 사용자가 한다.

2. **디렉토리 구조 생성**
   프로젝트 루트에 `.vela/` 디렉토리를 생성한다:
   ```
   .vela/
   ├── config.json              ← Vela 설정
   ├── hooks/                   ← 훅 스크립트
   │   ├── vela-gate-keeper.js  ← 수문장 (PreToolUse)
   │   ├── vela-gate-guard.js   ← 가이드라인 (PreToolUse)
   │   ├── vela-orchestrator.js ← 상태주입 (UserPromptSubmit)
   │   ├── vela-tracker.js      ← 추적기 (PostToolUse)
   │   └── shared/
   │       ├── constants.js
   │       └── pipeline.js
   ├── cli/                     ← 커스텀 CLI 도구
   │   ├── vela-engine.js       ← 파이프라인 엔진
   │   ├── vela-read.js         ← 읽기 도구
   │   └── vela-write.js        ← 쓰기 도구
   ├── cache/                   ← TreeNode SQLite 캐시
   │   └── treenode.js          ← 캐시 관리자
   ├── templates/
   │   └── pipeline.json        ← 파이프라인 정의
   └── artifacts/               ← 파이프라인 실행 산출물
   ```

3. **스크립트 배포**
   이 스킬의 `scripts/` 디렉토리에 있는 파일들을 `.vela/`로 복사한다:
   - `scripts/hooks/*` → `.vela/hooks/`
   - `scripts/cli/*` → `.vela/cli/`
   - `scripts/cache/*` → `.vela/cache/`
   - `scripts/install.js` → `.vela/install.js`
   - `templates/*` → `.vela/templates/`

4. **훅 등록**
   `.vela/install.js`를 실행하여 Claude Code의 `~/.claude/settings.json`에 훅을 등록한다:
   ```bash
   node .vela/install.js
   ```

5. **훅 검증**
   ```bash
   node .vela/install.js verify
   ```

6. **초기화 확인**
   사용자에게 설치 결과를 보고한다.

### 없는 도구 생성 프로토콜

파이프라인 실행 중 필요한 CLI 도구가 없을 경우:
1. 사용자에게 "이 도구가 필요합니다. 만들어도 될까요?" 질문
2. 사용자가 승인하면 언어 선택 질문 (Node.js vs Python, 속도 기준 추천)
3. 도구 생성 후 `.vela/cli/`에 배치
4. 사용법을 사용자에게 안내

---

## 파이프라인 시스템

모든 작업은 크기와 관계없이 파이프라인을 따른다. 간단한 한 줄 수정도 예외 없이 파이프라인을 통과한다.

### 파이프라인 종류

| 종류 | 단계 | 조건 |
|------|------|------|
| **standard** | init → research → plan → plan-check → checkpoint → **branch** → execute → verify → **commit** → finalize | 6+ 파일, 300+ 라인 |
| **quick** | init → plan → execute → verify → **commit** → finalize | 3 파일 이하, 100 라인 이하 |
| **trivial** | init → execute → **commit** → finalize | 1 파일, 10 라인 이하 |

규모는 요청 내용을 분석하여 자동 감지한다.

### 각 단계의 모드

| 단계 | 모드 | 팀 | 설명 |
|------|------|-----|------|
| init | read | — | 초기화, git 상태 스냅샷, dirty tree 체크 |
| research | read | Researcher → Leader | 프로젝트 분석, TreeNode 캐싱, Leader 검증 |
| plan | write | Planner → Leader | 구현 계획 작성, Leader 검증 |
| plan-check | read | — | 계획 검증 (plan-check.md 생성) |
| checkpoint | read | — | 사용자 승인 대기 |
| **branch** | read | — | feature 브랜치 생성 (git) |
| execute | readwrite | Executor → Leader | 구현 (팀 실행), Leader 승인 |
| verify | read | — | 독립 검증 |
| **commit** | read | — | 변경사항 원자적 커밋 (git) |
| finalize | write | — | 보고서 생성, 선택적 PR |

### 엔진 명령어

모든 파이프라인 조작은 엔진 CLI를 통해서만 이루어진다:

```bash
node .vela/cli/vela-engine.js init "작업 설명"     # 파이프라인 시작 (git 상태 체크)
node .vela/cli/vela-engine.js state                 # 현재 상태
node .vela/cli/vela-engine.js transition            # 다음 단계로 전이
node .vela/cli/vela-engine.js dispatch --role ROLE  # 에이전트 스펙 조회
node .vela/cli/vela-engine.js record pass           # 결과 기록
node .vela/cli/vela-engine.js branch                # 브랜치 생성 (branch 단계)
node .vela/cli/vela-engine.js commit                # 변경사항 커밋 (commit 단계)
node .vela/cli/vela-engine.js sub-transition         # execute sub-phase 전진
node .vela/cli/vela-engine.js cancel                # 파이프라인 취소 (복구 안내 포함)
```

---

## 아키텍처 기반 개발 (Standard Pipeline)

Standard 파이프라인에서는 추상적 원칙("Clean Architecture를 따라라")이 아닌
**구체적 설계 명세서**를 기반으로 개발한다.

### Plan 단계 — 구체적 명세서 작성

Planner는 plan.md에 반드시 다음 섹션을 포함해야 한다.
**섹션이 없거나 200bytes 미만이면 엔진이 transition을 차단한다.**

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
# sub-phase 확인
node .vela/cli/vela-engine.js state

# sub-phase 전진
node .vela/cli/vela-engine.js sub-transition
```

### 2단계 검증 — Reviewer Subagent → Leader

같은 세션의 Leader는 Worker의 맥락에 영향받아 형식적 approve를 하는 경향이 있다.
이를 방지하기 위해 **독립 Reviewer subagent**를 먼저 소환하여 구조적 품질을 점검한다.

#### 검증 흐름

```
Worker 작업 완료 (plan.md 또는 코드)
  → PM이 Reviewer subagent 소환 (Agent 도구 사용, 독립 컨텍스트)
     → Reviewer는 산출물만 읽고 아키텍처 품질 리포트 생성
     → review-{step}.md 아티팩트로 저장
  → PM이 Leader에게 Reviewer 리포트 전달
  → Leader: Reviewer 발견사항 + 프로젝트 맥락을 고려하여 판단
     ├─ Reviewer가 critical 이슈 발견 → reject하거나, 무시 근거를 기록
     └─ approve/reject 결정
```

#### Reviewer Subagent 소환 방법

PM이 Agent 도구로 Reviewer를 소환할 때 다음 프롬프트를 사용한다:

```
"You are an INDEPENDENT ARCHITECTURE REVIEWER.
Read {artifact_path} and evaluate against Clean Architecture, DDD, OOP, TDD.
Produce a structured review: Layer Separation (X/5), DDD Patterns (X/5),
SOLID Principles (X/5), Test Strategy (X/5), Class Spec Completeness (X/5).
List specific issues ranked by severity (critical/high/medium/low).
Save review to {artifact_dir}/review-{step}.md.
Be HARSH and CRITICAL."
```

Reviewer는 **Worker의 사고 과정을 모른 채** 산출물만 평가하므로 편향 없는 독립 판단이 가능하다.

#### Leader의 책임

Leader는 Reviewer 리포트를 읽은 후:
- Reviewer가 찾은 **critical/high 이슈**에 대해 반드시 입장을 표명해야 함
- approve 시 review-{step}.md에 Leader의 판단 근거를 추가해야 함
- review-{step}.md가 없으면 엔진이 transition을 차단함

이 2단계 구조는 plan 단계와 execute 단계 모두에 적용된다.

---

## Git 형상관리

Vela는 파이프라인에 git 형상관리를 통합한다.

### Init 시 Git 상태 체크

파이프라인 시작 시 자동으로:
1. git 저장소 여부 확인
2. 현재 브랜치, base branch, HEAD hash 기록
3. **dirty tree 차단** — 미커밋 변경이 있으면 파이프라인 시작 불가 (`--force`로 스킵 가능)
4. `.gitignore`에 `.vela/` 내부 파일 자동 추가 (ghost commit 방지)

### Branch 단계

checkpoint 승인 후, execute 전에 feature 브랜치를 생성한다.

```bash
node .vela/cli/vela-engine.js branch              # auto 모드 (기본)
node .vela/cli/vela-engine.js branch --mode prompt # 명령어만 제안
node .vela/cli/vela-engine.js branch --mode none   # 브랜치 생성 안함
```

- 브랜치명: `vela/<slug>-<HHMM>` (예: `vela/api-보안-강화-1358`)
- 보호 브랜치(main/master/develop)에 있을 때만 생성
- 이미 feature 브랜치에 있으면 현재 브랜치 유지
- 비-코드 작업(분석, 문서)은 스킵

### Commit 단계

verify 완료 후 변경사항을 원자적으로 커밋한다.

```bash
node .vela/cli/vela-engine.js commit              # 자동 메시지 생성
node .vela/cli/vela-engine.js commit --message "custom message"
```

- **Conventional Commits** 포맷 자동 적용:
  `feat(slug): 설명` / `fix(slug): 설명` / `refactor(slug): 설명`
- 커밋 본문에 파이프라인 참조 포함 (`Vela-Pipeline: <artifact-dir>`)
- `.vela/` 내부 파일은 커밋에서 자동 제외
- `diff.patch` 아티팩트 자동 생성
- commit hash를 pipeline-state.json에 기록

### Cancel 시 복구

파이프라인 취소 시 체크포인트 hash와 복구 명령어를 안내한다:
- `git diff <checkpoint>..HEAD` — 파이프라인 중 변경 확인
- `git checkout <base-branch> && git branch -d <pipeline-branch>` — 브랜치 정리

### Gate Guard Git 규칙

| 가드 | 규칙 |
|------|------|
| GUARD 7 | execute/commit/finalize 단계에서만 `git commit` 허용 |
| GUARD 8 | verify 완료 전 `git push` 차단 |
| GUARD 9 | 보호 브랜치 직접 커밋 경고 |

### Permission Deny 규칙 (절대 차단)

- `git push --force/--force-with-lease/-f`, `git push origin +*`
- `git reset --hard`
- `git commit --no-verify/-n`
- `git clean -f/-fd`

---

## 팀 메커니즘

Research, Plan, Execute 단계에서 **팀 기반 실행**이 활성화된다.
Worker → Reviewer(독립 subagent) → Leader(최종 판단) 3단계 검증 구조.

### 팀 구성

| 역할 | 실행 방식 | 책임 |
|------|----------|------|
| **PM** | 같은 세션 | 파이프라인 조율, Worker/Reviewer/Leader 소환 |
| **Vela-Researcher** | 같은 세션 | 프로젝트 분석, research.md 작성 |
| **Vela-Planner** | 같은 세션 | 아키텍처 설계, 클래스 명세서, plan.md 작성 |
| **Vela-Executor** | 같은 세션 | 코드 구현, 테스트 작성 |
| **Vela-Reviewer** | **독립 subagent** | 산출물 품질 점검 (편향 없는 독립 평가) |
| **Vela-Leader** | 같은 세션 | Reviewer 리포트 기반 최종 approve/reject |

### 공통 실행 루프

모든 팀 단계는 동일한 패턴을 따른다:

```
PM → Worker 소환 (작업 지시)
     → Worker 작업 수행 (research.md / plan.md / 코드 수정)
     → PM → Reviewer subagent 소환 (Agent 도구, 독립 컨텍스트)
          → Reviewer: 산출물만 읽고 품질 리포트 생성 → review-{step}.md
     → PM → Leader 소환 (Reviewer 리포트 전달)
     → Leader: Reviewer 발견사항 + 맥락 고려하여 판단
         ├─ 승인(approve) → 단계 완료, 다음 단계로 전이
         └─ 거부(reject) → 피드백과 함께 Worker 재지시
```

### 팀 명령어

```bash
# ─── Research 단계 ───
node .vela/cli/vela-engine.js team-dispatch researcher    # Researcher 소환
node .vela/cli/vela-engine.js team-record researcher pass # Researcher 완료
node .vela/cli/vela-engine.js team-dispatch leader        # Leader 검토
node .vela/cli/vela-engine.js team-record leader approve  # 충분함 → 통과
node .vela/cli/vela-engine.js team-record leader reject --feedback "보안 취약점 분석 누락"

# ─── Plan 단계 ───
node .vela/cli/vela-engine.js team-dispatch planner       # Planner 소환
node .vela/cli/vela-engine.js team-record planner pass    # Planner 완료
node .vela/cli/vela-engine.js team-dispatch leader        # Leader 검토
node .vela/cli/vela-engine.js team-record leader approve  # 계획 충분 → 통과
node .vela/cli/vela-engine.js team-record leader reject --feedback "에러 핸들링 계획 누락"

# ─── Execute 단계 ───
node .vela/cli/vela-engine.js team-dispatch executor      # Executor 소환
node .vela/cli/vela-engine.js team-record executor pass   # Executor 완료
node .vela/cli/vela-engine.js team-dispatch leader        # Leader 검토
node .vela/cli/vela-engine.js team-record leader approve  # 구현 승인
node .vela/cli/vela-engine.js team-record leader reject --feedback "테스트 누락"
```

Leader가 거부하면 Worker의 상태가 standby로 리셋되고, 피드백을 반영하여 재작업한다.
Leader가 승인해야만 해당 단계를 완료하고 다음으로 전이할 수 있다.

---

## Gate Keeper (수문장)

Gate Keeper는 PreToolUse 훅으로 실행되며, 모든 도구 호출 전에 검증한다.

### 게이트 규칙

| 게이트 | 규칙 | 동작 |
|--------|------|------|
| GATE 1 | Bash 차단 | Vela CLI 명령 외 Bash 사용 차단. 읽기 모드에서 안전한 명령(ls, git status 등)만 허용 |
| GATE 2 | 모드 강제 | 읽기전용 모드에서 Write/Edit 차단. `.vela/` 내부 파일은 예외 |
| GATE 3 | 민감파일 보호 | .env, credentials.json 등 민감 파일 쓰기 차단 |
| GATE 4 | 시크릿 감지 | API 키, 토큰, 비밀키 등 15개 패턴 감지 시 쓰기 차단 |
| GATE 5 | 경로 경고 | node_modules 등 제외 경로 쓰기 시 경고 |

### 모드별 허용 도구

| 모드 | 허용 | 차단 |
|------|------|------|
| read | Read, Glob, Grep, Agent | Edit, Write, NotebookEdit, Bash(쓰기) |
| write | Read, Write, Edit, NotebookEdit, Glob, Grep | Bash |
| readwrite | Read, Write, Edit, NotebookEdit, Glob, Grep, Agent | Bash(제한적) |

---

## Gate Guard (가이드라인)

Gate Guard는 파이프라인 순서를 강제한다. 이 가이드라인은 **무시, 우회, 변형이 불가**하다.

### 가드 규칙

| 가드 | 규칙 |
|------|------|
| GUARD 1 | research.md 없이 plan.md 작성 불가 |
| GUARD 2 | execute 단계 전 소스코드 수정 불가 |
| GUARD 3 | 빌드/테스트 실패 시 git commit 불가 |
| GUARD 4 | verification.md 없이 report.md 작성 불가 |
| GUARD 5 | pipeline-state.json 직접 수정 불가 (엔진만 수정) |
| GUARD 6 | 단계별 리비전 한도 초과 시 차단 |

---

## 커스텀 CLI

Vela는 Bash 대신 독자 CLI를 사용한다.

### vela-read (읽기)

```bash
node .vela/cli/vela-read.js <파일경로>                   # 파일 읽기
node .vela/cli/vela-read.js <파일경로> --lines 50         # 처음 50줄
node .vela/cli/vela-read.js --glob "**/*.ts"              # 패턴 검색
node .vela/cli/vela-read.js --grep "패턴" --ext js,ts     # 내용 검색
node .vela/cli/vela-read.js --tree --depth 3              # 디렉토리 구조
node .vela/cli/vela-read.js --cached                      # 캐시된 경로 조회
```

### vela-write (쓰기)

```bash
node .vela/cli/vela-write.js <파일경로> --content "내용"  # 파일 작성
node .vela/cli/vela-write.js <파일경로> --stdin           # stdin으로 내용 전달
node .vela/cli/vela-write.js <파일경로> --edit --old "원본" --new "수정"  # 부분 수정
node .vela/cli/vela-write.js --mkdir <디렉토리>           # 디렉토리 생성
```

모든 쓰기는 원자적(atomic)으로 수행되며 `.vela/write-log.jsonl`에 로깅된다.

---

## TreeNode 캐시

읽기전용 모드에서 탐색한 파일 경로를 SQLite에 저장한다.
다음 탐색 시 처음부터 찾지 않고 캐시된 경로를 활용한다.

```bash
node .vela/cache/treenode.js ingest              # 대기 경로 SQLite 반영
node .vela/cache/treenode.js query src/           # 접두사로 검색
node .vela/cache/treenode.js stats                # 캐시 통계
node .vela/cache/treenode.js clear                # 캐시 초기화
node .vela/cache/treenode.js export               # 전체 경로 내보내기
```

읽기전용 모드에서는 리포트 생성이 불필요하다. TreeNode 캐시만 갱신한다.

---

## 훅 시스템

모든 행위는 Claude Code 훅을 트리거로 하여 Vela 훅이 제어한다.
훅은 **프로젝트 로컬** (`.claude/settings.local.json`)에 등록되어
해당 프로젝트에서만 작동한다. 다른 프로젝트에 영향을 주지 않는다.

| 훅 | 이벤트 | 역할 |
|----|--------|------|
| vela-gate-keeper | PreToolUse | 모드 기반 R/W 접근 통제 |
| vela-gate-guard | PreToolUse | 파이프라인 준수 강제 |
| vela-orchestrator | UserPromptSubmit | 매 턴 파이프라인 상태 주입 |
| vela-tracker | PostToolUse | 행위 추적, 캐시 갱신, 신호 감지 |

### Permission 규칙 (이중 방어)

훅과 별도로 Claude Code의 permission 시스템으로 위험한 명령을 차단한다.
deny 규칙은 **절대적** — 어떤 범위에서든 deny되면 허용 불가.

**차단 (deny)**:
- `rm -rf`, `rm -r` — 파괴적 삭제
- `git push --force`, `git push -f` — 공유 히스토리 파괴
- `git reset --hard` — 미커밋 작업 손실
- `git commit --no-verify` — Vela 훅 우회 방지
- `DROP DATABASE` — 데이터베이스 삭제

**허용 (allow)**:
- `node .vela/*`, `python .vela/*` — Vela CLI 도구

### 훅 관리

```bash
node .vela/install.js              # 훅 + permission 설치
node .vela/install.js verify       # 설치 검증
node .vela/install.js uninstall    # 훅 + permission 제거
node .vela/install.js status       # 현재 상태
```

---

## Vela 안에서의 작업 흐름

Vela 환경이 구축된 프로젝트에서 Claude Code가 따라야 하는 작업 흐름:

1. 사용자 요청 수신
2. `vela-engine init "요청 내용"` 으로 파이프라인 시작
3. 엔진이 반환한 파이프라인 종류와 현재 단계 확인
4. 현재 단계의 모드에 맞는 도구만 사용
5. 단계 완료 조건 충족 후 `vela-engine transition` 으로 다음 단계 전이
6. execute 단계에서는 팀 메커니즘(PM → Executor → Leader) 활용
7. 모든 단계 완료 시 파이프라인 자동 종료

파이프라인 외부에서의 프로젝트 파일 수정은 Gate Guard가 차단한다.
