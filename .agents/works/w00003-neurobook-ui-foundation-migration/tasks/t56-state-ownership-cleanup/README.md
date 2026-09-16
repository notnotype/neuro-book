---
schema: nbook.task/v2
taskId: t56-state-ownership-cleanup
role: tasker
---

# 收尾小切片：World Engine 尺寸归属与设置窗口尺寸归属

**状态：待实现。** 开发者选择的低风险收尾项（不影响主页面结构）。两项都只做**归属与清理**，不做整页搬迁。

依据：[清单 §2.6 与 §2.7](../../view-migration-inventory.md)（含行号）、[storage.persistence](../../../../../docs/specs/storage/persistence.md):95/97、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md):103/121。

## A. World Engine 内部尺寸归属（project/local）

- 现状：三处尺寸是组件自持 ref——`WorldEngineWorkbenchDialog.vue:105-107`（默认 320/420/292）与 `:162-164`；子组件 `WorldEngineWorkbenchPreviewSidebar.vue:121-130`、`…Inspector.vue:355-364`、`…MutationEditor.vue:386-395` 各挂一个 `useResizablePanel`。
- 目标：改为读/写 **project/local** 记录（`persistence.md:95` 明列「World Engine 内部尺寸」）；无旧值迁移，纯新增归属；默认值仍取 `:105-107` 的同一批常量，不另开 localStorage。
- 记录定义放**能被 Nitro 与 app 同时 import** 的位置，并**追加到唯一注册入口** `server/storage/product-definitions.ts`（成批一次落盘，见约束）。

## B. 设置窗口尺寸归属（user/local）

- 现状（裸键，违反 `boundaries.md:103`）：`NovelIdeSettingsDialog.vue:487` 的 `nbook.settingsDialog.size`（默认 1120×640 `:489`，读 `:496-500`、写 `:520-524`）与 `project-picker/components/ProjectCreateDialog.vue:27` 的 `nbook.projectCreateDialog.size.v2`。
- 目标：并入 **user/local** 记录，与书架模式同一 owner（`workbench.layout`）；迁移为一次性：读旧键 → 记录缺失时条件初始化 → 回读验证一致后删旧键；已有记录不得被旧键覆盖。
- 旧键删除后，组件内不得残留第二写路径。

## C. 文档修订（随本 Task）

- `settings/sections/{providers,web,security,desktop}/*.md` 四处仍写「旧面板/旧宿主继续负责…产品接线时再消费本视图」，而宿主已真实接线——改为与实现一致的表述（只改过时句，不重写文档）。
- `RolesSettingsView` 未挂宿主：**本 Task 只登记决策、不实现**（等后端契约）；在清单 §2.7 注明状态即可。

## 排除

- 不做 World Engine 整页迁入 View Host（切片 3 检查点既有裁定：单列）。
- 不动 `agent/**`、`markdown-studio/**`、Plot、文件树（上一增量已交付）。
- 不新增裸 `localStorage`/`sessionStorage`；不改 Config authority（`/api/config/*`）。
- 不删除四个 World Engine legacy 组件，**除非**同时满足：全仓零引用 + 契约测试许可；满足则删除并在报告给证据，不满足则记一条待办。

## 约束（重要）

- **3001 是开发者正在使用的服务**（hub 名 `neurobook-3001`，已带 `restart: on-failure`）：禁止启停/重启它；**不得**在本 worktree 里启动第二个 dev server（共享 `.nuxt`）。
- **服务端模块改动成批落盘**：`server/storage/product-definitions.ts` 的编辑会触发 Nitro 重建并可能带走 3001——请把服务端侧改动攒成一次，落盘前 `hub send` 报 Main。
- 类型门禁用只读方式（`bunx tsc --noEmit -p tsconfig.json`），禁止 `bun run typecheck` / `nuxt prepare|generate|build` / `bun run dev`。
- 不提交、不 push；只逐文件 `git add`（禁止对目录 add）；不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`。

## 验证与交付

- 聚焦测试：A 的尺寸会话（首读门禁/条件初始化/冲突不静默/无第二写路径）、B 的旧键迁移（记录已存在→旧键删且 record 不被覆盖；记录缺失→条件初始化并回读后删旧键）。
- 真实浏览器：**无需新宿主**——A 与 B 的持久化行为可用聚焦测试 + 对 3001 的只读观察覆盖；若确需交互取证（例如拖尺寸后刷新），先 `hub send` 报 Main（3001 归开发者，不得打断）。
- 报告写 `walkthroughs/implementation.md`：真实命令、cwd、退出码、用例数、实际落盘的记录路径、未运行项与偏差。
- 最终回复具体结果，不返回空文本或句点。