---
schema: nbook.task/v2
taskId: t54-spec-promotion
status: done
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

### 补测与晋升（2026-11-23）

三组由编码子代理（Claude Opus）在各自的 worktree 里写，每条用例都把被守的那行产品代码改坏跑过一次；主会话审 diff、合进 `w00026/t54` 后自己跑验证。

- A（nb-layout，nested-grid）：报告里分到的条目全部补上。补测时发现输出 16 没做到：悬停未满 250ms 时切走窗口，页面级光标留着、计时到点照样显现；拖动中失焦取消后又按最后坐标把光标拿回来。已修（`useSashGesture` 失焦时复位悬停）。
- B（nb-layout，layout-drag）：全部补上，产品代码没改。第二次按下的实际语义（键盘拖动中按在来源上：先按 `pressed-elsewhere` 取消，同一次按下照常进入待起拖）与 Spec 改过的那句一致。键盘拖动里 `commit` 抛出时不还焦点，写进 Spec“失败与恢复”，不改实现（[待确认清单](../../pending-confirmations.md)）。
- C（e2e）：全部补上。补测时发现祖先带缩放时分隔线位移没换算（`scale(0.5)` 下拖 60px 只提交 60），已修（按下时冻结根的缩放比）。已知盲区：恢复的 watch 里同步抛出的异常被 Vue 接住、只打 `console.error`，验收 5 的“没有 `pageerror`”看不到它（从代码推断）。

合入 master：`520ef8b47`（审查修正 `4c21407a5`）。两处修复在 nb-layout 0.1.0 发出之前，随 0.1.0 一起发，不另记变更记录。

验证（`w00026/t54`）：nb-layout `typecheck`、`test`（bun 472、vitest 342）、`api:check` 通过；应用 `typecheck` 通过；8 个受影响的 e2e 文件 212 条，211 过，失败的 `files-explorer.e2e.ts:629`（右键菜单项被盖住）是 master 上就有的。

实现审查（Claude Sonnet，只读，[报告](evidences/impl-review.txt)）：阻断 0、重要 0、建议 7。

| 条 | 处理 |
|---|---|
| 1 Tab 全亮在减少动效下区分不出“立即” | 改：用例切到不减少动效，断言第一次读就是 1、没有在走的过渡 |
| 2 祖先缩放只测了横向、整数比例、无抓取偏移 | 改：`scale(0.75)`，横向偏离中心 1px 按下，补纵向线；把纵向比例改成 1 的变异下用例失败 |
| 3 `offsetWidth` 取整误差与旋转 | 改：差不到 1px 按没缩放算，注释写明不支持旋转与斜切 |
| 4 `NestedGrid.dom.test.ts` 夹具重复约 80 行 | 不改：只是测试里的重复，抽公共函数要动 600 行新用例，收益小 |
| 5 两处假计时器没有 allow 注释 | 改 |
| 6 源码扫描漏了几个网络与存储的名字 | 改：补 `XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon`、`cookie`、`caches`；字符串里的 `/*` 被当注释起点的漏报不改，包里没有这种写法 |
| 7 写死坐标与负载下可能偶发 | 不改：这轮负载 3 到 5 下整份跑过；真出现偶发时按已知偶发处理 |

Spec：`ui/nested-grid` 去掉补测覆盖的“（planned）”与开头“晋升之前要补的”清单，证据补 `splitter.dom.test.ts`、`FloatWindowHandles.dom.test.ts` 与 `workbench-float.e2e.ts`；`ui/layout-drag` 补“实现合同”，证据补 `boundary.test.ts`。两份 `status: implemented`，注册表移到“已实现规范”。宿主一侧没做的仍标“（planned）”：设备像素比变化取消手势、失败 2 与 3 的宿主半句、验收 3、5 的宿主半句、6。

## 下一步

无。t54 完成。
