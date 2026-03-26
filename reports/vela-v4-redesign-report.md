# Vela v4 재설계 분석 리포트

## 1. 배경 — 왜 바꾸는가

### 현재 Vela (v3)의 문제
- `/vela:start` 하나로 전체가 실행되어 사용자 개입 포인트가 없음
- Teammates + SendMessage 구조로 에이전트 간 컨텍스트 공유 → Context Rot 발생
- TeamCreate/TeamDelete, 매 단계 Reviewer, PM approve/reject 게이트로 인한 복잡도
- `/vela:start` 가 슬래시 명령어로 인식 안 됨 (Skill 시스템 기반이라)

### GSD Pro에서 배운 것
- **Clean Context** — 각 에이전트가 200k 신선한 컨텍스트로 시작
- **파일 기반 소통** — 에이전트 간 SendMessage 없이 MD/XML 파일로 결과 전달
- **단계별 명령어** — 사용자가 각 단계를 직접 트리거 (`/gsd:discuss`, `/gsd:plan`, ...)
- **`/next` 자동 감지** — 다음 단계를 자동으로 파악해서 실행
- **`plan` 안에 research 내장** — 별도 명령어 없이 plan 단계에서 researcher 병렬 소환
- **태스크 단위 원자적 커밋** — executor가 태스크 완료 즉시 커밋 (파이프라인 단위 아님)
- **SUMMARY.md git 커밋** — 실행 결과가 이력에 남아 다음 세션 Claude가 컨텍스트로 활용
- **`/gsd:ship`** — 검증된 작업으로 자동 PR 생성 (산출물 기반 본문 자동 작성)
- **`/gsd:pause-work` / `/gsd:resume-work`** — HANDOFF.json으로 세션 간 작업 연속성
- **마일스톤 완료 시 릴리스 태그** — `complete-milestone`이 git tag 자동 생성

---

## 2. 현재 Vela v3 플로우

```
/vela:start (명령어 1개)
│
├─ TeamCreate
├─ [Research] Teammate×3 (Opus) — SendMessage 교차 검증
│    └─ PM 종합 → research.md
│    └─ Reviewer subagent → review-research.md
│    └─ PM approve/reject
│
├─ [Plan] Planner subagent (Opus)
│    └─ plan.md
│    └─ Reviewer subagent → review-plan.md
│    └─ PM approve/reject
│
├─ [Execute] Executor Teammate (Sonnet) — Wave 병렬
│    └─ 코드 구현
│    └─ Reviewer subagent → review-execute.md
│    └─ PM approve/reject
│
└─ TeamDelete
```

---

## 3. 새 Vela v4 플로우

### 슬래시 명령어 구조
```
~/.claude/commands/vela/
  start.md
  discuss.md
  plan.md
  execute.md
  verify.md
  next.md
  status.md
  quick.md
```

### 단계별 흐름
```
/vela:start "작업설명"
  └─ PM: 규모 선택 → ROADMAP.md, pipeline-state.json 생성

/vela:discuss 1
  └─ PM ↔ 사용자 대화 (회색영역, 요구사항 확정)
  └─ 산출물: .vela/artifacts/1-context.md

/vela:plan 1
  ├─ Subagent(researcher-A) 읽음: 1-context.md  →  씀: 1-research-A.md  ┐ 병렬
  ├─ Subagent(researcher-B) 읽음: 1-context.md  →  씀: 1-research-B.md  ┘
  ├─ Subagent(synthesizer)  읽음: 1-research-*.md  →  씀: 1-research.md
  └─ Subagent(planner)      읽음: 1-context.md + 1-research.md  →  씀: 1-plan.xml

/vela:execute 1
  ├─ Wave 1 (병렬): Subagent(executor-A) + Subagent(executor-B)
  │    각자: 읽음 1-plan.xml 해당 task
  │    → 코드 구현
  │    → git commit (태스크 완료 즉시, 원자적)   ← GSD 방식
  │    → 씀: 1-1-summary.md, 1-2-summary.md
  └─ Wave 2 (순차): Subagent(executor-C)
       읽음: 1-1-summary.md + 1-plan.xml task-3
       → 코드 구현 → git commit → 씀: 1-3-summary.md

/vela:verify 1
  └─ Subagent(verifier) 읽음: 1-*.summary.md + requirements  →  씀: 1-verification.md
  └─ 사람이 직접 확인 후 next

/vela:ship 1
  └─ 산출물(context.md, verification.md) 기반 PR 본문 자동 생성
  └─ gh pr create 실행

/vela:next  →  자동 감지  →  /vela:discuss 2

/vela:milestone-complete
  └─ 마일스톤 아카이브 + git tag v{N} 자동 생성
```

### 아티팩트 구조
```
.vela/artifacts/
  1-context.md          (discuss 산출물)
  1-research-A.md       (researcher-A 산출물)
  1-research-B.md       (researcher-B 산출물)
  1-research.md         (synthesizer 종합)
  1-plan.xml            (planner 산출물 — XML 구조화)
  1-1-summary.md        (executor-A 산출물 — git에 커밋됨)
  1-2-summary.md        (executor-B 산출물 — git에 커밋됨)
  1-verification.md     (verifier 산출물)
  HANDOFF.json          (pause-work 시 생성, resume-work 시 읽음)
```

### git 커밋 전략
```
[execute 단계 — 태스크당 즉시 커밋]
feat(1-1): implement JWT middleware
feat(1-2): add user model
feat(1-3): create auth endpoint
docs(1): add 1-1-summary, 1-2-summary, 1-3-summary

[milestone-complete]
chore: release v1.0.0  ← git tag 자동 생성
```

**장점:**
- `git bisect`로 어느 태스크에서 깨졌는지 정확히 찍어낼 수 있음
- 태스크 단위 독립 revert 가능
- SUMMARY.md가 git 이력에 남아 다음 세션 Claude의 컨텍스트로 활용됨

---

## 4. 변경 결정 사항

### 유지
| 항목 | 이유 |
|---|---|
| Hook 기반 물리 차단 (Gate Keeper/Guard) | Vela만의 강점, GSD에 없음 |
| Wave 병렬 실행 | 검증된 방식, 그대로 유지 |
| Debugger 에이전트 (테스트 실패 시) | 자동 디버깅, 유용 |
| PM 오케스트레이터 구조 | Teammate → Subagent로만 변경 |
| 모델 전략 (Haiku/Sonnet/Opus) | 유지 |
| XML 구조화 태스크 프롬프트 | 유지 |
| Tier 컨텍스트 로딩 | 유지 |

### 옵션 (플래그로 on/off)
| 항목 | 플래그 |
|---|---|
| Research 단계 | `--no-research` |
| Discuss 단계 | `--skip-discuss` 또는 `--assumptions` 모드 |
| Synthesizer 에이전트 | researcher 1개면 자동 생략 |
| Verify 단계 | `--auto-verify` |
| PR 생성 | `--draft` (draft PR) |
| 세션 중단/재개 | `/vela:pause` / `/vela:resume` (HANDOFF.json) |
| 강화 검증 모드 | `--full` (GSD 방식 plan-checker + wave-verify 활성화) |

### `--full` 플래그 상세
기본 모드는 빠르고 단순하게, `--full`이면 검증 강화:

```
/vela:plan 1 --full
  └─ researcher → synthesizer → planner
  └─ + Subagent(plan-checker): 요구사항 대비 plan.xml 검증, 최대 2회 반복

/vela:execute 1 --full
  └─ Wave 완료마다 mini-verify Subagent 실행 → 조기 실패 감지 후 다음 Wave

/vela:quick "작업" --full
  └─ plan-checker 활성화 + 실행 후 verifier 자동 실행
```

### 완전 제거
| 항목 | 이유 |
|---|---|
| Teammates + SendMessage | 파일 기반으로 대체, clean context 달성 |
| TeamCreate / TeamDelete | Teammates 없으면 불필요 |
| 매 단계 Reviewer subagent | `/vela:verify` 단계로 통합 |
| PM approve/reject 게이트 | Hook exit(2)가 이미 물리 차단, 중복 |
| Git Worktree isolation | Teammates 없으면 충돌 위험 없음 |

---

## 5. 현재 vs 새 비교

| | 현재 Vela v3 | 새 Vela v4 |
|---|---|---|
| 사용자 개입 | 시작만 | discuss, verify 단계 |
| 에이전트 소통 | SendMessage | 파일 읽기/쓰기 |
| 컨텍스트 | 공유 (오염 가능) | 각자 clean |
| Reviewer | 매 단계 자동 | verify 단계 통합 |
| 명령어 수 | 1개 (`start`) | 5개 + `next` |
| 중간 방향 수정 | 어려움 | discuss 단계에서 자연스럽게 |
| 명령어 인식 | Skill 트리거 (불안정) | ~/.claude/commands/ 슬래시 명령어 |
| git 커밋 단위 | 파이프라인 단위 | **태스크 단위 (원자적)** |
| PR 생성 | 없음 | `/vela:ship` 자동 생성 |
| 세션 연속성 | 없음 | HANDOFF.json + SUMMARY.md git 이력 |
| 마일스톤 릴리스 | 없음 | git tag 자동 생성 |

---

## 6. 구현 범위

### 신규 생성
1. `~/.claude/commands/vela/` — 슬래시 명령어 MD 파일 10개
   - start, discuss, plan, execute, verify, ship, next, status, pause, resume
2. `scripts/agents/pm/pipeline-flow-v4.md` — 새 파이프라인 흐름
3. `scripts/agents/synthesizer/` — 새 에이전트
4. `scripts/agents/pm/git-strategy.md` — 태스크 단위 커밋 규칙, PR 생성 규칙, 태그 전략

### 수정
1. `scripts/agents/vela.md` — PM 에이전트 (Teammate 제거)
2. `scripts/agents/pm/team-rules.md` — Subagent 전용으로 단순화
3. `scripts/agents/pm/pipeline-flow.md` — 새 흐름으로 교체
4. `scripts/agents/researcher/index.md` — 파일 출력 방식으로 변경
5. `scripts/agents/planner/index.md` — XML 산출물로 변경
6. `scripts/agents/executor/index.md` — summary.md 출력으로 변경
7. `vela-engine.js` — 새 단계 전이 지원
8. `SKILL.md` + `skills/start/SKILL.md` — 슬래시 명령어로 위임

### 삭제
1. `scripts/agents/reviewer/` — 완전 제거
2. `scripts/agents/conflict-manager/` — 완전 제거
3. `scripts/agents/leader.md` — 완전 제거
4. `scripts/agents/pm/team-rules.md` Teammate 관련 섹션

---

## 7. 버전 정보
- 분석일: 2026-03-26
- 현재 버전: Vela v3.0.0
- 목표 버전: Vela v4.0.0
- 참고: [GSD Pro](https://github.com/gsd-build/get-shit-done), [gsd-analysis.md](./gsd-analysis.md)
