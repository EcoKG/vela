# ⛵ Usage Guide

Vela의 핵심 사용법을 실제 워크플로우 순서대로 안내합니다.

---

## 1. 파이프라인 시작

모든 작업은 파이프라인으로 시작합니다.

```bash
vela start "OAuth2 인증 시스템 추가" --scale large
```

### Scale 선택

| Scale | 파이프라인 | 단계 수 | 적합한 작업 |
|-------|-----------|---------|-------------|
| `small` | trivial | 4단계 | 오타 수정, 설정 변경, 단순 버그 |
| `medium` | quick | 6단계 | 명확한 기능 추가, 컴포넌트 작성 |
| `large` | standard | 10단계 | 설계가 필요한 기능, 아키텍처 변경 |

### 파이프라인 흐름

**large (standard):**
```
init → research → plan → plan-check → checkpoint
     → branch → execute → verify → commit → finalize
```

**medium (quick):**
```
init → plan → execute → verify → commit → finalize
```

**small (trivial):**
```
init → execute → commit → finalize
```

### Custom Pipeline Type

```bash
# 빌트인 타입 직접 지정
vela start "Fix login bug" --type trivial

# 커스텀 타입 (.vela/pipelines/review.json)
vela start "Code review" --type review
```

커스텀 파이프라인 파일 예시 (`.vela/pipelines/review.json`):

```json
{
  "name": "review",
  "description": "Code review pipeline",
  "steps": ["init", "research", "execute", "commit", "finalize"],
  "mode_map": {
    "init": "read",
    "research": "read",
    "execute": "readwrite",
    "commit": "readwrite",
    "finalize": "read"
  }
}
```

---

## 2. 파이프라인 관리

### 상태 확인

```bash
vela state
```

출력 (JSON):
```json
{
  "ok": true,
  "pipeline": {
    "id": "abc123",
    "request": "OAuth2 인증 시스템 추가",
    "scale": "large",
    "currentStep": "research",
    "stepIndex": 1,
    "totalSteps": 10,
    "status": "active"
  }
}
```

### 다음 단계로 전이

```bash
vela transition
```

> 전이 조건이 충족되지 않으면 거부됩니다.
> 예: research.md가 없으면 plan 단계로 전이 불가.

### 파이프라인 취소

```bash
vela cancel
```

---

## 3. 3-Tier 계층 관리

### Milestone (프로젝트 단위)

```bash
# 마일스톤 생성
vela milestone create "v1.0 Release" --description "첫 번째 릴리스"

# 목록 조회
vela milestone list

# 완료 (모든 슬라이스가 완료되어야 함)
vela milestone complete MS001
```

### Slice (기능 단위)

```bash
# 슬라이스 생성
vela slice create "User Authentication" --milestone MS001

# 목록 조회
vela slice list --milestone MS001

# 바운더리 맵 설정
vela slice boundary SL001 --inputs "user email, password" --outputs "JWT token"

# 완료 (모든 태스크가 완료되어야 함)
vela slice complete SL001
```

### Task (작업 단위)

```bash
# 태스크 생성
vela task create "Implement JWT signing" --slice SL001

# 목록 조회
vela task list --slice SL001

# 완료 (→ 슬라이스, 마일스톤 자동 완료 가능)
vela task complete TK001
```

> **Cascading Completion:** 마지막 태스크를 완료하면 슬라이스가 자동으로 완료되고, 마지막 슬라이스를 완료하면 마일스톤이 자동으로 완료됩니다.

---

## 4. Discuss — 대화형 기획

구조화된 6단계 기획 세션을 진행합니다.

```bash
# 세션 시작
vela discuss start

# 단계별 진행
vela discuss advance --data "모바일 우선 SaaS 대시보드"   # vision
vela discuss advance --data "기존 React 프로젝트에 통합"   # reflection
vela discuss advance --data "인증은 Supabase, 상태는 Zustand" # qa
vela discuss advance --data "성능 최적화 중요"             # depth-check
vela discuss advance --data "R001: 로그인, R002: 대시보드"  # requirements
vela discuss advance --data "M1: 인증, M2: 대시보드"       # roadmap

# 현재 상태 확인
vela discuss status

# 완료된 세션을 컨텍스트 문서로 렌더링
vela discuss render
vela discuss render --output ./docs/project-context.md
```

### 6단계 진행 순서

| 순서 | 단계 | 설명 |
|------|------|------|
| 1 | **vision** | 프로젝트 비전과 목표 정의 |
| 2 | **reflection** | 기존 상태와 제약 조건 파악 |
| 3 | **qa** | 기술적 질의응답 |
| 4 | **depth-check** | 깊이 확인 — 추가 논의 필요 영역 |
| 5 | **requirements** | 요구사항 도출 |
| 6 | **roadmap** | 마일스톤/슬라이스 로드맵 |

---

## 5. Agent Strategy

파이프라인 규모에 따라 에이전트 팀 구성이 자동 결정됩니다.

```bash
# 전체 에이전트 역할 조회
vela agents list

# 특정 역할의 프롬프트 확인
vela agents show researcher
vela agents show executor

# 규모별 전략 조회
vela agents strategy --scale large
```

### 6개 핵심 역할

| 역할 | 전문 영역 | 프롬프트 수 |
|------|-----------|------------|
| **researcher** | 가설 수립, 아키텍처 분석, 보안 점검, 품질 평가 | 5개 |
| **planner** | 스펙 작성, 크로스레이어 설계 | 3개 |
| **executor** | 코드 구현, TDD | 3개 |
| **debugger** | 진단, 수정 전략 | 2개 |
| **synthesizer** | 결과 요약, 보고서 | 1개 |
| **pm** | 파이프라인 관리, git 전략, 팀 운영, 모델 전략 | 6개 |

### 전략 매핑

| Scale | 전략 | 설명 |
|-------|------|------|
| small | **solo** | PM이 모든 작업을 직접 수행 |
| medium | **scout** | PM + 탐색 에이전트 (코드베이스 분석) |
| large | **role-separation** | 완전한 역할 분리 (researcher → planner → executor) |

---

## 6. Git Integration

파이프라인과 연동된 git 자동화:

```bash
# 브랜치 생성 (vela/ 접두사 자동 부여)
vela git branch
# → vela/oauth-auth-1530

# 변경사항 커밋 (Conventional Commits + 파이프라인 참조)
vela git commit
# → feat: add OAuth2 authentication
#   Vela-Pipeline: abc123

# 베이스 브랜치로 squash merge
vela git merge
```

> **Vela Gate VG-07:** commit은 execute/commit/finalize 단계에서만 허용됩니다.
> **Vela Gate VG-08:** push는 verify 완료 후에만 허용됩니다.

---

## 7. Requirements Tracking

요구사항을 체계적으로 관리합니다:

```bash
# 요구사항 생성
vela req create "R001" --title "사용자 로그인" --class core-capability
vela req create "R002" --title "소셜 로그인" --class differentiator

# 조회
vela req list
vela req list --status active

# 상태 업데이트
vela req update R001 --status validated --validation "login.test.ts 통과"

# REQUIREMENTS.md 렌더링
vela req render
vela req render --output ./REQUIREMENTS.md
```

### 요구사항 분류 (8종)

| Class | 의미 |
|-------|------|
| `core-capability` | 핵심 기능 |
| `differentiator` | 차별화 기능 |
| `quality-attribute` | 품질 속성 |
| `compliance/security` | 규정 준수 / 보안 |
| `launchability` | 출시 요건 |
| `continuity` | 지속성 |
| `integration` | 통합 |
| `anti-feature` | 안티 기능 |

### 상태 흐름

```
active → validated    (검증 완료)
active → deferred     (다음으로 연기)
active → out-of-scope (범위 밖)
```

---

## 8. Auto-Mode

무인 자동 실행 엔진:

```bash
# 시작 (마일스톤 + 슬라이스 둘 다 필수)
vela auto start --milestone MS001 --slice SL001

# 상태 확인
vela auto status

# 다음 태스크로 진행
vela auto next

# 일시정지
vela auto pause --reason "API rate limit"

# 재개
vela auto resume

# 취소
vela auto cancel
```

Auto-mode는 우선순위 기반으로 다음 태스크를 자동 선택하고, blocker 감지 시 자동으로 일시정지합니다.

---

## 9. Cost Intelligence

파이프라인 비용과 메트릭을 추적합니다:

```bash
vela cost
```

PostToolUse hook이 `trace.jsonl`에 모든 이벤트를 기록하고, cost module이 집계합니다:

- **Tool call 수** — 도구별 호출 횟수
- **Agent dispatch** — 에이전트 위임 횟수
- **Duration** — 파이프라인 실행 시간
- **Artifact count** — 생성된 산출물 수

---

## 10. TUI Dashboard

실시간 터미널 대시보드 (Node.js ≥20 필요):

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

Ink v6 + React 19 기반. `q` 키로 종료.

---

## 11. Continue-Here (세션 재개)

작업 중간에 세션을 저장하고 나중에 재개:

```bash
# 현재 작업 상태 저장
vela continue save --milestone MS001 --slice SL001 --notes "JWT signing 구현 중, 테스트 3개 남음"

# 나중에 불러오기
vela continue load

# 클리어
vela continue clear
```

---

## Typical Workflow

```bash
# 1. 기획
vela discuss start
vela discuss advance --data "..."
# ... 6단계 진행 ...
vela discuss render

# 2. 파이프라인 시작
vela start "사용자 인증 시스템" --scale large

# 3. 계층 구조 설정
vela milestone create "v1.0 Authentication"
vela slice create "JWT Login" --milestone MS001
vela task create "Implement JWT signing" --slice SL001

# 4. 파이프라인 진행
vela transition          # research → plan → ...
vela git branch          # 브랜치 생성
vela transition          # → execute
# ... 코드 작성 (Vela hook이 자동으로 거버넌스 적용) ...
vela transition          # → verify
vela git commit          # 커밋
vela transition          # → finalize
vela git merge           # 머지

# 5. 완료
vela task complete TK001  # → 슬라이스 → 마일스톤 자동 완료
```
