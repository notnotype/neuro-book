# 插件贡献的 Agent 工具与 Profile 装配：移交给 nb-harness 重构的问题

- 日期：2026-09-29
- 状态：非绑定研究材料，只记录问题与讨论过的方向，没有决定。
- 来源：w00017 [t26 平台化架构重设计](../../w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/README.md) 的设计走查。开发者认为这组问题超出 w00017 的范围，留给 nb-harness 重构考虑。
- 前提：[ADR 0022](../../../../packages/neuro-book/docs/adr/0022-extensible-platform-and-plugin-trust.md) 与[可扩展应用平台设计](../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md)。插件经 `nbook.agent` 拥有的 `agent.tools` 贡献点提供工具；用户可见的插件状态只有已启用、已禁用、未安装，且都即时生效。

## 已在 w00017 决定、nb-harness 需遵守的部分

贡献方被禁用时，贡献使用方（这里是 Agent）的通用处理由平台设计的 P1、P11 规定：

- 禁用后工具立即不可执行；之后的调用得到结构化的 `plugin-unavailable`，Agent 应把它映射为带原因的工具错误结果，运行继续。
- 在途调用有界等待，超时后中止；这次调用必须写入一条结果（完成、中断或失败），否则消息协议里工具调用与结果不配对。有写入副作用的工具标出“结果需核对”。
- 工具实现在调用时经贡献句柄取得，不缓存实现。
- 工具插件被禁用不连带停止 Agent：工具是贡献，不是 Agent 的依赖。

## 留给 nb-harness 的问题

1. **工具怎么进入 Profile。** 讨论过两条途径：Profile 文件直接引用插件工具（作者自选，不审批）；插件在 `agent.tools` 声明中请求装到指定 Profile（例如文生图请求把 `image_gen` 装到 `leader`），由用户按“工具 × Profile”批准。待定：批准记录存放位置（倾向 State Root 级、按 profile key，因为插件是全局安装的）、Profile 能否声明拒绝插件装配、工具能否被 Profile 标为必需、同名工具只在同一 Profile 内检查冲突、插件升级新增目标 Profile 时是否重新审批。
2. **工具 schema 变化与提示词缓存。** 工具定义位于提示词缓存前缀的最前面，插件禁用、启用或升级时立即改变发给模型的工具列表会使整段缓存失效。讨论过的方向：执行权限即时变化，schema 列表只在缓存边界变化（新会话、上下文压缩、距上次请求已超过缓存保留期、切换模型、用户手动刷新）；禁用后在消息末尾追加提醒，告诉模型该工具已不可用。待定：新工具与 schema 升级在边界前如何提示用户、是否提供“立即生效”的选项。
3. **等待审批中的调用。** 插件被禁用时，等待用户批准的工具调用如何呈现与结算。

## 现有代码事实（2026-09-29，分支 `refactor/w00017-runtime-foundation`）

- `packages/neuro-book/server/agent/harness/neuro-agent-harness.ts` 已区分模型可见工具（Profile 声明的全部工具，每轮不变）与执行权限（`executionToolKeys`，runtime hook 可按轮裁剪），但可见列表每轮经注册表过滤，工具离开注册表会立即从列表消失。
- 执行时找不到工具返回 `Tool X not found` 错误结果，运行继续；需要审批的工具在恢复时重新校验。
- `packages/neuro-book/server/agent/tools/tool-registry.ts` 的 `register` 对同名工具静默覆盖。
- Profile 以 `toolset(builtin.web.search, …)` 声明工具，例如 `packages/neuro-book/assets/workspace/.nbook/agent/profiles/builtin/researcher.profile.tsx`。
