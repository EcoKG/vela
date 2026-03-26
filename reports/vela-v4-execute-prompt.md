# Vela v4 리팩토링 — 실행 프롬프트

다음 두 파일을 읽고 작업을 진행하라:

1. `/home/starlyn/Vela-workspace/vela/reports/vela-v4-redesign-report.md` — 재설계 분석 (왜, 무엇을)
2. `/home/starlyn/Vela-workspace/vela/reports/vela-v4-subagent-prompt.md` — 구현 상세 (어떻게)

두 파일을 모두 읽은 후 아래 실행 순서대로 작업한다.

---

## 워킹 디렉토리

`/home/starlyn/Vela-workspace/vela/`

---

## 실행 순서

### Step 1 — 슬래시 명령어 생성
`~/.claude/commands/vela/` 디렉토리에 다음 파일 생성:
`start.md`, `discuss.md`, `plan.md`, `execute.md`, `verify.md`, `ship.md`, `next.md`, `status.md`, `pause.md`, `resume.md`, `quick.md`

각 파일은 `.vela/agents/vela.md`를 읽고 해당 단계를 실행하도록 지시한다.
`$ARGUMENTS`로 인자(phase 번호, 플래그)를 받는다.

### Step 2 — 신규 에이전트 파일 작성
- `scripts/agents/synthesizer/index.md` — researcher 결과들을 종합해 단일 research.md 생성
- `scripts/agents/pm/git-strategy.md` — 태스크 단위 커밋 규칙, ship(PR) 규칙, 릴리스 태그 전략

### Step 3 — PM 에이전트 수정 (`scripts/agents/vela.md`)
- TeamCreate, TeamDelete, SendMessage 관련 내용 완전 제거
- 파일 기반 소통으로 교체 (에이전트가 `.vela/artifacts/`에 파일 쓰고 PM이 읽음)
- git-strategy.md 참조 추가
- pause/resume(HANDOFF.json) 처리 추가

### Step 4 — 파이프라인 흐름 교체 (`scripts/agents/pm/pipeline-flow.md`)
discuss → plan → execute → verify → ship 흐름으로 완전 교체.
git 커밋 시점, HANDOFF.json, `--full` 플래그 동작 포함.

### Step 5 — 팀 규칙 단순화 (`scripts/agents/pm/team-rules.md`)
Teammate 관련 섹션 완전 제거. Subagent 전용으로 단순화.

### Step 6 — 에이전트 파일 수정
- `scripts/agents/researcher/index.md` — 결과를 `{N}-research-{X}.md`로 파일 출력
- `scripts/agents/planner/index.md` — `{N}-plan.xml` 포맷으로 출력
- `scripts/agents/executor/index.md` — 태스크 완료 즉시 git commit, `{N}-{M}-summary.md` 출력

### Step 7 — 불필요 파일 삭제
- `scripts/agents/reviewer/` 전체
- `scripts/agents/conflict-manager/` 전체
- `scripts/agents/conflict-manager.md`
- `scripts/agents/leader.md`
- `scripts/agents/executor/file-ownership.md`
- `scripts/agents/executor/worktree.md`

### Step 8 — SKILL.md 수정
`SKILL.md`와 `skills/start/SKILL.md`가 슬래시 명령어(`~/.claude/commands/vela/`)로 위임하도록 수정.

### Step 9 — vela-engine.js 단계명 추가
discuss, plan, execute, verify, ship 단계명을 지원하도록 최소 수정.

---

## 검증 기준

작업 완료 후 반드시 확인:
- [ ] `~/.claude/commands/vela/start.md` 존재 (슬래시 명령어 인식)
- [ ] `scripts/agents/vela.md`에 TeamCreate, SendMessage, TeamDelete 없음
- [ ] `scripts/agents/pm/pipeline-flow.md`에 discuss→plan→execute→verify→ship 흐름 있음
- [ ] `scripts/agents/executor/index.md`에 git commit 지시 있음
- [ ] `scripts/agents/synthesizer/index.md` 존재
- [ ] `scripts/agents/pm/git-strategy.md` 존재
- [ ] `scripts/agents/reviewer/` 삭제됨
- [ ] `scripts/agents/conflict-manager/` 삭제됨
- [ ] `scripts/hooks/` 변경 없음 (훅은 건드리지 않음)

---

## 주의사항

- `scripts/hooks/` 는 절대 수정하지 않는다 — Gate Keeper, Gate Guard 등 유지
- `scripts/cli/vela-engine.js` 는 최소한의 수정만 (단계명 추가 외 변경 없음)
- `scripts/agents/pm/model-strategy.md`, `block-recovery.md`, `prompt-optimizer.md` 변경 없음
- `scripts/agents/debugger/` 변경 없음
- `scripts/agents/researcher/` 하위 MD들(architecture, security, quality, hypothesis) 변경 없음
