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
- [`research/2026-09-29-plugin-agent-tools-and-profiles.md`](research/2026-09-29-plugin-agent-tools-and-profiles.md)：w00017 移交的问题：插件工具如何装配到 Profile、工具变化与提示词缓存。

## 2026-09-22 主线接手提交

并发 Agent 停止后，t06 交付的三包与工作区/CI 接线由主线提交为 `0ba63939`（`packages/nb-session`、`packages/nb-profile`、`packages/nb-harness`，workspaces、三条 CI 路径过滤与 workspace-package-matrix 检查）。复跑 `bun run --cwd packages/<pkg> typecheck` 与 `test` → 45 用例全部通过。Linux CI 上的 OMP 原生依赖安装成本尚未实测。

## 2026-10-01 补规范与审查

开发者要求重写 #193 正文，并给三包补 Spec、README、API 文档与示例，顺带审查。执行位置：worktree `.worktree/w00002-neuro-agent-harness-redesign`，分支 `docs/w00002-harness-specs`。当时写的五份 `implemented` Spec（`docs/specs/harness/`）与包文档已于 2026-10-10 按开发者要求删除，内核重做后重新建立；审查发现 16 条（3 条高优先级），均未修复，由内核重做一并解决。详见 [`t07-harness-specs-and-docs`](tasks/t07-harness-specs-and-docs/README.md)。

## 2026-10-10 内核重做

开发者决定：单独开分支与 worktree 做 `nb-harness` 与 Agent 插件；先做内核、不做插件，设计时考虑插件 API。执行位置：worktree `.worktree/w00002-neuro-agent-harness-redesign`，分支 `feat/w00002-harness-kernel`，从 `refactor/w00017-runtime-foundation`（`ebecf836`）开出，并入了 t07 分支；w00017 继续前进时按需合入。设计见 [Agent harness 内核](../../../docs/proposals/agent-harness-kernel.md)（`accepted`），设计任务为 [`t08-harness-kernel-design`](tasks/t08-harness-kernel-design/README.md)。

切片（设计获批后按序实施，每片先写或修订 Spec；模块划分见设计稿“模块划分与推进顺序”）。第 0 片是包的底座：模块入口、边界测试、旧原型移到 `src/prototype/`，见 [`t09-harness-foundation-session`](tasks/t09-harness-foundation-session/README.md)。

1. `session`：与 OMP 兼容的条目、只追加、回放（含压缩后的顺序）、订阅、崩溃收口、分页、`SessionStore` 与 JSONL 实现（Spec [`harness.session`](../../../docs/specs/harness/session.md)）。
2. `profile`：TSX 布局、节点与数据源与字段的注册、渲染、种子与提醒、加载与目录（Spec [`harness.profile`](../../../docs/specs/harness/profile.md)）。
3. `config` 与 `models`：配置 schema 与问题列表；模型解析（配置的服务与 OMP 目录）；OMP `AuthStorage` 凭据与 OAuth 登录接口；按角色解析模型；真实模型冒烟一条。
4. `tools`：工具定义、工具来源、审批判定与四种模式、审批模型（`auto`）。
5. `compaction`：压缩方法的注册与选择，内置 `soft`（包 OMP 的 `prepareCompaction` 与 `compact`，关闭远程与原生压缩；`remote` 推迟，见设计稿决策记录），压缩条目与种子重新写入。
6. `runtime`：`Agent` 循环、状态与操作矩阵（含排队）、调用结果与错误分类、事件与序号、审批等待与审批恢复、压缩触发（手动、溢出、一轮结束超阈值）；完成时删除旧原型与 `nb-session`、`nb-profile` 两个包。
7. 内置读写工具：经 `FileAccess` 接口的 `read` 与 `edit`。

`request_user_input`、更多压缩方法与触发、子代理等在第一批之后。

### 自主推进（2026-10-10 起）

开发者 2026-10-10 指定按 [autonomous-delivery](../../skills/autonomous-delivery/SKILL.md) 推进，商定的目标：从 t09 的计划审查开始，按上面的切片依次推进，直到遇到该 Skill 的停止条件或开发者喊停。提交只留在本地，**不 push**（开发者决定，覆盖 Skill 里“每次提交后 push”的做法）。本该开发者决定的点记在 [待确认清单](pending-confirmations.md)，事后追认。
