# ⛵ Configuration Reference

Vela의 설정 파일과 커스터마이징 방법을 설명합니다.

---

## 설정 파일 구조

```
your-project/
├── .vela/
│   ├── config.json          # ← 핵심 설정
│   ├── pipelines/           # ← 커스텀 파이프라인 정의
│   │   └── review.json
│   ├── templates/
│   │   ├── pipeline.json    # 파이프라인 단계 정의
│   │   └── presets.json     # 사전 정의 프리셋
│   └── guidelines/          # 팀 코딩 가이드라인
│       ├── index.md
│       ├── coding-standards.md
│       ├── error-handling.md
│       └── testing-strategy.md
└── .claude/
    └── settings.local.json  # Claude Code hook 등록 (자동 생성)
```

---

## config.json

```json
{
  "version": "1.0",
  "engine": "vela",

  "sandbox": {
    "enabled": true,        // 샌드박스 모드 활성화
    "strict_mode": true,    // 엄격한 모드 (모든 gate 활성)
    "bash_policy": "blocked" // Bash 정책: blocked | limited | open
  },

  "pipeline": {
    "default": "standard",   // 기본 파이프라인: standard | quick | trivial
    "auto_scale": true,      // --scale 미지정 시 자동 선택
    "enforce_all_steps": true // 모든 단계 강제 (건너뛰기 불가)
  },

  "gate_keeper": {
    "enabled": true,           // Gate Keeper 활성화
    "default_mode": "read",    // 기본 R/W 모드
    "mode_auto_detect": true   // 파이프라인 단계별 자동 모드 전환
  },

  "gate_guard": {
    "enabled": true,           // Gate Guard 활성화
    "hard_block_exit_code": 2, // 차단 시 exit code (2 = Claude 강제 정지)
    "bypass_allowed": false    // 우회 허용 여부 (권장: false)
  },

  "cli": {
    "language": null,         // 언어 설정 (null = 자동 감지)
    "tools_dir": ".vela/cli"  // CLI 도구 디렉토리
  },

  "cache": {
    "enabled": true,
    "db_path": ".vela/cache/vela-cache.db",
    "treenode_enabled": true   // TreeNode 코드 캐시
  },

  "hooks": {
    "use_vela_hooks": true,    // Vela hook 사용
    "claude_code_trigger": true // Claude Code hook 이벤트 연결
  },

  "artifacts": {
    "base_dir": ".vela/artifacts",    // 산출물 디렉토리
    "date_format": "YYYY-MM-DD",      // 날짜 형식
    "cleanup_after_hours": 24         // 자동 정리 (시간)
  }
}
```

---

## 커스텀 파이프라인

`.vela/pipelines/` 디렉토리에 JSON 파일을 추가하면 커스텀 파이프라인을 정의할 수 있습니다.

### 예시: 코드 리뷰 파이프라인

`.vela/pipelines/review.json`:

```json
{
  "name": "review",
  "description": "코드 리뷰 전용 파이프라인",
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

사용:

```bash
vela start "코드 리뷰" --type review
```

### 예시: 핫픽스 파이프라인

`.vela/pipelines/hotfix.json`:

```json
{
  "name": "hotfix",
  "description": "긴급 수정 — 최소 단계",
  "steps": ["init", "execute", "commit"],
  "mode_map": {
    "init": "read",
    "execute": "readwrite",
    "commit": "readwrite"
  }
}
```

---

## Pipeline Presets

`.vela/templates/presets.json`에 사전 정의된 작업 유형:

| Preset | Scale | 설명 |
|--------|-------|------|
| `auth` | large | 인증 시스템 (OAuth, JWT, RBAC) |
| `api-crud` | medium | REST API CRUD 엔드포인트 |
| `bugfix` | ralph | 버그 수정 (테스트 통과까지 반복) |
| `refactor` | large | 코드 리팩토링 |
| `migration` | large | 데이터/스키마 마이그레이션 |
| `docs` | small | 문서 작성/업데이트 |

---

## .claude/settings.local.json

`vela init`이 자동 생성합니다. 수동 수정은 권장하지 않습니다.

주요 설정:

| 섹션 | 설명 |
|------|------|
| `hooks.PreToolUse` | Gate Keeper + Gate Guard 등록 |
| `hooks.PostToolUse` | Tracker 등록 |
| `hooks.UserPromptSubmit` | Orchestrator 등록 |
| `hooks.SessionStart` | 중단 세션 복구 |
| `hooks.Stop` | 활성 파이프라인 확인 |
| `hooks.PreCompact` / `PostCompact` | 상태 보존/복원 |
| `hooks.SubagentStart` | 에이전트 브리핑 |
| `hooks.TaskCompleted` | 작업 완료 검증 |
| `permissions.deny` | 위험 명령 절대 차단 |
| `permissions.allow` | Vela CLI 명령 허용 |

---

## Agent Prompt Override

프로젝트별로 에이전트 프롬프트를 오버라이드할 수 있습니다.

`.vela/agents/` 디렉토리의 파일을 수정하면, `vela agents show` 명령이 수정된 버전을 반환합니다.

```bash
# 기본 researcher 프롬프트 확인
vela agents show researcher

# 프로젝트별 오버라이드
# .vela/agents/researcher/index.md 를 직접 수정
```

> `vela init`은 이미 존재하는 agent 파일을 덮어쓰지 않으므로, 오버라이드가 안전하게 유지됩니다.

---

## Guidelines 커스터마이징

`.vela/guidelines/` 디렉토리의 마크다운 파일을 수정하여 팀의 코딩 표준을 반영합니다:

| 파일 | 내용 |
|------|------|
| `index.md` | 가이드라인 목차 |
| `coding-standards.md` | 코딩 표준 (네이밍, 포맷, 구조) |
| `error-handling.md` | 에러 처리 패턴 |
| `testing-strategy.md` | 테스트 전략 (단위, 통합, E2E) |

Gate Guard가 execute 단계에서 이 가이드라인을 참조합니다.

---

## 산출물 구조

파이프라인 실행 시 생성되는 산출물:

```
.vela/artifacts/{date}/{slug}/
├── meta.json                  # 파이프라인 메타데이터
├── pipeline-state.json        # 현재 상태
├── research.md                # 리서치 결과
├── review-research.md         # 리서치 리뷰
├── approval-research.json     # 리서치 승인
├── plan.md                    # 구현 계획
├── review-plan.md             # 계획 리뷰
├── approval-plan.json         # 계획 승인
├── verification.md            # 검증 결과
├── report.md                  # 최종 리포트
├── diff.patch                 # 변경사항 diff
└── trace.jsonl                # 실행 트레이스
```
