# Development Workflow — Vela

This project uses Vela for development governance.

- To explore/read code: use normal tools freely (Explore mode).
- To modify code: ALWAYS start with `node .vela/cli/vela-engine.js init "<task>" --scale <small|medium|large>`
- Follow pipeline steps in order. Do NOT use TaskCreate/TaskUpdate during pipeline execution.
- Do NOT skip pipeline steps or create your own plans outside the pipeline.
- Each team step (research, plan, execute) uses Agent Teams with independent Worker → Reviewer → Leader agents.
