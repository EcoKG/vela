# Vela v4 리팩토링 — Subagent 실행 프롬프트

## 컨텍스트

당신은 Vela v3를 v4로 리팩토링하는 작업을 수행한다.
Vela는 Claude Code용 샌드박스 개발 파이프라인 시스템이다.
워킹 디렉토리: `/home/starlyn/Vela-workspace/vela/`

## 핵심 목표

1. **슬래시 명령어 등록** — `~/.claude/commands/vela/` 에 GSD 스타일 명령어 파일 생성
2. **Teammates 완전 제거** — SendMessage/TeamCreate/TeamDelete 전부 제거
3. **파일 기반 에이전트 소통** — 에이전트가 `.vela/artifacts/` 에 MD/XML 파일로 결과 작성
4. **Clean Context** — 각 Subagent가 필요한 파일만 읽어 독립적으로 실행
5. **태스크 단위 원자적 커밋** — executor가 태스크 완료 즉시 git commit
6. **`/vela:ship`** — 산출물 기반 PR 자동 생성
7. **세션 연속성** — HANDOFF.json + SUMMARY.md git 커밋

---

## 현재 구조 (v3) — 읽기 전에 반드시 파악

```
vela/
├── SKILL.md                          # 메인 스킬 (수정 대상)
├── skills/
│   ├── init/SKILL.md                 # init 명령어
│   └── start/SKILL.md                # start 명령어 (수정 대상)
├── scripts/
│   ├── agents/
│   │   ├── vela.md                   # PM 에이전트 (핵심 수정 대상)
│   │   ├── vela-pm.md
│   │   ├── pm/
│   │   │   ├── pipeline-flow.md      # 파이프라인 흐름 (교체 대상)
│   │   │   ├── team-rules.md         # 팀 규칙 (Teammate 제거)
│   │   │   ├── model-strategy.md
│   │   │   ├── block-recovery.md
│   │   │   └── prompt-optimizer.md
│   │   ├── researcher/
│   │   │   ├── index.md              # 수정: 파일 출력 방식으로
│   │   │   ├── architecture.md
│   │   │   ├── hypothesis.md
│   │   │   ├── quality.md
│   │   │   └── security.md
│   │   ├── planner/
│   │   │   ├── index.md              # 수정: XML 산출물 출력
│   │   │   ├── crosslayer.md
│   │   │   ├── spec-format.md
│   │   │   └── index.md
│   │   ├── executor/
│   │   │   ├── index.md              # 수정: summary.md 출력
│   │   │   ├── file-ownership.md     # 삭제 (Teammate 없으면 불필요)
│   │   │   ├── tdd.md
│   │   │   └── worktree.md           # 삭제
│   │   ├── reviewer/                 # 완전 삭제
│   │   ├── conflict-manager/         # 완전 삭제
│   │   ├── conflict-manager.md       # 삭제
│   │   └── leader.md                 # 삭제
│   ├── cli/
│   │   └── vela-engine.js            # 새 단계 전이 지원 추가
│   └── hooks/                        # 유지 (변경 없음)
└── templates/                        # 확인 후 필요시 수정
```

---

## 목표 구조 (v4)

### 1. 슬래시 명령어 (`~/.claude/commands/vela/`)

각 파일은 Claude Code 슬래시 명령어로 동작한다.
`$ARGUMENTS` 로 인자를 받는다.

**생성할 파일:**

```
~/.claude/commands/vela/
  start.md      → /vela:start "작업설명"
  discuss.md    → /vela:discuss 1
  plan.md       → /vela:plan 1
  execute.md    → /vela:execute 1
  verify.md     → /vela:verify 1
  ship.md       → /vela:ship 1 [--draft]
  next.md       → /vela:next
  status.md     → /vela:status
  pause.md      → /vela:pause
  resume.md     → /vela:resume
  quick.md      → /vela:quick "작업설명"
```

각 명령어 파일 내용은 `.vela/agents/vela.md` (PM)를 읽고 해당 단계를 실행하도록 지시한다.

**명령어 파일 포맷 예시 (`start.md`):**
```markdown
---
description: "⛵ Vela 파이프라인 시작"
---

프로젝트 루트의 `.vela/agents/vela.md`를 읽고 start 절차를 실행한다.
작업 내용: $ARGUMENTS
```

### 2. 새 파이프라인 흐름 (`pipeline-flow.md` 교체)

```
[Discuss]
  PM ↔ 사용자 대화
  산출물: .vela/artifacts/{N}-context.md

[Plan]
  Subagent(researcher-A) 읽음: {N}-context.md → 씀: {N}-research-A.md  ┐ 병렬
  Subagent(researcher-B) 읽음: {N}-context.md → 씀: {N}-research-B.md  ┘
  (researcher 1개면 synthesizer 생략)
  Subagent(synthesizer)  읽음: {N}-research-*.md → 씀: {N}-research.md
  Subagent(planner)      읽음: {N}-context.md + {N}-research.md → 씀: {N}-plan.xml

[Execute]
  vela-engine.js로 Wave 분석 → {N}-plan.xml 파싱
  Wave별 Subagent(executor) 병렬/순차 실행
  각 executor:
    1. 읽음 {N}-plan.xml 해당 task
    2. 코드 구현
    3. git add + git commit (태스크 완료 즉시)
       커밋 메시지: feat({N}-{M}): {task 설명}
    4. 씀: {N}-{M}-summary.md (무슨 작업, 변경된 파일, 커밋 해시)

[Verify]
  Subagent(verifier) 읽음: {N}-*.summary.md → 씀: {N}-verification.md
  사용자 확인 → /vela:next

[Ship]
  PM 읽음: {N}-context.md + {N}-verification.md
  → PR 본문 자동 생성 (작업 설명, 변경 사항, 검증 결과)
  → gh pr create 실행

[Milestone Complete]
  → git tag v{milestone} 자동 생성
  → 아티팩트 아카이브
```

### git 커밋 규칙
```
태스크 커밋:    feat({phase}-{task}): {설명}
                fix({phase}-{task}): {설명}
                docs({phase}-{task}): {설명}

SUMMARY 커밋:   docs({phase}): add execution summary

마일스톤 태그:  v1.0.0, v1.1.0 ...
```

**SUMMARY.md는 반드시 git에 커밋한다** — 다음 세션 Claude가 이 파일을 읽어 이전 작업 컨텍스트를 복원할 수 있게 하기 위함.

### HANDOFF.json (pause/resume)
```json
{
  "phase": 2,
  "step": "execute",
  "wave": 1,
  "completed_tasks": ["2-1", "2-2"],
  "pending_tasks": ["2-3"],
  "artifacts": [".vela/artifacts/2-context.md", ".vela/artifacts/2-plan.xml"],
  "last_commit": "abc123f",
  "paused_at": "2026-03-26T15:00:00Z"
}
```
`/vela:pause` → HANDOFF.json 작성
`/vela:resume` → HANDOFF.json 읽어 중단된 지점부터 재개

### 3. 아티팩트 구조

```
.vela/artifacts/
  {N}-context.md          (discuss 산출물)
  {N}-research-A.md       (researcher 산출물)
  {N}-research-B.md
  {N}-research.md         (synthesizer 종합)
  {N}-plan.xml            (planner 산출물)
  {N}-{M}-summary.md      (executor 산출물 — git 커밋됨)
  {N}-verification.md     (verifier 산출물)
  HANDOFF.json            (pause 시 생성, resume 시 소비)
```

### 4. plan.xml 구조

```xml
<plan phase="1">
  <context>1-context.md 요약</context>
  <tasks>
    <task id="1" wave="1" depends="">
      <files>src/auth/jwt.js</files>
      <action>JWT 검증 미들웨어 구현</action>
      <verify>npm test -- --grep "auth"</verify>
      <done>인증 테스트 통과 + 1-1-summary.md 작성</done>
    </task>
    <task id="2" wave="1" depends="">
      <files>src/models/user.js</files>
      <action>User 모델 구현</action>
      <verify>npm test -- --grep "user"</verify>
      <done>유저 테스트 통과 + 1-2-summary.md 작성</done>
    </task>
    <task id="3" wave="2" depends="1,2">
      <files>src/api/auth.js</files>
      <action>인증 API 엔드포인트 구현</action>
      <verify>npm test -- --grep "api"</verify>
      <done>API 테스트 통과 + 1-3-summary.md 작성</done>
    </task>
  </tasks>
</plan>
```

---

## 변경 결정 사항

### 완전 제거 (파일 삭제)
- `scripts/agents/reviewer/` 전체
- `scripts/agents/conflict-manager/` 전체
- `scripts/agents/conflict-manager.md`
- `scripts/agents/leader.md`
- `scripts/agents/executor/file-ownership.md`
- `scripts/agents/executor/worktree.md`
- `scripts/agents/pm/team-rules.md` 내 Teammate 관련 섹션

### 수정
- `scripts/agents/vela.md` — Teammate/SendMessage/TeamCreate/TeamDelete 제거, 파일 기반 소통으로 교체, git-strategy.md 참조 추가
- `scripts/agents/pm/pipeline-flow.md` — 위의 새 흐름으로 완전 교체 (ship, pause/resume 포함)
- `scripts/agents/pm/team-rules.md` — Subagent 전용으로 단순화 (Teammate 섹션 제거)
- `scripts/agents/researcher/index.md` — 결과를 파일로 쓰는 방식으로 수정
- `scripts/agents/planner/index.md` — XML 포맷 산출물 출력으로 수정
- `scripts/agents/executor/index.md` — 태스크 완료 즉시 git commit + summary.md 출력으로 수정

### 유지 (변경 없음)
- `scripts/hooks/` 전체 — Gate Keeper, Gate Guard 등
- `scripts/cli/vela-engine.js` — 최소 수정 (새 단계명 추가만)
- `scripts/agents/debugger/` — 그대로 유지
- `scripts/agents/pm/model-strategy.md`
- `scripts/agents/pm/block-recovery.md`
- `scripts/agents/pm/prompt-optimizer.md`
- `scripts/agents/researcher/` 하위 MD들 (architecture, security, quality, hypothesis)

### 옵션 플래그 (vela.md에서 처리)
- `--no-research` → researcher 소환 생략
- `--skip-discuss` → discuss 없이 바로 plan
- `--assumptions` → PM이 가정으로 context.md 작성
- `--auto-verify` → verifier 자동 실행, 사용자 확인 생략
- `--draft` (ship) → draft PR로 생성
- `--full` → 강화 검증 모드 (plan-checker + wave-verify 활성화)

### `--full` 플래그 동작
```
/vela:plan N --full
  → planner 완료 후 Subagent(plan-checker) 소환
  → 읽음: {N}-plan.xml + REQUIREMENTS.md
  → 요구사항 대비 검증, 미달 시 planner 재소환 (최대 2회)

/vela:execute N --full
  → 각 Wave 완료 후 Subagent(mini-verifier) 소환
  → 읽음: 해당 Wave summary.md들
  → 실패 감지 시 Debugger 소환 후 다음 Wave 진행

/vela:quick "작업" --full
  → plan-checker + 실행 후 verifier 자동 실행
```

---

## 실행 순서

1. `~/.claude/commands/vela/` 디렉토리 생성 + 명령어 MD 파일 11개 작성
   (start, discuss, plan, execute, verify, ship, next, status, pause, resume, quick)
2. `scripts/agents/pm/git-strategy.md` 신규 작성 (태스크 커밋 규칙, ship 규칙, 태그 전략)
3. `scripts/agents/synthesizer/index.md` 신규 작성
4. `scripts/agents/vela.md` 수정 (Teammate 제거, 파일 기반 소통, git-strategy 참조)
5. `scripts/agents/pm/pipeline-flow.md` 새 흐름으로 교체 (ship, pause/resume 포함)
6. `scripts/agents/pm/team-rules.md` Teammate 섹션 제거
7. `scripts/agents/researcher/index.md` 수정 (파일 출력)
8. `scripts/agents/planner/index.md` 수정 (XML 출력)
9. `scripts/agents/executor/index.md` 수정 (태스크 완료 즉시 git commit + summary.md)
10. 불필요 파일 삭제 (reviewer, conflict-manager, leader, worktree, file-ownership)
11. `SKILL.md` + `skills/start/SKILL.md` — 슬래시 명령어로 위임하도록 수정
12. `vela-engine.js` discuss/plan/execute/verify/ship 단계명 추가

## 검증 기준
- `/vela:start` 타이핑 시 슬래시 명령어로 인식됨
- `/vela:next` 타이핑 시 다음 단계 자동 감지
- 에이전트 소환 코드에 SendMessage, TeamCreate, TeamDelete 없음
- `.vela/artifacts/` 에 단계별 파일이 생성되는 구조
- execute 단계에서 태스크당 git commit 발생
- `/vela:ship` 실행 시 gh pr create 동작
- 기존 훅 (`scripts/hooks/`) 정상 동작 유지

---

## 참고 파일
- 재설계 분석 리포트: `vela/reports/vela-v4-redesign-report.md`
- GSD 비교 분석: `vela/reports/gsd-analysis.md`
- 현재 파이프라인 흐름: `vela/scripts/agents/pm/pipeline-flow.md`
- 현재 PM 에이전트: `vela/scripts/agents/vela.md`
