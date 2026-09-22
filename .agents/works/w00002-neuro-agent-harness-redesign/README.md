---
schema: nbook.work/v1
workId: w00002-neuro-agent-harness-redesign
issueId: i193
---

# NeuroAgentHarness Redesign

按 2026-09-11 产品形态更新推进：`neuro-agent-harness` 是面向 NeuroBook 领域的 harness，不追求通用；领域无关能力（append-only session、agent profile 提示词装配 DSL、web 工具、编辑工具等）拆成独立通用包，由领域 harness 首批接入。本 Work 只做包与设计，不接入 NeuroBook 产品（接入由 #117 管理）。

## 决策（2026-09-18 重大更新，开发者）

- **作废 D-SPLIT-01 的产物**：`@notnotype/agent-kit` 通用包层已从工作区删除（目录、workspaces、CI 包矩阵与工作流路径过滤、仓库级 `docs/specs/agent-kit/*` 与注册表两行全部移除）。理由：其能力已被 OMP 包族覆盖（`hashline` 覆盖四模式里的 hashline、`pi-catalog` 覆盖目录、`pi-natives.countTokens` 覆盖 token 计数、`pi-agent-core`/`pi-coding-agent` 覆盖 agent 循环与工具），自建即重复造轮子。
- **替代 D-ASSEMBLY-01**：不再「自组装通用件」，改为**直接以 OMP 包族为底座**实现 NeuroAgentHarness（`@oh-my-pi/pi-agent-core`、`@oh-my-pi/pi-ai`、`@oh-my-pi/pi-catalog`、`@oh-my-pi/hashline`、`@oh-my-pi/pi-natives`、`@oh-my-pi/pi-wire` 等）。
- **运行时全面转 Bun**：Node 兼容不再是约束（开发者原话：「现在没有地方消费 node，全都是 bun」）。
- **`./sse` 的归属**：SSE 是 OMP 未提供的能力，收进 `NeuroAgentHarness`（不再作为独立通用包）。
- 执行：由 `t06-nb-harness-rebuild` 交付（`nb-harness` + `nb-session` + `nb-profile`，源码即导出、Bun 目标、OMP 依赖精确锁定 18.2.5；OMP 能力上手报告在 `packages/nb-harness/docs/omp-capabilities.md`）。
- 取证： [`tasks/t05-agent-kit-editing-api/walkthroughs/004-need-agent-kit-layer-2026-09-18.md`](tasks/t05-agent-kit-editing-api/walkthroughs/004-need-agent-kit-layer-2026-09-18.md)（OMP 覆盖度）与 [`005-agent-kit-removal-2026-09-18.md`](tasks/t05-agent-kit-editing-api/walkthroughs/005-agent-kit-removal-2026-09-18.md)（删除执行记录）。

研究材料（非绑定输入，不是 Proposal/Spec/Task 合同）：

- [`research/2026-09-11-deepseek-harness-vs-omp.md`](research/2026-09-11-deepseek-harness-vs-omp.md)：运行时候选对照。
- [`research/2026-09-11-assembly-cordis-vs-harness.md`](research/2026-09-11-assembly-cordis-vs-harness.md)：装配方式讨论（Cordis/dsh 与自组装）。
- [`research/2026-09-11-package-map.md`](research/2026-09-11-package-map.md)：通用包候选蓝图（拆什么、什么结构、各包介绍）。
- [`research/2026-09-18-upstream-reuse-and-event-domain.md`](research/2026-09-18-upstream-reuse-and-event-domain.md)：上游复用取证与事件域讨论。

## 2026-09-22 主线接手提交

并发 Agent 停止后，t06 交付的三包与工作区/CI 接线由主线提交为 `0ba63939`（`packages/nb-session`、`packages/nb-profile`、`packages/nb-harness`，workspaces、三条 CI 路径过滤与 workspace-package-matrix 检查）。复跑 `bun run --cwd packages/<pkg> typecheck` 与 `test` → 45 用例全部通过。本 Work 无独立 worktree，Linux CI 上的 OMP 原生依赖安装成本尚未实测。
