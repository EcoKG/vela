---
description: "⛵ Vela 환경 구축 — 현재 프로젝트에 .vela/ 설치 및 훅 등록"
---

프로젝트 루트의 Vela 스킬(`~/.claude/skills/vela/SKILL.md`)을 읽고 `/vela:init` 절차를 실행한다.

절차:
1. 언어 선택 (Node.js 또는 Python)
2. `.vela/` 디렉토리 구조 생성
3. `~/.claude/skills/vela/scripts/` → `.vela/` 파일 복사
4. `node .vela/install.js` 실행 (훅 등록)
5. `node .vela/install.js verify` 검증
6. 완료 보고

인자: $ARGUMENTS
