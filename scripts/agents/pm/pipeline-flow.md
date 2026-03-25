# 파이프라인 운영 흐름 — 단계를 절대 건너뛰지 않는다

## Standard Pipeline (large)

```
1. TeamCreate: team_name "vela-pipeline"

[Research] — Teammate (Opus)
2. Researcher teammate 3명 소환 (model: "opus", team_name):
   - "security-researcher" / "architecture-researcher" / "quality-researcher"
   - 소통: ① 가설 공유 ② 반박 증거 교차 검증 ③ 가설 제거
3. PM이 3개 리포트를 종합하여 research.md 작성
4. Reviewer subagent (model: "sonnet") → review-research.md
5. PM이 review 읽고 approve/reject 판단

[Plan] — Subagent (Opus)
6. Planner subagent (model: "opus") → plan.md
7. Reviewer subagent (model: "sonnet") → review-plan.md
8. PM approve/reject

[Execute — 단일 모듈] — Subagent (Sonnet)
9. Executor subagent (model: "sonnet") → 코드 구현
10. Reviewer subagent → review-execute.md
11. PM approve/reject

[Execute — CrossLayer/다중 모듈] — Teammate (Sonnet) + Wave 병렬
9. `node .vela/cli/vela-engine.js wave-plan` 실행 → Wave 그룹 확인
10. Wave별로 Teammate 소환:
    - Wave 1: 의존성 없는 팀원 → 병렬 실행
    - Wave 2: Wave 1 완료 후 → 의존 팀원 실행
    - 각 팀원: model "sonnet", team_name, isolation "worktree"
11. Reviewer subagent → review-execute.md
12. PM approve/reject

12. TeamDelete
```

## Quick Pipeline (medium)
Plan: Planner subagent (Opus) + Reviewer subagent (Sonnet)
Execute: Executor subagent (Sonnet) + Reviewer subagent (Sonnet)
팀 소환 없음.

## Trivial Pipeline (small)
PM 직접 수행. 에이전트 소환 없음. 소스 코드 직접 접근 허용.

## Ralph Pipeline
execute → verify 자동 반복 (최대 10회).

## 자동 디버깅 — 테스트 실패 시 반드시 실행

테스트가 실패하면 같은 Executor를 재시도하지 **않는다**.
**반드시 Debugger 에이전트를 소환**하여 근본 원인을 분석한다.

### 디버깅 흐름
```
테스트 실패
  ↓
Debugger subagent 소환 (model: "opus")
  ↓
근본 원인 분석 → 최소 수정 → 테스트 재실행
  ↓
성공 → 계속 / 실패(3회) → 사용자에게 보고
```

### Debugger 소환 프롬프트
```xml
<task>
  <role>debugger</role>
  <model>opus</model>
  <files>{실패한 파일}</files>
  <action>
    에러: {에러 메시지}
    스택: {스택 트레이스}
    .vela/agents/debugger/index.md를 읽고 진단 절차를 따르세요.
  </action>
  <verify>{테스트 명령어}</verify>
  <done>모든 테스트 통과 + debug-report.md 작성</done>
</task>
```

### 디버깅 vs 에스컬레이션 구분
| 상황 | 대응 |
|------|------|
| 테스트 실패 | **Debugger 소환** (근본 원인 분석) |
| 산출물 없음 | **모델 에스컬레이션** (상위 모델 재시도) |
| 컨텍스트 초과 | **모델 에스컬레이션** |
| 런타임 에러 | **Debugger 소환** |

## PM 승인 기준
- **APPROVE**: Reviewer 점수 20+/25, CRITICAL 0개
- **REJECT**: CRITICAL/HIGH 미해결

## UI 템플릿
모든 AskUserQuestion은 `.vela/references/interactive-ui.md`에서 읽어라.
