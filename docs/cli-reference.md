# ⛵ CLI Reference

모든 Vela CLI 명령어의 완전한 레퍼런스입니다.

---

## Global

```
vela --version              버전 출력
vela --help                 도움말
vela help <command>         명령어별 도움말
```

---

## Pipeline

### `vela init`

프로젝트에 Vela를 초기화합니다.

```bash
vela init
```

- `.vela/` 디렉토리 생성 및 파일 복사
- `.claude/settings.local.json`에 hook 자동 등록
- 이미 초기화된 프로젝트에서도 안전 (멱등성)

---

### `vela start <request>`

새 파이프라인을 시작합니다.

```bash
vela start "OAuth2 인증 추가" --scale large
vela start "Fix login bug" --scale small
vela start "Code review" --type review
```

| Option | Default | Description |
|--------|---------|-------------|
| `--scale <size>` | `medium` | `small` / `medium` / `large` |
| `--type <name>` | — | 빌트인(`standard`/`quick`/`trivial`) 또는 커스텀 타입 |

출력: JSON `{ ok, pipeline: { id, request, scale, steps, currentStep } }`

---

### `vela state`

현재 파이프라인 상태를 조회합니다.

```bash
vela state
```

출력: JSON `{ ok, pipeline: { id, request, scale, currentStep, stepIndex, totalSteps, status } }`

활성 파이프라인이 없으면: `{ ok: false, error: "No active pipeline" }`

---

### `vela transition`

다음 파이프라인 단계로 전이합니다.

```bash
vela transition
```

- 전이 조건이 충족되지 않으면 거부
- Gate Guard가 순서를 강제

출력: JSON `{ ok, previous, current, remaining }`

---

### `vela cancel`

활성 파이프라인을 취소합니다.

```bash
vela cancel
```

출력: JSON `{ ok, cancelled: true }`

---

## Hierarchy

### `vela milestone create <title>`

```bash
vela milestone create "v1.0 Release" --description "첫 번째 릴리스"
```

| Option | Description |
|--------|-------------|
| `--description <text>` | 마일스톤 설명 |

---

### `vela milestone list`

```bash
vela milestone list
```

출력: JSON `{ ok, milestones: [...] }`

---

### `vela milestone complete <id>`

```bash
vela milestone complete MS001
```

> 모든 슬라이스가 완료 상태여야 합니다.

---

### `vela slice create <title>`

```bash
vela slice create "User Auth" --milestone MS001
```

| Option | Description |
|--------|-------------|
| `--milestone <id>` | 소속 마일스톤 ID |

---

### `vela slice list`

```bash
vela slice list --milestone MS001
```

---

### `vela slice complete <id>`

```bash
vela slice complete SL001
```

> 모든 태스크가 완료 상태여야 합니다.

---

### `vela slice boundary <id>`

슬라이스의 바운더리 맵을 설정합니다.

```bash
vela slice boundary SL001 --inputs "email, password" --outputs "JWT token, refresh token"
```

---

### `vela task create <title>`

```bash
vela task create "Implement JWT" --slice SL001
```

| Option | Description |
|--------|-------------|
| `--slice <id>` | 소속 슬라이스 ID |

---

### `vela task list`

```bash
vela task list --slice SL001
```

---

### `vela task complete <id>`

```bash
vela task complete TK001
```

> **Cascading:** 마지막 태스크 완료 → 슬라이스 자동 완료 → 마일스톤 자동 완료

---

## Discuss

### `vela discuss start`

새 기획 세션을 시작합니다.

```bash
vela discuss start
```

---

### `vela discuss status`

현재 세션 상태를 조회합니다.

```bash
vela discuss status
vela discuss status --session <id>
```

---

### `vela discuss advance`

다음 단계로 진행합니다.

```bash
vela discuss advance --data "프로젝트 비전 설명..."
vela discuss advance --data "기술 스택 결정" --session <id>
```

| Option | Description |
|--------|-------------|
| `--data <text>` | 이 단계의 입력 데이터 |
| `--session <id>` | 특정 세션 지정 |

---

### `vela discuss render`

완료된 세션을 구조화된 마크다운으로 렌더링합니다.

```bash
vela discuss render
vela discuss render --output ./docs/context.md
vela discuss render --session <id>
```

---

## Git

### `vela git branch`

파이프라인용 브랜치를 생성합니다.

```bash
vela git branch
# → vela/oauth-auth-1530
```

`vela/` 접두사가 자동 부여됩니다.

---

### `vela git commit`

변경사항을 커밋합니다.

```bash
vela git commit
```

- Conventional Commits 형식
- `Vela-Pipeline: <id>` 참조 자동 추가
- Gate Guard VG-07: execute/commit/finalize에서만 허용

---

### `vela git merge`

파이프라인 브랜치를 베이스 브랜치로 squash merge합니다.

```bash
vela git merge
```

---

## Requirements

### `vela req create <id>`

```bash
vela req create "R001" --title "사용자 로그인" --class must
vela req create "R002" --title "소셜 로그인" --class should --description "Google, GitHub OAuth"
```

| Option | Description |
|--------|-------------|
| `--title <text>` | 요구사항 제목 |
| `--class <type>` | `must` / `should` / `could` / `wont` |
| `--description <text>` | 상세 설명 |

---

### `vela req list`

```bash
vela req list
vela req list --status active
vela req list --status validated
```

---

### `vela req update <id>`

```bash
vela req update R001 --status validated --validation "login.test.ts 통과"
```

---

### `vela req delete <id>`

```bash
vela req delete R003
```

---

### `vela req render`

REQUIREMENTS.md를 생성합니다.

```bash
vela req render
vela req render --output ./REQUIREMENTS.md
```

---

## Auto-mode

### `vela auto start`

```bash
vela auto start --milestone MS001
vela auto start --slice SL001
```

---

### `vela auto status`

```bash
vela auto status
```

---

### `vela auto next`

현재 태스크 완료 후 다음으로 진행합니다.

```bash
vela auto next
```

---

### `vela auto pause`

```bash
vela auto pause --reason "Rate limit"
```

---

### `vela auto resume`

```bash
vela auto resume
```

---

### `vela auto cancel`

```bash
vela auto cancel
```

---

## Agents

### `vela agents list`

모든 에이전트 역할을 나열합니다.

```bash
vela agents list
```

---

### `vela agents show <role>`

특정 역할의 프롬프트를 출력합니다.

```bash
vela agents show researcher
vela agents show pm
```

---

### `vela agents strategy`

규모별 에이전트 전략을 조회합니다.

```bash
vela agents strategy --scale large
```

---

## Other

### `vela cost`

파이프라인 비용/메트릭 리포트를 출력합니다.

```bash
vela cost
```

---

### `vela tui`

TUI 대시보드를 실행합니다.

```bash
vela tui
```

`q` 키로 종료.

---

### `vela continue save`

```bash
vela continue save --context "JWT 구현 중, 테스트 남음"
```

### `vela continue load`

```bash
vela continue load
```

### `vela continue clear`

```bash
vela continue clear
```

---

## JSON Output

모든 명령어는 JSON 형태로 결과를 출력합니다:

**성공:**
```json
{ "ok": true, "pipeline": { ... } }
```

**실패:**
```json
{ "ok": false, "error": "No active pipeline" }
```

이를 활용해 스크립트에서 파싱하거나 다른 도구와 연동할 수 있습니다:

```bash
# jq로 현재 단계 추출
vela state | jq -r '.pipeline.currentStep'

# 파이프라인 활성 여부 확인
vela state | jq -r '.ok'
```
