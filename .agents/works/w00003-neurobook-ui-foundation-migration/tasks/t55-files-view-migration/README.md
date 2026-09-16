---
schema: nbook.task/v2
taskId: t55-files-view-migration
role: tasker
---

# `files` 视图接入：左叶文件树与工具面板

**状态：已实现并验证（2026-09-16）。** 交付物见 [`walkthroughs/implementation.md`](walkthroughs/implementation.md)（聚焦测试 30 例、只读 typecheck、真实浏览器验收、未运行项与偏差）。第一个视图迁移（[清单](../../view-migration-inventory.md) §2.1 指定，开发者选定）。目标是把**已在仓库里但从未挂载**的文件树接回外壳左叶，并把展开项从裸 `localStorage` 并入 Storage 归属；**不重写**既有文件树实现。

依据：[清单 §2.1](../../view-migration-inventory.md)（六类证据与行号）、[storage.persistence](../../../../../docs/specs/storage/persistence.md):94-101、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md):103/121、[workbench-view-host 提案](../../../../../packages/neuro-book/docs/proposals/workbench-view-host.md):229/247。

## 结果

Project 态左叶渲染真实文件树（工具面板 files 槽位），交互与既有实现一致；展开项由 user/local 记录承担（旧裸键一次性迁入并在回读验证后删除）；左栏尺寸继续复用切片 4 的 project/local 记录，不产生第二套写入。书架/用户资产态左叶语义不变。

## 范围

- `app/pages/index.vue`：左叶容器从占位（`:2620-2622`）改为真实视图挂载；按挂载结果删除未使用 import（`:12` `NovelIdeToolPanel`、`:16` `WorkspaceFilePanel` 视实际使用保留其一）。
- `app/components/novel-ide/NovelIdeToolPanel.vue`：files 槽位接入（`:435/437/439` 三槽位只接 files，角色/Plot 槽位本 Task 不动）。
- `app/components/novel-ide/workspace/**`（`:661-672` 文件树、`:675/684/693` 三种明细面板、`:712` 创建弹窗）保持行为；`WorkspaceFilePanel.vue` 的展开项改走记录。
- 新增 user/local 记录定义，并**追加到唯一注册入口** `server/storage/product-definitions.ts` 的清单（不新建第二个 Nitro 插件）。
- 需要时补一个受控 Lab fixture 或组件测试（见验证）。

## 排除

- 不迁角色、Plot、Markdown Studio 槽位与视图；不改 editor 叶/右叶占位语义。
- 不改 `/api/workspace-files/*` 与 SSE authority；文件内容不进 Storage。
- 不改 nb-ui `FileTree`（与 `WorkspaceFileTree` 共存已由开发者拍板）；不建命令系统/registry 之外的框架。
- 不动 Shell 几何、`layout-session.ts`、标题栏、迁移模块内部（切片 4/5 已闭环）。
- 不新增裸 `localStorage`/`sessionStorage`（`boundaries.md:103`）。
- 打开标签/活动文件属**领域恢复态排除项**（`persistence.md:101`）：保持现有按 Project 分区行为即可，不并入 Storage。

## 实现要求

1. **挂载**：Project 态左叶渲染文件树；书架/用户资产态不渲染文件树且 `files` 入口保持既有禁用行为（`workbench-chrome.ts:71`）。
2. **接入路径**：按 `workbench-view-host.md:229/247` 的内置（L1）注册路径接入，沿用既有 descriptor 类型；不新建命令系统。
3. **展开项归属**：新增 user/local 记录（owner/key/schemaVersion/默认值由实现定并在清单登记）；首次读取完成前不写默认值；**旧键迁移**为一次性：读 `nbook.workspaceFilePanel.expandedPaths` → 记录缺失时条件初始化 → 回读验证一致后再删除旧键；已有记录不得被旧键覆盖。
4. **行为保持**：展开/折叠、选中、打开文件、创建弹窗、三种明细面板分派与搜索过滤保持既有实现语义；打开文件链路若因 editor 叶仍是占位而无法呈现，必须有可见且可理解的反馈（不得静默失败）。
5. **单写者**：展开项只有记录这一条写路径（组件内旧裸键写入必须删除）；左栏尺寸不产生第二套写入。
6. **旧实现删除条件**：`index.vue:12/:16` 未用 import 删除；`nbook.workspaceFilePanel.expandedPaths` 键删除（回读验证后）；`NovelIdeToolPanel.vue` 的 files 槽位不退化为第二实现。

## 验证与交付

- 聚焦测试：展开项记录（首读门禁、条件初始化、旧键迁移与回读验证、冲突/失败不静默）、文件树组件行为（渲染/展开/选中/明细分派）。
- 真实浏览器验收（必做）：隔离系统 Temp State/Cache 根 + 显式空闲端口。**不得使用 3001**，且不得与 3001 并存第二个 dev server（共享 `.nuxt` 会摧毁它）——需要窗口先 `hub send` 报 Main 协调。覆盖：Project 态左叶渲染、展开后刷新仍恢复、打开文件的可见结果、书架态左叶禁用语义。
- Lab：说明本 Task 是否补 fixture 及理由（若补，保持 Lab smoke 绿色；`WorkspaceFilePanel` 原先因裸 `localStorage` 写入被判 `mountable:false`，迁入记录后此判定应重新核对）。
- 报告写 `walkthroughs/implementation.md`：真实命令、cwd、退出码、隔离根与端口、用例数、未运行项与偏差。
- 不提交、不 push；不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`。
- 最终回复具体结果，不返回空文本或句点。

## 继续条件

Leader 复核（typecheck、聚焦测试、Lab smoke、浏览器证据）后按清单排序推进下一视图（Markdown Studio）。