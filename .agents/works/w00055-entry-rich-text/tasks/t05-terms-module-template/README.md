---
schema: nbook.task/v2
taskId: t05-terms-module-template
status: done
updated: 2026-11-27
---

# 叫法：设定组改叫模块、预设改叫模板、设定组模板改叫版式

## 目标与范围

开发者 2026-11-27 定：界面上不要“组”的概念；Component 在界面叫“模块”，种类的预设叫“模板”，模块分页里可改的那段文字叫“版式”，种类不改名。把界面文案、Spec、组件文档、测试与 Lab 场景里的叫法改过来，行为不变。

合同：行为合同未变，只改叫法。改到的 Spec：[`canon/author-ui`](../../../../../docs/specs/canon/author-ui.md)、[`canon/agent-tools`](../../../../../docs/specs/canon/agent-tools.md)、[`canon/revisions`](../../../../../docs/specs/canon/revisions.md)、[`canon/components`](../../../../../docs/specs/canon/components.md)；另有 nb-ui 开发规范与 `Tabs.md` 里的一个例句。

## 当前状态

- 代码侧（`b889bd65a`，73 个文件，Sonnet 子代理按说明改，主会话审 diff）：canon 插件的中英文案、给 Agent 的工具说明与回话（“模块.字段”“没有模块”等）、组件文档、注释、测试标题与断言、Lab 场景名，nb-canon 的注释与测试标题。英文 Component 写 module、模板写 Templates；英文里指分组的 Group 不改。“添加 N 组”改成“添加 N 个”，“这组数值还没有内容”改成“还没有数值”。
- 没改的：代码标识符、文案键名与目录名（`addGroup`、`components/groups/` 等）；内核的“预设字段”（`components.md` 输出 24，字段声明的预设，与种类的模板无关）；勾选列表按“适用于、设定、剧情、插件”分段的“组”（列表的分段，不是模块）；编辑区的组、待处理三组；Lab 草稿区的旧草稿；ADR、提案与旧 Task 记录。“版式”目前只在 Work 的决定里，代码与 Spec 里还没有这段文字，等设定组模板（现在叫模块的版式）开工时直接用新名字。
- Spec（master，按行限定的脚本加逐处核对）：“设定组”“一组设定”改“模块”，种类登记的 `presets` 改“模板”，主按钮写“添加 N 个”。
- 验证：canon 插件目录与 Lab 场景挂载 45 个文件 331 条、类型检查、nb-canon 改到的两个测试文件都过；e2e `canon-character`、`canon-write` 14 过 1 失败，失败的是原有的年龄浮层左缘（704 对 710.5）；docs:check 过。合入 master（快进到 `b47080d51`）。

## 下一步

已完成。Work 接着按顺序做标签登记表的演示稿。
