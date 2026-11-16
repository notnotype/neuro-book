---
schema: nbook.task/v2
taskId: t23-comments-margin-by-block
status: done
updated: 2026-11-13
---

# 批注：Ctrl 悬停与小符号打开，页边按段落排位

## 目标与范围

t22 之后开发者的第二轮反馈：悬停 0.4 秒弹卡片改成按住 Ctrl 悬停或点击立刻弹、批注末尾加小符号点击才弹；页边改成一段一个槽位（顶边对段顶、最小段高、下一段无批注放宽到两倍、同段多条批注切换、展开与编辑浮动）

开发者 2026-11-12 试用 t22 后的第二轮反馈，方案会话里确认（“可以”）：

1. 悬停 0.4 秒弹卡片改成：按住 Ctrl（macOS 上 ⌘ 也行）把鼠标停在批注上或点批注，立刻弹；批注末尾加一个小符号，点它弹（页边没画出来时）。
2. 页边按段排槽位：顶边对段顶；高度不小于段高（封顶约 8 行意见）、不高于段高，下一段没有批注时放宽到两倍段高但不越过下一段底边；同一段几条批注合用一个槽位、`‹ 1/3 ›` 切换；展开与编辑浮着，槽位的位置与占位不变；页边卡片去掉底行，按钮浮在右上角。

合同：[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 29、30、32、33、38 与验收 11–16、21、22。计划：[plan.md](plan.md)。

## 做了什么（2026-11-12）

- **打开方式**：去掉悬停计时。按住 Ctrl（⌘）悬停或点击批注文字立刻弹（悬停的离开 0.25 秒收，点击的是“点开的”）；批注末尾的小符号（`MarkdownCommentMarkers` 挂件装饰，`marks: []`，同处结束的合成一个带条数）点开，再点收起；符号与 Ctrl 点击的 `mousedown` 在捕获阶段 `preventDefault`，不动光标，也不让 ProseMirror 把 Ctrl 加点击当成“选中整个块”；页边画着时符号由 `MarkdownControl` 的 `data-comment-margin` 隐藏。点击正文之后指针停着按 Ctrl 不弹。
- **页边按段排槽位**：`territoryAt`、`territoryOf`、`nextTerritory`（nb-markdown，只看文档）定“段”；`MarkdownCommentMargin` 量段的盒子，`slotRange`（纯函数）算高度范围，卡片的自然高度夹在里面，限行数由最大高度算出；同一段几条批注合用一个槽位，`‹ 1/3 ›` 切换（点箭头=选中那条，光标过去）；展开（点卡片空白或点编辑）卡片面在原地向下长、浮在后面的槽位上面，槽位按展开之前的高度占位，别的槽位不动；待写的新批注是浮着的单独槽位；卡片去掉底行，编辑、删除浮在右上角。
- **规范**：nb-ui 的 `ui-development-spec.md` 与 `design-language.md` 补“一列卡片里某一张展开时浮着”。
- **Lab**：新增场景“批注页边：一段几条批注、短段与长段、下一段有无批注、表格行”。

## 第二轮反馈修正（2026-11-13）

开发者试用 t23 后提了三条：（1）右栏批注右上角的控件浮在文字上、挡住了字；（2）点击展开后收起的动画是不是没做；（3）批注的 surface 不符合 UI 规范，太透明、没有模糊。分支 `fix/w00025-t23-comments-margin-polish`（提交 7bfd06222、e83eabfaf）。

- **按钮不压字**：编辑、删除（有同段切换时连同 `‹ 1/3 ›`）的位置在意见第一行里用一个浮动的占位一直留着，文字绕开，按钮显隐不改变文字位置；只读又只有一条时没有占位。原来是绝对定位浮在第一行上、靠半透明底色“盖”，违反 ui-development-spec 第 3 节第 4 条（只在某个状态出现的零件放进预留的位置）。代价：一行意见的卡片第一行少约 44px（有 `‹ 1/3 ›` 时约 120px）。
- **收起的动画**：卡片面的高度其实有过渡，但意见的限行是一帧内跳变，文字先被截成几行、框再慢慢缩。现在收起时意见晚一个 `--motion-move` 才限行（CSS `allow-discrete`，只对已显示的槽位开），框收完才出省略号；展开仍立刻放开。因此没展开的卡片的自然高度改由意见全文的高度（`scrollHeight`）与限的行数算，不再读被延后的卡片实际高度，限行数与自然高度的两步收敛也随之变成一步。
- **卡片面的材质**：当前、展开、写着的卡片面原来用 `--overlay-surface`（半透明）却没有磨砂，展开后盖在别的槽位上能透出下面的字。现在这些状态给卡片面加浮层基座 `.nb-ui-popover-surface`（与浮层里的批注卡片同一种材质，MarkdownToolbar 底部形态已有同样用法），其余仍是实心淡底；淡底的规则写成 `:not(.nb-ui-popover-surface)`，因为 scoped 样式不在 `@layer` 里会压掉基座。页边卡片排除皮肤的浮层画框。
- Spec `workbench/markdown-editing.md` 输出 33、验收 22，`theme/skins.md` 输出 13，两个同名文档同步。
- 验证：markdown 与 editor 插件 174 个单元用例过；`markdown-comments` 36 例过（新增 3 例：按钮不压字、卡片面材质、收起时文字等框收完）；变异检查 5 处（去掉占位、收起不延后限行、不加浮层基座类、自然高度读卡片实际高度、去掉 `[data-ready]`），都变红后已还原。取证见 [ui-check-2.txt](evidences/ui-check-2.txt)。
- 实现审查（Sonnet，前端）：7 条（重要 1、建议 6），[报告](evidences/impl-review-2-sonnet.txt)，[逐条处理](evidences/impl-review-2-disposition.txt)：重要那条是新 e2e 里一个断言空转，已改；皮肤画框会画在页边卡片上（已排除）；延后限行也会在重新折行时生效、Firefox 124 与 Chrome 119 里占位可能多占一行（未验证）两条记入待确认清单。

## 当前状态

**已完成，2026-11-12 合入 master**（不 push）。worktree 与分支已删。

验证（2026-11-12）：

- 类型检查：nb-markdown、neuro-book 通过。
- nb-markdown `bun run test`：265 个 bun 用例、267 个 vitest 用例全过。neuro-book：markdown 与 editor 插件的 171 个 vitest 用例、`margin-layout` 与 `locales` 的 bun 用例全过。`governance:check`、`docs:check` 无失败。
- e2e：`markdown-comments` 33 例全过（审查修正后重新构建三份产物再跑）；与 `markdown-editing`、`editor-area`、`lab-scenes` 一起跑过一轮（130 例，126 过）。失败的 4 个：`lab-scenes` 的 ThemeEditor 404（在 master 上同样失败，t22 记过）；`editor-area` 的“有未保存的修改时离开页面先请求确认”与 `markdown-editing` 的“拆分后”那条是已知偶发（见 [t17](../t17-e2e-open-file-wait/README.md)），单独重跑都过；`markdown-comments` 的同段切换那条是我写的，光标从程序挪的位置起步，等选区同步后逐格走，重复三次都过。
- 变异检查：审查前七处、审查后五处，都变红后已还原；展开占位那处第一轮存活，补了用例（见处理记录）。
- UI 取证：[ui-check.txt](evidences/ui-check.txt)，截图在 `evidences/`：槽位顶边与段顶一致、高度范围、同段切换、展开浮着（别的槽位相对位置不变）、符号与点开的卡片（左缘与批注起点差 1px）、Ctrl 悬停 9 到 13 毫秒出现、390px 视口卡片在窗口内。
- 实现审查（Sonnet，前端）：11 条（阻断 0、重要 1、建议 10），[报告](evidences/impl-review-1-sonnet.txt)，[逐条处理](evidences/impl-review-1-disposition.txt)：10 条成立并已改（点开的卡片被 Ctrl 悬停降级、批注没了又回来时卡片自己弹出、`overCard` 不复位、`nextTerritory` 扫全文、记忆不随改意见更新、符号在没有批注层的宿主里是死按钮、页边画着时 Ctrl 点击被吞、文档与注释不一致、槽位高度口径、测试缺口），1 条（键盘改意见保存后开出悬停的卡片）是 t22 就有的行为，不改，记入待确认清单。

未验证：真实输入法在符号旁组字；macOS 真机的 ⌘ 悬停与点击；触屏点符号；符号在行尾用方向键走过时光标行为（只在无头 Chrome 里点过一次）。

## 下一步

无。待开发者做的事记在 [待确认清单](../../pending-confirmations.md) 的 t23 各行：试一下小符号在行尾的光标与输入法组字、⌘ 悬停与点击；页边里紧凑列表的累计偏移；右上角按钮占位让第一行变短是否可以接受；Firefox 里每张卡片第一行是不是空了一行。
