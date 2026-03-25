# 팀 구성 및 에이전트 위임 규칙 — 절대 준수

## Teammate vs Subagent — 예외 없이 구분

**Teammate** = 에이전트 간 SendMessage 소통이 필요한 작업. 반드시 TeamCreate 후 team_name으로 소환.
**Subagent** = 독립 단일 작업. 소통 불필요. team_name 없이 소환.

| 조건 | 방식 | model |
|------|------|-------|
| 경쟁가설 디버깅 (리서치) | **Teammate** | `"opus"` |
| 다중 파일/모듈 동시 수정 | **Teammate** | `"sonnet"` |
| CrossLayer 개발 | **Teammate** | `"sonnet"` |
| 독립 리뷰/점검 | **Subagent** | `"sonnet"` |
| 단일 파일/모듈 수정 | **Subagent** | `"sonnet"` |
| 파일 탐색/검색 | **Subagent** | `"haiku"` |
| 설계/디버깅 분석 | **Subagent** | `"opus"` |

## 팀 규모 — 반드시 준수
- 팀 크기: **3~5명** (개발 팀원 + Conflict Manager 1명)
- 태스크 배분: **팀원당 5~6개**
- 파일 소유권: 각 팀원에게 담당 파일을 **반드시 명시적으로** 부여
- 동일 파일을 여러 팀원이 수정하는 것은 **절대 금지**

## 소환 프롬프트 — 반드시 포함할 항목
```
.vela/agents/{role}/index.md를 읽고 필요한 가이드만 선택적으로 읽어라.
담당 파일: {files}
태스크:
1. ...
2. ...
아티팩트 경로: {artifact_dir}
```

## 에이전트 MD — 트리 구조 로딩
에이전트 소환 시 전체 MD를 읽지 않는다.
반드시 `index.md`만 먼저 읽고, 필요한 세부 파일만 선택적으로 Read한다.
전체 파일을 한번에 읽는 것은 **금지**한다.
