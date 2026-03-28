# 🔒 Hooks & Enforcement

Vela의 거버넌스 메커니즘을 상세히 설명합니다.

---

## 이중 거버넌스 아키텍처

Vela는 두 가지 방식으로 거버넌스를 적용합니다:

### 1. Claude Code Hooks (CJS)

Claude Code 위에서 동작할 때 — 매 tool call마다 Node.js 프로세스를 스폰하여 검사합니다.

- **PreToolUse: vela-gate.cjs** — tool 실행 전 검사, exit 2로 차단
- **PostToolUse: tracker.cjs** — tool 실행 후 이벤트 기록

### 2. 거버넌스 ESM 모듈 (내장)

`vela chat` 독립 에이전트에서 — 동일한 규칙이 ESM 모듈로 내장되어 인라인 적용됩니다.

- `checkGate(toolName, toolInput, ctx)` — 순수 결정 함수, 부작용 없음
- `buildGateContext()` — 파이프라인/설정 상태 1회 로드
- `RetryBudget` — 연속 차단 3회 시 tool loop 종료
- `tracker` — JSONL tool trace + build/test signal 기록

두 방식 모두 동일한 VK-*/VG-* 코드를 사용합니다.

---

## Gate 코드 목록

### VK (Vela-Keeper) — 보안 + 모드 강제

| Code | Rule | 설명 |
|------|------|------|
| VK-01 | Bash write block | Read-only 모드에서 Bash 쓰기 명령 (`rm`, `mv`, `cp`, `mkdir`, `chmod`, `chown`, `npm`, `git` 등) 차단 |
| VK-03 | Pipeline state protection | `pipeline-state.json` 직접 수정 차단 |
| VK-04 | Write/Edit block | Read-only 모드에서 Write/Edit tool 차단 |
| VK-05 | Sensitive file protection | `.env`, `credentials.json`, `id_rsa`, `.pem` 등 민감 파일 쓰기 차단 |
| VK-06 | Secret detection | 15가지 시크릿 패턴 실시간 감지 및 차단 |

### VG (Vela-Guard) — 파이프라인 순서 강제

| Code | Rule | 설명 |
|------|------|------|
| VG-00 | Task management block | 파이프라인 활성 중 TaskCreate/TaskUpdate 차단 |
| VG-01 | Research-before-plan | research.md 없이 plan.md 작성 불가 |
| VG-02 | Plan-before-execute | execute 단계 전 소스코드 수정 불가 |
| VG-03 | Build/test gate | 빌드/테스트 실패 시 commit 불가 |
| VG-05 | Pipeline state protection | (VK-03으로 통합됨) |
| VG-07 | Commit timing | execute/commit/finalize 단계에서만 git commit 허용 |
| VG-08 | Push timing | verify 완료 전 git push 차단 |
| VG-12 | PM delegation | PM이 직접 소스 수정 차단 — SubAgent 위임 강제 |
| VG-13 | TDD sub-phase | 테스트 먼저, 구현은 다음 |

---

## 시크릿 감지 패턴 (VK-06)

15가지 패턴을 실시간으로 감지합니다:

| Category | Patterns |
|----------|----------|
| API Keys | AWS access key, Stripe key, SendGrid key, Twilio key |
| Tokens | GitHub token, Slack token, JWT token |
| Credentials | Database URL (with password), Basic auth header |
| Cloud | GCP service account key, Azure storage key |
| Crypto | Private key (PEM), SSH private key |
| Secrets | Generic secret/password in config |

---

## 차단 메시지 형식

차단 시 구조화된 메시지가 stderr로 출력됩니다:

```
⛵ [Vela] ✦ BLOCKED [VG-02]: Source code modification before execute step.
  File: src/app.ts | Step: research
  Recovery: Complete steps first: Research → Plan → Implementation
```

M001에서 차단 메시지를 69.1% 압축하여 Claude 컨텍스트 토큰 소비를 최소화했습니다.

---

## 거버넌스 ESM 모듈 상세

`vela chat`에 내장된 거버넌스 모듈 (`src/governance/`):

### checkGate()

```typescript
const result = checkGate(toolName, toolInput, gateContext);
// result: { allowed: true } | { allowed: false, code: 'VK-06', reason: '...' }
```

순수 함수 — process.exit, stderr 출력, 파일 시스템 변경 없음. 호출자가 결과에 따라 행동을 결정합니다.

### RetryBudget

연속 차단 예산 (기본 3회). 동일한 tool이 연속으로 차단되면 tool loop를 종료하여 무한 반복을 방지합니다.

### Tracker

모든 tool 호출을 JSONL 형식으로 기록합니다:

```json
{"timestamp":"...","tool":"Write","file":"src/app.ts","allowed":true,"duration_ms":42}
```

build/test signal도 기록하여 VG-03 게이트의 판단 근거를 제공합니다.

---

## Hook 최적화 이력

| 최적화 | 효과 |
|--------|------|
| gate-keeper + gate-guard → vela-gate 통합 (M001) | 프로세스 스폰 3→2, I/O 50% 감소 |
| 차단 메시지 압축 (M001) | 69.1% 바이트 절감 |
| tool_name 기반 early exit (M001) | Read/Glob/Grep에서 write guard 전체 스킵 |
| 거버넌스 ESM 내장 (M004) | vela chat에서 hook 프로세스 스폰 없이 인라인 적용 |
