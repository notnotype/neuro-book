---
schema: nbook.task/v2
taskId: t65-editor-drag-drop-and-divider-fixes
---

# 标签拖放泄漏、预览模糊与分界线一致性

**状态：已实现并验证**（2026-09-19；开发者四点反馈里的第 2、3、4 项为实现，第 1 项为解释）。证据见 [walkthroughs/implementation.md](walkthroughs/implementation.md)。

## 反馈与结论

1. 「产品多组未启用」是什么意思 —— 见下「产品多组未启用」。
2. 主页拖 Tab 分屏松手时对下方编辑器触发 drop，把标签当文字输入正文 —— **缺陷，已修**。
3. 分屏预览矩形不该做模糊 —— **已去掉**。
4. grid 分界线横竖样式不统一、交叉处应同时高亮 —— **两处都已修**（半像素抗锯齿 + 跨分支交叉高亮）。

## 根因

- **drop 泄漏（系统排查结论）**：`EditorGroup` 原先只在**冒泡阶段**用容器接 `dragover/drop`。真实视图（TipTap/ProseMirror、Monaco）在自己的 DOM 节点上处理 `drop`：
  或 `preventDefault` + `stopPropagation` 自行插入内容，或把 `text/plain`（拖拽时写入的正是标签路径）当浏览器默认动作插进 textarea/contenteditable。
  容器处理器因此拿不到事件（拿到了也为时已晚）——标签路径被写进正文，正文变脏、可能被保存。
  证据：Lab textarea 视图上 drop 的 target 是 `TEXTAREA.min-h-0.flex-1`，`dataTransfer.text/plain = "src/story/chapter-02.md"`（修复前）。
- **预览模糊**：预览矩形类名里带 `backdrop-blur-[1.5px]`（实测 `backdrop-filter: blur(1.5px)`）。
- **分界线不一致**：横竖线用的是同一个 token、同一厚度（1px），差别在**像素栅格**：容器 386px 分成两栏时面板各 192.5px，
  纵向分界线落在 x=679.5 的半像素上，被抗锯齿摊成两条更淡的线；横向分界线落在整数像素上，于是"横竖不是同一款线条"。
- **交叉处只亮一条**：交叉处的横线各自止于竖线边缘（竖线覆盖 x∈[679.5, 680.5]，左右两条横线在它两侧就结束），
  指针在交叉点只命中竖线，横线不会一起高亮。

## 改动

1. **捕获层接管内部标签拖拽**（`app/components/editor-workbench/EditorGroup.vue`）：拖拽期间在正文区（有文档与空态两种）之上铺
   `[data-role="editor-drop-layer"]`（z-30），它是这期间唯一的拖放目标；`dragover` 一律 `preventDefault`，`drop` 一律 `preventDefault` + `stopPropagation`。
   视图收不到任何拖拽事件（浏览器实测 dragover 0 次、drop 0 次）。层只在内部拖拽期间存在，外部拖入文件/文本行为不变；删掉计数式 dragenter/dragleave 与 `isHoveringTabBar` 分支。
2. **落点承诺跟随宿主能力**：`allowSplit` 未打开的宿主不显示落点遮罩、不发 `split-tab` / `transfer-tab`，但仍吞掉 drop。
3. **拖拽状态收口**：drop 命中捕获层后**晚一拍**清拖拽状态（分屏会把源标签搬到新组，源元素的 `dragend` 没有冒泡路径；
   但宿主在 `split-tab` / `transfer-tab` 处理里仍要读到来源，同步清会把来源一起抹掉——Lab 夹具正是据此把标签**移动**到新组）；
   `useEditorTabDrag` 增加 window 级 `dragend` 兜底；捕获层收到 `pointerdown` 时自愈清状态（真实拖拽期间页面收不到指针事件）。
4. **预览去模糊**：去掉 `backdrop-blur-[1.5px]`；徽标胶囊自身的模糊保留（它是浮层标签，不改变下方内容观感）。
5. **分界线像素对齐**（`packages/nb-ui/src/components/layout/Splitter.vue`）：粗细取整数个设备像素，位置吸附到设备像素网格
   （`transform`，位移 ≤ 半个设备像素，不进入布局）；容器 resize、`layout`、`sashSizes`、方向、设备像素比变化都重新对齐。
6. **交叉高亮**（`GridRenderer.vue` + `Splitter.vue`）：最外层渲染器提供协调标记，按 2px 容差判定"指针在交叉处"，
   命中者写 `data-sash-cross="true"`，交叉处的整条水平线（左右两段）与其竖线一起点亮；样式仍归 `Splitter`。

## 范围与排除

- 不改产品多组接线（见下），不动 Storage、不改拖拽数据格式（仍写 `text/plain` 供外部目标使用）。
- 不引入第二套指针/键盘状态机；不把拖放判定下沉进 nb-ui（拖放是宿主词汇，nb-ui 只有渲染与几何）。

## 产品多组未启用

主页的编辑器仍是「一个组 = 一个叶」：`EditorWorkbench` 的 `allowSplit` 在主页面未打开，页面没有接 `split-tab` / `transfer-tab`，领域 store 的 `editorGroupId` 固定为 `main`，也没有编辑组布局的记录与恢复。要真正同时编辑两个组还需要三个独立产品切片：编辑组会话（标签实例与文档身份分离、命令按活动组路由）、页面多组接线（逐组挂视图宿主与全部事件）、布局恢复（组注册与 Grid 快照的统一恢复关系与拓扑提交）。本任务只修组件宿主的行为，不把这些隐含进来。

## 验证

- **nb-ui**：`bun run test` 全量 **23 文件 / 392 用例通过**；`src/components/layout` 106 用例（新增「分界线像素对齐」2 例、「分界线交叉高亮」1 例）；`bun run typecheck` exit 0；`bun run build:css` 已重建（新增 `data-[sash-cross=true]` 变体进 `dist/nb-ui.css`，diff 仅 15 行新增、无删除）。
- **neuro-book**：聚焦 **42 文件 / 380 用例通过**（含 `app/components/editor-workbench` 49 用例：捕获层能力门控、捕获层存在性 + window 兜底、跨组中心转移、来源在 drop 处理内可读）；`bun run typecheck` exit 0。
- **仓库门禁**：`docs:check` 6111 文件 0 失败；`governance:check` 0 失败 0 警告。
- **真实浏览器**（隔离服务 44777，独立 State/Cache 根）：
  - 修复前：drop target = `TEXTAREA`，携带 `src/story/chapter-02.md`。
  - 修复后：正文中心投放 —— 捕获层存在、无预览、视图 drop 0 次、textarea 值不变（39）；正文左缘投放 —— 预览显示「在左侧分屏」且 `backdrop-filter: none`，落点分屏成功（1 → 2 组），视图 drop 0 次；投放后捕获层与预览都卸载。
  - 标签移动语义：从 9 标签组拖 `chapter-02.md` 到左缘分屏后 `tabsPerGroup = [1, 8]`、总数 9 —— 标签被**移动**而非复制，证明宿主在 drop 处理里读得到来源。
  - 分界线：纵向分界线吸附前 x=679.5，吸附后 `transform: translateX(0.5px)`、实测位置 680（整数），厚度 1 设备像素；横竖线同 token 同厚度。
  - 交叉高亮：指针停在竖线与横线交叉处时三条分界线（竖线 + 左右两条横线）全部带 `data-sash-cross`。
- 未覆盖：主页上的端到端拖拽未能实测（隔离根里创建书籍静默失败，没有可打开的文档）；门控与捕获层由共享代码单元用例与 Lab 浏览器实测共同覆盖。

## 残余风险

- nb-ui `playwright` 自带 webServer 在本 worktree 起不来（`#app-manifest` 解析问题，环境问题，与本轮无关），e2e 仍走人工启动的 playground。
- 捕获层依赖 `activeDraggedTab` 这个共享状态；状态漏清会让正文区出现透明屏障。已加三层收口（drop 即清 / window dragend / pointerdown 自愈），但没有"永不泄漏"的形式化保证。
