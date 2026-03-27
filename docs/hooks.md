# ⛵ Hooks & Enforcement

Vela의 핵심 차별점 — **프롬프트가 아닌 구조로 강제하는** hook 시스템을 상세히 설명합니다.

---

## Overview

Vela는 Claude Code의 hook 시스템에 연결되어 **모든 도구 호출 전/후**에 실행됩니다.

```
사용자 요청 → Claude Code → [PreToolUse Hook] → 도구 실행 → [PostToolUse Hook]
                                    ↑                              ↑
                              Vela Gate                        Tracker
                    여기서 차단하면 도구가 실행되지 않음
```

### Hook 목록

Vela는 **2개의 Claude Code hooks**를 등록합니다:

| Hook | 이벤트 | 역할 |
|------|--------|------|
| `vela-gate.cjs` | PreToolUse | R/W 모드 강제, 시크릿 감지, 민감 파일 보호, 파이프라인 순서 강제, TDD, git 게이트 |
| `tracker.cjs` | PostToolUse | trace.jsonl 로깅 |

### `.claude/settings.local.json` 등록

`vela init`이 자동 생성하는 hook 등록:

- **PreToolUse** × 1: vela-gate
- **PostToolUse** × 1: tracker

---

## ⛵ Vela Gate (통합 게이트)

**모든 도구 호출 전에 R/W 권한과 파이프라인 규칙을 검사합니다.**

VK-* 규칙 (샌드박스 강제)을 먼저 실행한 후, VG-* 규칙 (파이프라인 가드)을 실행합니다.

### VK-01: Bash 쓰기 차단 (Read-only 모드)

```
[VK-01] Bash write blocked in read mode. Run: node .vela/cli/vela-engine.js transition
```

Read-only 모드에서 차단되는 Bash 명령:
- 파일 조작: `rm`, `mv`, `cp`, `mkdir`, `touch`, `chmod`
- 패키지: `npm install`, `pip install`, `yarn add`
- 기타 쓰기: `sed -i`, `tee`, `>`

**허용되는 명령** (모든 모드):
- `ls`, `cat`, `find`, `grep`, `wc`, `head`, `tail`
- `git status`, `git log`, `git diff`, `git branch`
- `node --version`, `npm --version`

### VK-02: Bash 샌드박스 제한

샌드박스 모드에서 허용 목록에 없는 Bash 명령을 차단합니다.

```
[VK-02] Bash restricted in sandbox. Use .vela/cli/ tools or built-in Read/Write/Edit/Glob/Grep.
```

### VK-03: pipeline-state.json 직접 수정 불가

```
[VK-03] pipeline-state.json is immutable. Run: node .vela/cli/vela-engine.js transition
```

### VK-04: Write/Edit 차단 (Read-only 모드)

```
[VK-04] Write blocked in read mode. Run: node .vela/cli/vela-engine.js transition
```

### VK-05: 민감 파일 보호

차단 대상 파일:

| 파일 | 이유 |
|------|------|
| `.env`, `.env.local`, `.env.production`, `.env.staging` | 환경 변수 / 시크릿 |
| `credentials.json`, `secrets.json`, `secrets.yaml` | 인증 정보 |
| `.npmrc`, `.pypirc` | 패키지 레지스트리 토큰 |
| `id_rsa`, `id_ed25519` | SSH 키 |

```
[VK-05] Sensitive file protected. Use .env.example or .env.template instead.
```

### VK-06: 시크릿 패턴 감지 (15가지)

Write/Edit 도구의 content를 실시간 스캔합니다:

| 패턴 | 예시 |
|------|------|
| AWS Access Key | `AKIA...` (20자) |
| GitHub PAT | `ghp_...` (40자) |
| GitHub OAuth | `gho_...` (40자) |
| OpenAI API Key | `sk-...` (51자) |
| Anthropic API Key | `sk-ant-...` (97자+) |
| JWT Token | `eyJ...` (Base64 JSON) |
| Stripe Live Key | `sk_live_...` |
| Stripe Restricted Key | `rk_live_...` |
| MongoDB URI | `mongodb+srv://user:pass@...` |
| PostgreSQL URI | `postgresql://user:pass@...` |
| MySQL URI | `mysql://user:pass@...` |
| Private Key | `-----BEGIN RSA PRIVATE KEY-----` |
| Slack Token | `xoxb-...`, `xoxp-...` |
| Google API Key | `AIza...` (39자) |
| SendGrid Key | `SG....` (69자) |

```
[VK-06] Secret/credential detected in write content. Use environment variables instead.
```

### VK-07: PM 소스 코드 접근 차단

PM이 직접 소스 코드를 읽거나 수정하지 못하도록 합니다. SubAgent 위임을 강제합니다.

```
[VK-07] PM cannot access source code directly. Delegate to a Subagent.
```

### VG-00: TaskCreate/TaskUpdate 차단

파이프라인 활성 중 Claude의 내장 Task 도구 사용을 차단합니다.

```
[VG-00] Claude task tools disabled during pipeline. Use Vela pipeline steps.
```

### VG-01: Research 없이 Plan 불가

`research.md`가 없으면 `plan.md`를 작성할 수 없습니다.

```
[VG-01] Cannot create plan without research. Complete research step first.
```

### VG-02: Execute 전 소스코드 수정 불가

research, plan 단계에서 `src/`, `lib/` 등 소스코드를 수정할 수 없습니다.

```
[VG-02] Source code edit before execute step. Complete: research → plan → execute
```

### VG-03: 빌드/테스트 실패 시 Commit 불가

```
[VG-03] Cannot commit with failed build/tests. Fix and re-run first.
```

### VG-04: Verification 없이 Report 불가

`verification.md`가 없으면 `report.md`를 작성할 수 없습니다.

```
[VG-04] Cannot create report without verification. Complete verification step first.
```

### VG-06: 리비전 한도 초과

단계별 최대 수정 횟수를 초과하면 차단됩니다.

```
[VG-06] Revision limit reached for step "execute". Transition to next step or request approval.
```

### VG-07: Git Commit 단계 제한

execute, commit, finalize 단계에서만 `git commit` 허용.

```
[VG-07] Git commit only allowed during execute/commit/finalize. Run: node .vela/cli/vela-engine.js commit
```

### VG-08: Verify 전 Git Push 차단

```
[VG-08] Git push only allowed after verification step. Complete verification first.
```

### VG-09: 보호 브랜치 커밋 경고

보호 브랜치(main, master 등)에서 직접 커밋 시 경고합니다. (차단이 아닌 경고)

```
[VG-09] WARNING: Committing to protected branch "main". Consider: git checkout -b vela/<feature> from main
```

### VG-11: 승인/리뷰 파일 팀 단계 제한

`approval-*`, `review-*` 파일은 팀 단계에서만 작성할 수 있습니다.

```
[VG-11] approval-design.md only allowed during team steps.
```

### VG-12: PM 직접 소스 수정 차단

execute 단계에서 PM이 직접 소스를 수정하지 못하도록 합니다. SubAgent 위임을 강제합니다.

```
[VG-12] PM cannot edit source directly in execute. Spawn a Subagent to implement.
```

### VG-13: TDD Sub-phase 강제

execute 단계에서 테스트 파일을 먼저 작성해야 합니다.

```
[VG-13] TDD phase "test-write" — only test files allowed. Write tests first, then transition to "implement".
```

### VG-EXPLORE: Explore 모드 쓰기 차단

파이프라인이 없을 때 쓰기를 차단합니다.

```
[VG-EXPLORE] No active pipeline. Run: node .vela/cli/vela-engine.js init "<task>" --scale <small|medium|large>
```

---

## 🔭 Tracker (추적기)

**모든 tool 호출을 `trace.jsonl`에 기록합니다.** `vela cost`의 데이터 소스.

---

## 차단 & 자동 복구 메커니즘

모든 차단 메시지는 단일줄 형식으로 stderr에 출력되며, 복구 경로를 포함합니다.
Claude는 차단 코드를 읽고 복구 지시에 따라 **즉시 올바른 행동으로 전환**합니다.

```
Claude: src/auth.js 수정 시도
  ↓
Hook: [VG-02] Source code edit before execute step. Complete: research → plan → execute
  ↓
Claude: vela transition 실행 (research → plan → execute로 진행)
```

### 절대 차단 (Permission Deny)

`.claude/settings.local.json`의 `permissions.deny`로 시스템 수준에서 차단:

- `rm -rf *`, `rm -r *`
- `git push --force *`, `git push -f *`
- `git reset --hard *`
- `git commit --no-verify *`, `git commit -n *`
- `git clean -f *`, `git clean -fd *`
- `drop database *`, `DROP DATABASE *`

이들은 hook이 아닌 Claude Code 자체에서 차단되므로 **어떤 방법으로도 우회 불가**합니다.

---

## Explore vs Develop 모드

| 모드 | 상태 | 허용 | 차단 |
|------|------|------|------|
| **Explore** | 파이프라인 없음 | 읽기, 탐색, 분석 | 모든 쓰기 |
| **Develop** | 파이프라인 활성 | 단계별 R/W | 단계 건너뛰기 |

파이프라인 없이 코드를 수정하려 하면 → VG-EXPLORE로 차단 → `vela start`로 파이프라인 시작 유도.
