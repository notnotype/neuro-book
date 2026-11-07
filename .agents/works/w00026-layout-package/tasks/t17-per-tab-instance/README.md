---
schema: nbook.task/v2
taskId: t17-per-tab-instance
status: done
updated: 2026-11-06
---

# 每标签一实例

## 目标与范围

每个打开的编辑器标签有自己的实例，切走隐藏不卸载，移到别的组不重建，撤销历史跟着走；每种编辑器保留最近 20 个，其余卸载且不丢光标、滚动与撤销。提案第 2 节。排在 t07 之后、t08 之前，t08 的卡片带真内容走依赖它。

合同：[workbench.editor](../../../../../docs/specs/workbench/editor.md) 术语、输出 7、10、49；[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 14、27、33。计划见 [`plan.md`](plan.md)。

## 当前状态

2026-11-06 已合入（`421a091b6`），2026-11-07 实现审查已处理（修正单独提交）。

- 做了什么：绑定、视图状态与控件留下的实例按标签存；内容项按标签分开，`EditorGroup` 是一个标签的内容；每种编辑器留 20 个控件。
- 和计划不同的地方：焦点交接没用 `nextTick`，并进了继续写作的等待路径（`pendingReveal`）：要等文档就绪、控件登记，内容也可能还停放着，这条路径已经全管了，单写一份反而会把焦点给还隐藏着的控件。键盘放下由手势把焦点还给标签，所以 `moveTab` 加 `focusView`，手势的 `commit` 带 `keyboard`。计划里“切走时焦点在内容里就交接”没做成通用机制，只有面包屑选文件要它（`open` 的 `reveal: "cursor"`）；别的路径落到 `onContentParked` 的活动标签。
- 验证：`bun run test:affected --since master --typecheck` 只有别的 Work 的已知失败（`plugins/agent` 的跨插件导入、`permission-page.dom.test.ts` 的类型错误）；`governance:check`、`docs:check` 没有失败。e2e 用 `NB_E2E_WIDE` 跑了 17 个文件 256 个用例，处理后只重跑失败项，全过，只剩 `lab-scenes` 的 ThemeEditor 两个场景 404（夹具里的假素材地址，提交 `14051849a`，不是本 Task 的）。
- 测量：[`evidences/measure-tabs.txt`](evidences/measure-tabs.txt)，脚本在 [`scripts/measure-tabs.e2e.ts`](scripts/measure-tabs.e2e.ts)。到 20 个标签后挂着的元素不再涨，关掉全部后回到基线；Markdown 每个标签约 0.9 MB，preview 连走中位 64ms、最大 120ms。

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，15 条：阻断 1、重要 7、建议 7）的处理：

| 条 | 处理 |
|---|---|
| 1 回收后 Markdown 丢撤销 | 成立，阻断。报告给了三个选项要开发者定；选 (c) 不改已定的要求：回收只卸组件、留着 TipTap 实例，撤销、滚动、未裁决都在，开发者原话“不丢”成立。代价是回收只省 DOM，片 2 量 |
| 2 焦点落到停放的内容上 | 成立。`nextTick` 之后再聚焦；`onContentParked` 按输出 16 给活动编辑组 |
| 3 preview 留同一个 `tabId` | 成立。放弃，照旧换 id，建控件的代价片 2 量 |
| 4 释放路径 | 成立，写明三条 |
| 5 回收策略不够细 | 成立。一个 `watch` 盯活动标签集合，按编辑器种类；“不淘汰”的条件不需要：槽不淘汰了 |
| 6 页面标签 | 成立。页面只在活动时渲染，和现在一样 |
| 7 类型抓不到、中间态 | 成立。接口改名；片 1 不拆开合入 |
| 8 验收写不出 | 成立。上限只在 Lab 与单元注入；同一性用 DOM 节点比 |
| 9、12、13、14、15 | 成立，写进计划；14 接受 |
| 10 内存 | 接受取舍，片 2 量 |
| 11 Spec 清单 | 成立，补 |

实现审查（一个 Sonnet，[`evidences/impl-review.txt`](evidences/impl-review.txt)，8 条：重要 1、建议 7）的处理：

| 条 | 处理 |
|---|---|
| F1 假冲突 | 成立。Markdown、Monaco 的结算回调在没跟上别处的修订、又没有待交的输入时不交；补 dom 用例，变异检查确认能抓到；控件合同写进 Spec |
| F2 回填 | 成立。留着控件的集合改成显式的：掉出去不回来，除非又活动一次 |
| F3 绑定带着已释放的槽 | 成立。放掉换下的编辑器时同时放绑定 |
| F4 换组丢等待 | 成立。等待不记组，按标签找 |
| F5 测试 | a、b、c、d、e、f 都补；`aria-owns` 补单测，`EditorGroup` 补 dom 测试；`files-explorer` 的选择器改成活动组 |
| F6 文档 | 都改 |
| F7 代码质量 | a、b、c 改；d 不改：`binding` 里那道闸门防的是取绑定就打开文档，留着不费事 |
| F8 性能 | b 改：这块内容的计算值只比引用与布尔，别的标签变了不重画；c、d 不改：计划已接受，测量见上 |

顺带发现：`markdown-editing` 的“没有选区时剪切、复制置灰”按完 Escape 不等菜单收起就按 Ctrl+A，焦点还在菜单上，三次失败两次；改成等菜单收起。

## 下一步

无。
