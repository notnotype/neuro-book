---
schema: nbook.task/v2
taskId: t49-commands-quick-open
---

# NeuroBook v2 第 4 步（二）：命令系统与快速打开

## 目标与范围

按 [NeuroBook v2：并排重建应用](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 第 6 节第 4 步，把命令系统、命令面板与 Lab 命令场景迁入新应用。主 Agent 编码，omp（默认模型）审查。

行为合同：
- [`workbench.commands`](../../../../../docs/specs/workbench/commands.md)：场景 1–10，以及本 Task 新增的 11–13；
- [`workbench.quick-open`](../../../../../docs/specs/workbench/quick-open.md)：场景 1–7；
- [`ui.component-lab`](../../../../../docs/specs/ui/component-lab.md)：场景 16。

旧实现只作参照：`packages/neuro-book-legacy/app/utils/workbench/{context-keys,commands,keymap,command-query,editor-commands}.ts`、`app/composables/useWorkbenchCommands.ts`、`app/components/workbench/WorkbenchCommandPalette.vue`、`app/component-lab/fixtures/{lab-command-scene.ts,LabCommandInspector.vue,LabCommandSceneLayer.vue}`。

**开发者决定**（2026-10-06，计划随之审批）

1. **命令系统是内置插件 `nbook.commands`，不进内核。**
   - 它与运行位置无关，服务端和浏览器各有入口，以后加终端界面（TUI）入口。
   - 命令系统的一个用途是让用户与 Agent 不经界面操作软件。用 TUI 打开时 workbench 不激活，TUI 登记的命令照常可用。
2. **内核不提供 `ctx.commands`。**
   - 命令经 `nbook.commands` 的贡献点登记，经它导出的命令服务执行。
   - 协作机制只剩贡献点与导出 API 两种，命令建在这两者之上。
   - [ADR 0022](../../../../../docs/adr/0022-extensible-platform-and-plugin-trust.md) 决策 2、[平台设计](../../../../../docs/proposals/extensible-application-platform.md) P3 与 P7 同步修订。
3. **激活事件由拥有者插件定义。**
   - 内核只认 `onStartup`，其它前缀由拥有者声明，新增激活方式不改内核（`runtime.plugin-manifest`）。
   - 本 Task 只写 Spec，第一个需要懒激活的消费者出现时再实现。
4. **workbench 按真实消费者逐个加贡献点**，不一次做全。
   - 外壳的抽象（区域、图标栏、切换器、视图容器、视图）在 t50 之前单独设计一轮，交开发者审批。
5. **编辑器样板用 textarea 实现的最小编辑器**；Monaco 随第 5 步的编辑器迁入。
6. **命令标题用中英文本**：声明里直接写 `{zh-CN, en-US}`，设置插件加入前界面固定用简体中文；不引入 vue-i18n。

**不在本 Task**：
- 内核激活事件的实现；
- 跨运行位置执行命令；
- 上下文键与别名的贡献点、确认框的产品接入（都还没有产品消费者）；
- Monaco、vue-i18n；
- 第二批 `nbook.view.*` 命令（随 t50）；
- 文件快速打开。

## 当前状态

2026-10-06 开始：S1 修订 ADR 0022、平台设计、`runtime.plugin-api`、`runtime.plugin-manifest`。

计划切片：
- S2 命令模型；
- S3 插件与装配；
- S4 面板与产品页；
- S5 Lab 命令场景；
- S6 浏览器验收；
- S7 收口与 omp 审查。

## 验收

（随实现补充。）
