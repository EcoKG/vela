# 📖 Usage Guide

Vela의 두 가지 핵심 모드를 실제 워크플로우 순서대로 안내합니다.

---

## 1. vela chat — 독립 에이전트

`vela chat`은 Anthropic SDK로 Claude와 직접 대화하는 인터랙티브 TUI 에이전트입니다.

### 기본 사용

```bash
# 채팅 시작
vela chat

# 모델 선택
vela chat --model opus

# 이전 세션 이어서
vela chat --resume
```

### 예산 관리

세션 비용 한도를 설정하여 과금 사고를 방지합니다:

```bash
vela chat --budget 5     # $5 한도
```

- **80% 도달**: 경고 메시지 + 대시보드 노란색
- **100% 도달**: API 호출 차단 + 대시보드 빨간색

TUI 내에서도 설정 가능:

```
/budget          # 현재 예산 상태 확인
/budget 10       # $10으로 한도 설정
```

### 동적 모델 라우팅

메시지 복잡도에 따라 모델을 자동 선택합니다:

```bash
vela chat --auto-route
```

| 복잡도 | 선택 모델 | 기준 |
|--------|-----------|------|
| 간단 | Haiku | 짧은 메시지, 단순 질문 |
| 보통 | Sonnet | 일반적인 코딩, 설명 요청 |
| 복잡 | Opus | 긴 코드 블록, 기술 키워드 밀도 높음 |

예산 압박 시 자동 다운그레이드:

| 예산 상태 | 동작 |
|-----------|------|
| 95%+ 소진 | Haiku로 강제 |
| 80%+ 소진 | Sonnet까지만 허용 |
| 100% 도달 | 전체 차단 |

TUI 내에서 토글:

```
/auto            # on/off 전환
```

### 컨텍스트 리셋

긴 대화에서 이전 메시지가 컨텍스트를 소비하면 자동으로 Haiku 요약 기반 리셋이 발동합니다:

- **수동**: `/fresh` 명령어
- **자동**: 총 토큰 100K 초과 시 자동 트리거

리셋 시 Haiku가 대화를 요약하고, 요약본 + 최근 메시지로 대화가 교체됩니다.

### 대시보드

`Ctrl+D`로 토글:

```
┌─ Dashboard ───────────────────────────┐
│ Tokens: 12,345 in / 8,901 out        │
│ Cost:   $0.42                         │
│ Model:  claude-sonnet-4-20250514     │
│ Budget: $3.58 remaining [=====>--]   │
│ Session: abc-123 (15 messages)        │
└───────────────────────────────────────┘
```

### 세션 관리

대화는 SQLite에 자동 저장됩니다:

```bash
# 세션 목록
vela chat sessions

# 특정 세션 이어서
vela chat --resume abc-123

# 마지막 세션 이어서
vela chat --resume
```

### 모델 전환

런타임에 모델을 전환할 수 있습니다:

```
/model opus      # Opus로 전환
/model haiku     # Haiku로 전환
/model sonnet    # Sonnet으로 전환 (기본)
```

### 거버넌스 내장

`vela chat`은 17가지 VK-*/VG-* gate를 ESM 모듈로 내장합니다. `.vela/` 프로젝트에서 실행하면 파이프라인 거버넌스가 tool 실행 전에 자동 적용됩니다.

---

## 2. 거버넌스 파이프라인

Claude Code와 함께 사용하는 거버넌스 엔진입니다.

### 파이프라인 시작

```bash
vela start "OAuth2 인증 추가" --scale large
```

### Scale 선택

| Scale | 단계 수 | 적합한 작업 |
|-------|---------|-------------|
| `small` | 4단계 | 오타 수정, 설정 변경 |
| `medium` | 6단계 | 명확한 기능 추가 |
| `large` | 10단계 | 설계가 필요한 기능 |

### 파이프라인 흐름 (large)

```
init → research → plan → plan-check → checkpoint
     → branch → execute → verify → commit → finalize
```

### 파이프라인 관리

```bash
vela state         # 현재 상태 (JSON)
vela transition    # 다음 단계로 전이
vela cancel        # 파이프라인 취소
```

---

## 3. 3-Tier 계층 관리

```
Milestone                  ← 프로젝트 단위
  └── Slice                ← 기능 단위 (demoable vertical increment)
       └── Task            ← 작업 단위 (cascading completion)
```

### Milestone

```bash
vela milestone create "v1.0 Release" --description "첫 번째 릴리스"
vela milestone list
vela milestone complete MS001
```

### Slice

```bash
vela slice create "User Authentication" --milestone MS001
vela slice list --milestone MS001
vela slice complete SL001
```

### Task

```bash
vela task create "Implement JWT signing" --slice SL001
vela task list --slice SL001
vela task complete TK001
```

> **Cascading Completion:** 마지막 태스크 완료 → 슬라이스 자동 완료 → 마일스톤 자동 완료.

---

## 4. Discuss — 대화형 기획

```bash
vela discuss start
vela discuss advance --data "..."
vela discuss render
```

6단계: vision → reflection → qa → depth-check → requirements → roadmap

---

## 5. Agent Strategy

파이프라인 규모에 따라 에이전트 팀 구성이 자동 결정됩니다.

| Scale | Strategy | 설명 |
|-------|----------|------|
| small | **solo** | PM이 직접 실행 |
| medium | **scout** | PM + 탐색 에이전트 |
| large | **role-separation** | 완전한 역할 분리 |

---

## 6. Git Integration

```bash
vela git branch    # 브랜치 생성 (vela/ 접두사)
vela git commit    # Conventional Commits + 파이프라인 참조
vela git merge     # Squash merge
```

---

## 7. Requirements

```bash
vela req create R001 --title "사용자 로그인" --class core-capability
vela req list
vela req update R001 --status validated
vela req render
```

---

## Typical Workflow

### 독립 에이전트 워크플로우

```bash
# 1. 인증
vela auth add default

# 2. 채팅 시작 (예산 + 자동 라우팅)
vela chat --budget 10 --auto-route

# 3. 대화 중 모델 전환
/model opus

# 4. 긴 대화 후 컨텍스트 리셋
/fresh

# 5. 나중에 세션 이어서
vela chat --resume
```

### 거버넌스 파이프라인 워크플로우

```bash
# 1. 프로젝트 초기화
vela init

# 2. 기획
vela discuss start && vela discuss render

# 3. 파이프라인 실행
vela start "인증 시스템" --scale large
vela transition   # 단계별 진행

# 4. Git 통합
vela git branch && vela git commit && vela git merge

# 5. 완료
vela task complete TK001
```
