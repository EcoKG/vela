---
name: vela
description: "⛵ Vela 샌드박스 엔진. /vela:init 으로 프로젝트에 Vela 환경을 구축하고, /vela:start 로 바로 파이프라인을 시작한다 (init이 안 되어 있으면 자동으로 init 먼저 수행). Claude Code의 모든 행위를 파이프라인 기반으로 통제하는 샌드박스 시스템. 사용자가 프로젝트 환경 구축, 개발 파이프라인 설정, 코드 수정, 리팩토링, 기능 추가 등을 요청할 때 이 스킬을 사용해야 한다. Vela, 벨라, 샌드박스, 파이프라인, 시작, start, init 등의 키워드가 언급되면 이 스킬을 트리거한다."
---

# ⛵ Vela Engine v4 — Sandbox Development System

Vela는 Claude Code를 완전히 감싸는 샌드박스 엔진이다.

## /vela 호출 시 — 슬래시 명령어로 위임

v4부터 Vela의 모든 파이프라인 명령어는 `~/.claude/commands/vela/` 슬래시 명령어를 통해 실행된다.

`$ARGUMENTS`를 확인한다:
- `init` → `/vela:init` 절차 실행 (아래 참조)
- `start` 또는 `start <작업설명>` → **`/vela:start` 슬래시 명령어로 위임**
- `discuss N` → **`/vela:discuss N` 슬래시 명령어로 위임**
- `plan N` → **`/vela:plan N` 슬래시 명령어로 위임**
- `execute N` → **`/vela:execute N` 슬래시 명령어로 위임**
- `verify N` → **`/vela:verify N` 슬래시 명령어로 위임**
- `ship N` → **`/vela:ship N` 슬래시 명령어로 위임**
- `next` → **`/vela:next` 슬래시 명령어로 위임**
- `status` → **`/vela:status` 슬래시 명령어로 위임**
- `pause` → **`/vela:pause` 슬래시 명령어로 위임**
- `resume` → **`/vela:resume` 슬래시 명령어로 위임**
- `quick <작업설명>` → **`/vela:quick` 슬래시 명령어로 위임**
- 비어있음 → AskUserQuestion으로 선택:

```json
{
  "questions": [{
    "question": "⛵ Vela — 무엇을 하시겠습니까?",
    "header": "⛵ Vela v4",
    "options": [
      {
        "label": "파이프라인 시작",
        "description": "/vela:start — 작업을 시작합니다. Vela 환경이 없으면 자동으로 구축합니다."
      },
      {
        "label": "환경 구축만",
        "description": "/vela:init — 이 프로젝트에 Vela 환경(.vela/)을 설치합니다."
      }
    ],
    "multiSelect": false
  }]
}
```

슬래시 명령어 실행 시 해당 명령어 파일(`~/.claude/commands/vela/`)이 자동으로 로드되어 `.vela/agents/vela.md`를 읽고 단계를 실행한다.

---

## /vela:init — 환경 구축

이 커맨드가 호출되면 현재 프로젝트에 Vela 환경을 구축한다.

### 초기화 절차

1. **언어 선택 질문**
   사용자에게 CLI 도구의 스크립트 언어를 질문한다 (Node.js 또는 Python).

2. **디렉토리 구조 생성**
   프로젝트 루트에 `.vela/` 디렉토리를 생성한다:
   ```
   .vela/
   ├── config.json
   ├── install.js
   ├── statusline.sh
   ├── hooks/
   │   ├── vela-gate-keeper.js
   │   ├── vela-gate-guard.js
   │   ├── vela-orchestrator.js
   │   ├── vela-tracker.js
   │   └── shared/
   │       ├── constants.js
   │       └── pipeline.js
   ├── cli/
   │   ├── vela-engine.js
   │   ├── vela-read.js
   │   └── vela-write.js
   ├── cache/
   │   └── treenode.js
   ├── templates/
   │   └── pipeline.json
   ├── agents/
   │   ├── vela.md
   │   ├── pm/
   │   ├── researcher/
   │   ├── synthesizer/
   │   ├── planner/
   │   ├── executor/
   │   └── debugger/
   ├── references/
   └── artifacts/
   ```

3. **스크립트 배포**
   이 스킬의 파일들을 `.vela/`로 복사한다:
   - `scripts/hooks/*` → `.vela/hooks/`
   - `scripts/cli/*` → `.vela/cli/`
   - `scripts/cache/*` → `.vela/cache/`
   - `scripts/install.js` → `.vela/install.js`
   - `scripts/statusline.sh` → `.vela/statusline.sh`
   - `scripts/agents/` (전체 트리) → `.vela/agents/`
   - `templates/*` → `.vela/templates/`
   - `references/*` → `.vela/references/` (존재하는 경우)

4. **훅 등록**
   ```bash
   node .vela/install.js
   ```

5. **훅 검증**
   ```bash
   node .vela/install.js verify
   ```

6. **초기화 확인**
   사용자에게 설치 결과를 보고한다.
   설치 완료 후 `/vela:start`로 파이프라인을 시작할 수 있음을 안내한다.
