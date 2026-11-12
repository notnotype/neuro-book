---
schema: nbook.task/v2
taskId: t23-comments-margin-by-block
status: done
updated: 2026-11-12
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

无。待开发者做的事记在 [待确认清单](../../pending-confirmations.md) 的 t23 各行：试一下小符号在行尾的光标与输入法组字、⌘ 悬停与点击；页边里紧凑列表的累计偏移。
