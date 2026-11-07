---
schema: nbook.task/v2
taskId: t19-drop-zones
status: done
updated: 2026-11-06
---

# 落点分区

## 目标与范围

t01 决定 14：拖到面板正文上画出上下左右中五块，形状与判定一致；实时布局下退到卡片后面、只留淡线不写字，落点指示下压暗视图内容、线和文字都显眼。排在 t08 之前

合同：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出末尾新增“落点分区”。计划见 [`plan.md`](plan.md)。

## 当前状态

2026-11-07 已合入（`41b789bfa`），实现审查已处理（修正单独提交）。

- 和计划不同的地方：`--layout-sector-radius` 在 nb-ui 里缺省 0，工作台给卡片圆角（nb-ui 的令牌扫描不认外壳的变量）；SDK 按 `surface.test.ts` 列出组件。设置键是 `nbook.workbench/dropSectors`。
- 验证：`test:affected --since master --typecheck` 只有已知失败（`plugins/agent` 的跨插件导入、`permission-page`、`nb-agent-ui`、`nb-story` 的类型错误）；`SnippetsPage.dom.test.ts` 负载高时失败一次，单独跑通过。e2e：`workbench-dnd`、`lab-drop-sectors` 37 个通过；`editor-area` 的落点与拖动用例、`lab-drag-session` 30 个通过。`lab-scenes` 只有 ThemeEditor 假素材的 404（提交 `14051849a`，不是本 Task 的）；为看 404 之后的版面检查，临时放宽那一条跑了两次：第一次查出 Lab 卡片场景缝宽 8px 与产品不符（已改 4px），`EditorGroup/dialect` 工具栏一个按钮的光晕被裁只在负载高时出现一次。
- 截图给开发者看：产品页亮色，编辑组五块、侧栏三块（手感与默认开关由开发者确认）。

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，19 条：重要 8、建议 11）的处理：

| 条 | 处理 |
|---|---|
| 1 隐藏药丸 | 成立。改：药丸照旧，当前块不写自己的字；`hideLabel` 不做 |
| 2 `zonesAt` 绕开 `resolve` | 成立。分区跟 `dropAt` 走 |
| 3 层级 | 成立。新登记一档；预备区不动：它只在没有真实落点时算，那时没有分区 |
| 4 `variant: "live"` | 成立。t19 只做落点指示，实时布局的外观与挂载点 t08 定 |
| 5 命名 | 成立。代码用 `sector` |
| 6 令牌 | 成立。列全、登记、从现有变量派生、同步文档 |
| 7 圆角 | 成立。`--layout-sector-radius` 取卡片圆角 |
| 8 预备区、不变量 | 成立。分区跟真实落点走；工作台策略加网格扫描 |
| 9 只有标题的头 | 成立。算中央，照画 |
| 10 零面积 | 成立。守住 |
| 11 窄面板的字 | 成立。放不下不写 |
| 12 无障碍 | 成立，`aria-hidden`、`forced-colors`、`--motion-fast`；e 不再适用（药丸与 live 区不动） |
| 13 文档位置 | 成立，按它列的改 |
| 14 设置 | 成立。一个开关，只有 `user` 层，理由写在计划；进待确认 |
| 15 `data-drag-feedback` | 成立 |
| 16 验收 | 部分：a、b、d（除被菜单挡住）补；c 不做（对比度数值门禁超出这次的不确定性，开发者看图）；e 不再适用；f 补 |
| 17 文案 | 成立，中央复用 |
| 18 空面板的键盘停靠点 | 成立，顺手修 |
| 19 SDK | 成立，写明不导出 |

实现审查（一个 Sonnet，[`evidences/impl-review.txt`](evidences/impl-review.txt)，11 条：重要 2、建议 9）的处理：

| 条 | 处理 |
|---|---|
| Lab 缝宽改了、`lab-workbench-surface` 还按 8 断言 | 成立，我漏跑了这个文件。断言改成产品的 4 |
| 预备区盖住分区 | 不成立：按现在的骨架，预备区只叠在编辑组上；工具视图在编辑组上没有分区，编辑器标签不出预备区 |
| 放下的结果没有 e2e | 成立，补一例；任意位置由一致性测试守 |
| 收成标题行的缝结果 | 成立，这是有意的，测试写死 `center` |
| 失效的来源仍返回分区 | 不改：只在 `resolveLayoutDrop` 非空后调，到不了 |
| 夜间配色压暗后卡片轮廓淡 | 不改：线还画着这块的边，开发者看图时再说 |
| 与活动栏相连的直角 | 不改：一个 12px 的角，为它要把相连信息传给反馈层，收益小 |
| `--layout-sector-radius` 不该是主题令牌 | 成立，拿掉登记 |
| `ease-out`、`env:global` | 成立，改 |
| 小点 b、c、e | 成立，改；a（Lab 写死形状）、d（外沿半条线）、f（设置放的小组）、g（登记表次序）不改：a、d 只是外观场景与原型一致，f 已进待确认 |

## 下一步

无。
