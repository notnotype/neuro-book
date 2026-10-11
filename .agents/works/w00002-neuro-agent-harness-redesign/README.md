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
2. `profile`：TSX 布局、节点与数据源与字段的注册、渲染、种子与提醒、加载与目录（Spec [`harness.profile`](../../../docs/specs/harness/profile.md)），见 [`t10-harness-profile`](tasks/t10-harness-profile/README.md)。
3. `config` 与 `models`：配置 schema 与问题列表；模型解析（配置的服务与 OMP 目录）；OMP `AuthStorage` 凭据与 OAuth 登录接口；按角色解析模型；真实模型冒烟一条（Spec [`harness.config`](../../../docs/specs/harness/config.md)、[`harness.models`](../../../docs/specs/harness/models.md)），见 [`t11-harness-config-models`](tasks/t11-harness-config-models/README.md)。
4. `tools`：工具定义、工具来源、审批判定与四种模式、审批模型（`auto`）、适配成 OMP `AgentTool`（Spec [`harness.tools`](../../../docs/specs/harness/tools.md)），见 [`t12-harness-tools`](tasks/t12-harness-tools/README.md)。
5. `compaction`：压缩方法的注册与选择，内置 `soft`（包 OMP 的 `prepareCompaction` 与 `compact`，关闭远程与原生压缩；`remote` 推迟，见设计稿决策记录），压缩条目与种子重新写入（Spec [`harness.compaction`](../../../docs/specs/harness/compaction.md)），见 [`t13-harness-compaction`](tasks/t13-harness-compaction/README.md)。
6. `runtime`：`Agent` 循环、状态与操作矩阵（含排队）、调用结果与错误分类、事件与序号、审批等待与审批恢复、压缩触发（手动、溢出、一轮结束超阈值）；完成时删除旧原型与 `nb-session`、`nb-profile` 两个包（Spec [`harness.runtime`](../../../docs/specs/harness/runtime.md)），见 [`t14-harness-runtime`](tasks/t14-harness-runtime/README.md)。
7. 内置读写工具：经 `FileAccess` 接口的 `read` 与 `edit`（Spec [`harness.builtin-tools`](../../../docs/specs/harness/builtin-tools.md)），见 [`t15-harness-builtin-tools`](tasks/t15-harness-builtin-tools/README.md)。

`request_user_input`、更多压缩方法与触发、子代理等在第一批之后。

### 自主推进（2026-10-10 起）

开发者 2026-10-10 指定按 [autonomous-delivery](../../skills/autonomous-delivery/SKILL.md) 推进，商定的目标：从 t09 的计划审查开始，按上面的切片依次推进，直到遇到该 Skill 的停止条件或开发者喊停。提交只留在本地，**不 push**（开发者决定，覆盖 Skill 里“每次提交后 push”的做法）。本该开发者决定的点记在 [待确认清单](pending-confirmations.md)，事后追认。

推进日志（2026-10-10，分支 `feat/w00002-harness-kernel`，全部本地提交）：

| 切片 | Task | 状态 | 审查 |
|---|---|---|---|
| 0、1 `session` | [t09](tasks/t09-harness-foundation-session/README.md) | 已实现 | 计划审查 13 条、实现审查 10 条，全部处理 |
| 2 `profile` | [t10](tasks/t10-harness-profile/README.md) | 已实现 | 计划审查 6 条，全部处理；实现审查未开（留待 runtime 接入后一并审） |
| 3 `config`、`models` | [t11](tasks/t11-harness-config-models/README.md) | 已实现 | 计划审查 14 条（含实现核实），全部处理 |
| 4 `tools` | [t12](tasks/t12-harness-tools/README.md) | 已实现 | 计划与实现合一审查 10 条，全部处理 |
| 5 `compaction` | [t13](tasks/t13-harness-compaction/README.md) | 已实现 | 与 t14 合一审查 12 条，全部处理 |
| 6 `runtime` | [t14](tasks/t14-harness-runtime/README.md) | 已实现；旧原型与 `nb-session`、`nb-profile` 已删除 | 与 t13 合一审查 12 条，全部处理 |
| 7 内置工具 | [t15](tasks/t15-harness-builtin-tools/README.md) | 已实现 | 审查 8 条，全部处理 |
| 优化一 | [t16](tasks/t16-harness-ergonomics/README.md) | 已实现 | 审查 7 条，全部处理 |
| 优化二（一） | [t17](tasks/t17-harness-kernel-edges/README.md) | 实现中 | 待审 |
| 优化二（二） | [t18](tasks/t18-harness-resources-artifacts/README.md) | 未开始 | |

七份 Spec 2026-10-11 经开发者批准晋升 `implemented`（术语表随之）；三处真实模型冒烟（models、compaction、runtime）2026-10-11 经开发者授权用专属键 `NBOOK_LLM_*`（`.env` 里的 gpt-6-luna 服务，见 [`docs/testing/README.md`](../../../docs/testing/README.md#真实模型测试)）跑过，`bun run test:llm` 3 pass；跑出两处只在真实服务上才暴露的测试问题（自建提供方要显式给 `contextWindow`、摘要断言不能拿 JSON 串比对），已修。

2026-10-11 治理与文档：七份 Spec 按 [`docs/specs/README.md`](../../../docs/specs/README.md) 核对（证据固定标签、实现合同不列文件、公开入口与导出对齐、批准依据首行），新增 [术语表](../../../docs/specs/harness/glossary.md)；待确认清单 8 条开发者追认；包使用文档 [`packages/nb-harness/README.md`](../../../packages/nb-harness/README.md) 与示例 [`packages/nb-harness/examples/`](../../../packages/nb-harness/examples/README.md)（装配、示例 Profile、注册节点、四个脚本化场景、一个真实模型场景、命令行；场景与真实模型场景、命令行都跑通）。Spec 晋升 `implemented` 同日获批。随后开发者选择先做一轮优化：[t16](tasks/t16-harness-ergonomics/README.md)（目录跟配置、`:memory:` 凭据与 `apiKeys`、缺省依赖、`Invocation.next()`、`status.context`、压缩注入选项、`harness/` 未知字段报错、无 `contextWindow` 的压缩报错、edit 说明用 OMP 原文并经真实模型验证先读后改）。第二轮（开发者 2026-10-11 批准计划）：[t17](tasks/t17-harness-kernel-edges/README.md)（`status` 缓存与用量估算、`next()` 共用等待、目录入参显式化、`:memory:` 重开说明、`preview()`）与 [t18](tasks/t18-harness-resources-artifacts/README.md)（OMP 升 18.4.6、`read`/`edit` 改资源地址 `project://`、`local://`、`tmp://`、`docs://`、`artifact://`，工具结果超预算溢出到 artifact）。
