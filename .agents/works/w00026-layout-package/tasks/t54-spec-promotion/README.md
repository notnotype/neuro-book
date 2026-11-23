---
schema: nbook.task/v2
taskId: t54-spec-promotion
status: active
updated: 2026-11-23
---

# nested-grid 与 layout-drag 晋升 implemented

## 目标与范围

[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 与 [`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 逐句核对后补测试、改窄与实现不符的句子、宿主一侧没做的标“（planned）”，整份晋升 `implemented`（开发者 2026-11-23 批准）。

合同：两份 Spec 的行为不变；改的是措辞贴实现、补漏写的公开接口，以及成熟度。

## 当前状态

2026-11-23：逐句核对（Claude Opus，三段并行，只读）的结果：

| 段 | 句数 | 守住 | 部分守住 | 实现了没测试 | 没实现 | 与实现不符 | 证据 |
|---|---|---|---|---|---|---|---|
| nested-grid 输出 1–78 | 97 | 73 | 15 | 8 | 0 | 1 | [check-a](evidences/check-a.txt) |
| nested-grid 输出 79–156 与其余各节 | 249 | 195 | 28 | 21 | 4 | 1 | [check-b](evidences/check-b.txt) |
| layout-drag 整份 | 123 | 97 | 15 | 6 | 0 | 5 | [check-c](evidences/check-c.txt) |

dom 测试（vitest）核对时没获准运行，相关判定是读断言得出的；补测时一并跑。

### 处置

条目编号用核对报告里的写法（a、b、c 三份）。

**补测试**，分三组，各在自己的 worktree，由编码子代理按报告的“建议”写，主会话审 diff、自己跑验证后合入：

- **A：nb-layout 的单元与 dom 测试（nested-grid）**：a 的输出 9、12、13 第 2 句、14 第 2 句、16、19、24、25、30、40（`useGridHost` 一侧）、51 到 56、67、75；b 的输出 89、90（dom 部分）、95、99、101、113（矩形）、131、139（`params` 的值、`no-collapse-policy`、`no-entering`）、140 各句、142、143、155、156，状态与转换的 261、265、272、273 行，副作用的“两个实例互不影响”，失败 6 的 `handler-threw` 文字、失败 7 的 `dropped` 与 `clamped`。
- **B：nb-layout 的单元与 dom 测试（layout-drag）**：c 的第 2（`axis: "both"`）、5、6、7、8、9、10、11、12、13、15、16、17、18、19、20、21、23、24 条；b 副作用的源码扫描（`fetch`、`localStorage` 等）与 c 第 12 条的 `window`、`document` 扫描一起放进 `boundary.test.ts`。
- **C：e2e**：a 的输出 10、13（减少动效）、14（focus-visible）、28、36（主线程繁忙）；b 的输出 86、87、88、90、104、107、110、112、113（不接指针）、114、117、125、129，副作用的“祖先缩放”，验收 5（`pageerror`）、10；c 的第 14、25、26 条。

**改 Spec**（主会话，在 master 上）：

- 贴实现：a 的输出 11（固定 1 CSS px 的是静止接缝）、40（经 `useGridHost` 接线时）、78 后半句（宿主拿到分支 id）；b 状态与转换 270 行的 scale 一半标“（planned）”；b 的“承载盒无 padding 与 border”挪到输入与前置条件作宿主约束；c 的第 1 到 5 条（`scroll` 注释、`axis` 补 `"both"`、补 `useDragSession` 签名、边缘带相接时不滚、第二次按下的实际语义）、第 16 条（取不到捕获只认两种错误）、第 24 条（状态表补两种转换）。
- 标“（planned）”：失败 2、3 里宿主那半句，验收 3、6，验收 5 里宿主那半句。
- 删或改写措辞：输出 141 的“外观与过渡同今天”删掉；“副作用与数据”里“两轴格式的版本与兼容迁移在对应原语实现切片中固定”改成快照版本与拒绝的事实。
- 补测试后去掉对应的“（planned）”（输出 139、140 与失败 6 的几处）；开头“晋升之前要补的”清单删掉，没做的留在句子后面的“（planned）”里。
- 晋升：`status: implemented`，补“实现合同”，证据补齐，注册表“说明”去掉“待晋升”。

**不补、照现状**：

- c 第 22 条（wake 的监听先于会话挂上）：是给宿主的用法说明，由 `workbench-drag-cost.e2e.ts` 的每帧样式重算上限间接守着，不做“挂反了”的对照实验。
- a 输出 77 的夹具两组外接矩形一样大：区分得不强，但断言是对的，不改。

## 下一步

开三个 worktree 派 A、B、C；它们跑的同时改 Spec 的措辞。三组合入后跑受影响的测试与 e2e，再晋升；实现审查（Claude Sonnet，不阻塞）。
