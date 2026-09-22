---
schema: nbook.task/v2
taskId: t64-grid-splitter-unification
role: leader
---

# Grid 与 Splitter 共用整改（两个宿主消费同一套布局原语）

**状态：已实现并验证**——方案由开发者于 2026-09-19 批准（`local://grid-splitter-unification-plan.md`），证据见 [walkthroughs/implementation.md](walkthroughs/implementation.md)。

## 结果

nb-ui 的布局原语从「只有工作台外壳在用」变成两个宿主共用的唯一实现：

- `Grid.splitLeaf` 补上「把一个叶按方向拆成新分支」的原子操作（`GridSplitInput`：方向 + 前后侧 + 意图比例），节点数与深度上限从快照恢复扩到结构操作；`Grid.find` 提供只读查找，宿主不再各自重走树。
- 递归渲染层与几何换算升到 nb-ui：`GridRenderer.vue`（每个分支一个 `Splitter`、叶走插槽）与 `grid-splitter.ts`（`gridBranchSizes` / `buildGridBranchPanels` / `gridBranchGesture`）。原 `WorkbenchBranch.vue` 与 `workbench-branch-layout.ts` 删除，不留兼容层。
- `Splitter` 增加受控 `sizes`：挂载后也能同步程序布局（Reka 的 `defaultSize` 只在挂载时生效），等值发布忽略、发布前取消失效手势、只发 `layout` 不产生用户提交；sash 的层级与命中区收回组件自身，宿主的 `:deep([data-branch] > div > [role="separator"])` DOM 结构 hack 删除。
- 主工作台：外壳与 Spike 直接消费 `GridRenderer`；`layout-session` / `storage-grid-host` 改用公共换算；尺寸变化不再重挂 Splitter（原来靠递增 epoch 重挂来同步默认尺寸）。
- 编辑器工作区：`EditorWorkbench` 统一为受控 `groups + tree + layout + activeGroupId`，事件全部带组 id，单组也是「一个叶」；`EditorGroup` 改吃整组渲染模型；自有二叉树 `editor-layout.ts` 与 `EditorLayoutRenderer.vue` 删除，方向词映射与手势提交收进 `app/utils/editor-workbench/editor-groups.ts`。
- nb-ui 新增窄入口 `@notnotype/nb-ui/layout`：不做几何的消费者不再为一个 `createGrid` 拉进整个组件桶（这也是 `useEditorWorkbench` 用例超时的真因）。

## 范围

- `packages/nb-ui/src/components/layout/`（grid、grid-splitter、GridRenderer、Splitter 与各自文档/用例）、`components/index.ts`、`README.md`、`docs/ui-development-spec.md`、playground `NestedGridFixture`、`e2e/nested-grid.spec.ts`。
- `packages/neuro-book/app/components/workbench{,-spike}/`、`app/utils/workbench/{layout,shell-layout,layout-session,storage-grid-host}.ts`、`app/utils/editor-workbench/editor-groups.ts`、`app/components/editor-workbench/`、`app/composables/useEditorWorkbench.ts`、`app/pages/index.vue`、`app/component-lab/fixtures/EditorWorkbenchFixture.vue`。
- 合同文档：`docs/specs/ui/nested-grid.md`（拆分与渲染合同、第 7 条验收）、`EditorWorkbench.md`、`Splitter.md`、`grid.md`、`GridRenderer.md`。

## 排除

- 不做真实产品的多编辑组：**编辑组会话**（解除 `editorGroupId` 固定值、标签实例与文档身份分离、命令按活动组路由）、**页面多组接线**与**编辑器布局持久化**是三个独立产品切片，缺一不得宣称「产品支持分屏」。
- 不引入 Editor 布局记录、不改 Storage 定义、不迁移任何旧键。
- 不动并行进行中的 AgentChatFlow/命令面板工作（`LabShell.vue` 等在本轮期间被另一路改动，本轮只读不碰）。
- 不碰 3001 与开发者真实 State Root；浏览器验证走本任务自建的隔离服务与系统 Temp 数据根。

## 实现要求与判定

1. **意图与呈现分开**：`splitLeaf` 只分「目标在新轴上的意图」，新轴意图为 0 时两端取统一正权重——按测得的 px 分配会在目标意图为 0 时把面板压成 0。
2. **公共层不认识业务**：`GridRenderer` / `grid-splitter` 不出现 Part、Editor Group、标签、Storage 词汇；方向词与产品语义留在宿主。
3. **尺寸不靠重挂**：程序布局走受控 `sizes`；拖拽与容器 resize 都不卸载叶内容。宿主只在子节点集合变化或换树时重挂。
4. **一次手势一次提交**：换算（百分比 → px）与原子提交（`resizeBranch`）只在宿主侧各做一次，`gesture-end` 是唯一保存入口。
5. **失败不留半棵树**：拆分失败不改树、不发布新组、不动源标签。

## 约束

- 公共导出与公共文件由单一执行者维护；组件索引与文档同批更新。
- 无真实 Provider/Model 调用、无远端写入、无数据库迁移（隔离验收根除外）。

## 验证

- **nb-ui**：全量 `bun run test` → 21 文件 / 377 用例通过；`bun run typecheck` exit 0。
- **nb-ui e2e**：`e2e/splitter.spec.ts` + `e2e/nested-grid.spec.ts` → **30 passed**（对手工启动的 playground 复跑；配置自带的 webServer 在本 worktree 起不来，见残余风险）。
- **neuro-book**：`bun run test app/utils/editor-workbench app/components/editor-workbench app/components/workbench app/utils/workbench app/component-lab app/composables/useEditorWorkbench.test.ts` → 42 文件 / 376 用例通过；`bun run typecheck` exit 0。
- **真实浏览器**（隔离服务 `http://127.0.0.1:44777`，独立 State/Cache 根）：编辑器 Lab 单组 → 二组 → 三组 → 四组（2×2）连续分屏、指针拖拽守恒、键盘调整、内层调整不改外层、内容与标签跨拓扑保留、390 宽无横向溢出；主页外壳 + 编辑器同屏、外壳分栏拖拽守恒、容器缩小时编辑器 DOM 节点保持。`Component Lab smoke --suite core` exit 0。

## 未运行与残余风险

- nb-ui Playwright 配置自带的 `webServer` 在本 worktree 启动失败（`Failed to resolve import "#app-manifest"`，Nuxt/Vite 解析问题，与被测代码无关），e2e 改为对人工启动的 playground 复跑；该环境问题未修复。
- 四主题浅深色矩阵未做完整扫：本轮只覆盖默认主题与一次主题切换尝试，几何结论与主题无关。
- 编辑器多组的产品接线、组会话与布局恢复未实现（见「排除」），需要时另立切片。
