# ⛵ Configuration Reference

Vela의 설정 파일과 커스터마이징 방법을 설명합니다.

---

## 설정 파일 구조

```
your-project/
├── .vela/
│   ├── config.json          # ← 핵심 설정
│   ├── hooks/               # 2개 enforcement hook (CJS) + shared/
│   ├── agents/              # 25개 agent prompt 파일
│   ├── state/               # SQLite DB, pipeline state (gitignored)
│   └── pipelines/           # ← 커스텀 파이프라인 정의 (선택)
│       └── review.json
└── .claude/
    └── settings.local.json  # Claude Code hook 등록 (자동 생성)
```

---

## config.json

`vela init`이 생성하는 기본 설정 — 2개 필드만 포함합니다:

```json
{
  "version": "1.0",
  "pipeline": {
    "default": "standard",
    "scales": ["trivial", "quick", "standard"]
  }
}
```

| 필드 | 설명 |
|------|------|
| `version` | 설정 파일 버전 |
| `pipeline.default` | 기본 파이프라인 타입 (`standard`, `quick`, `trivial`) |
| `pipeline.scales` | 사용 가능한 파이프라인 스케일 목록 |

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

## .claude/settings.local.json

`vela init`이 자동 생성합니다. 수동 수정은 권장하지 않습니다.

### Hook 등록

| 이벤트 | Hook | 설명 |
|--------|------|------|
| `PreToolUse` | vela-gate | R/W 모드 강제, 시크릿 감지, 민감 파일 보호, 파이프라인 순서 강제, TDD, git 게이트 |
| `PostToolUse` | tracker | trace.jsonl 로깅 |

### permissions (Claude Code 자체 기능)

| 섹션 | 설명 |
|------|------|
| `permissions.allow` | Vela CLI 명령 허용: `Bash(vela *)`, `Bash(npx vela *)` |
| `permissions.deny` | 위험 명령 절대 차단 (rm -rf, git push --force 등) |

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
