---
schema: nbook.task/v2
taskId: t54-view-migration-inventory
role: tasker
---

# 未迁视图迁移清单

**状态：待调查。** [实施计划](../../storage-implementation-plan.md) 切片 6：标题栏与主工作台已真实接入（切片 4/5 收口、检查点 B correct），现在按**真实证据**盘点尚未迁移的视图并排序，供后续逐项立项；本 Task **不实现迁移**。

## 结果

产出 `../../view-migration-inventory.md`（Work 根）：一份可核对的清单，逐项记录 owner、当前状态（未重构 / Lab-ready 待接入 / 部分接入 / 已闭环）、依赖、状态归属（user / project、local / shared）、真实功能缺口、建议的独立切片与**旧实现删除条件**；末尾给出按依赖、组件成熟度与真实功能恢复价值的排序与依赖图。

## 调查对象（至少覆盖）

文件树与工具面板、Markdown Studio、Agent 列表与 Chat Flow、World Engine、Plot（剧本工作台）、角色、设置、历史/时间线、相关弹窗（含 Project Dialog、Profile 等）。
命令系统设计与桌面多窗口**单列**为独立任务项，不混入视图搬迁。

## 证据要求（每项都要）

1. **源码调用**：主页面/外壳/组件中的真实引用点（`app/pages/index.vue`、`app/components/workbench/**`、`app/components/novel-ide/**` 等，给 `文件:行`），以及它当前走的是旧实现还是已接 Storage 会话。
2. **同名文档**：`app/components/**/*.md` 等组件文档的成熟度描述与实现是否一致（不一致要指出）。
3. **Lab fixture**：`app/component-lab/fixtures/index.ts` 里是否已有该组件的场景、覆盖什么。
4. **主页面入口**：外壳叶（`SHELL_LEAF_IDS`）、标题栏菜单、书架/用户资产入口中是否可达。
5. **真实运行证据**：以只读方式从运行中的 3001 取得（例如读取页面结构/DOM 或既有截图）；**不要启动任何 dev server**（共享 `.nuxt`，会摧毁开发者正在用的 3001），需要窗口时先 `hub send` 报 Main。
6. **状态归属判定**：该视图的状态应落 user 还是 project、local 还是 shared，依据 `docs/specs/storage/boundaries.md` 与 `docs/specs/storage/persistence.md` 给出理由（不得只写结论）。

## 约束

- 只读：不改任何产品代码/测试；只新增该清单文档（必要时在 Work 目录补充取证笔记）。
- 不提交、不 push；不碰 3001 的启停；不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`。
- 不把"计划里写过"当证据；每行都要能指到具体文件/行或真实运行观察。
- 排序要给依据，不用"优先级高/中/低"这类无锚点词。

## 交付

- `view-migration-inventory.md` 落盘；结构：总表 + 逐项小节（每项含上述 6 类证据）+ 依赖图 + 排序理由 + 明确列出**本次未覆盖**的调查对象与原因。
- 报告写 `walkthroughs/implementation.md`：实际命令、退出码、取证方式、未运行项。
- 完成后 `bun run docs:check` 并记录退出码（文档门禁属本 Task 范围）。
- 最终回复具体结果，不返回空文本或句点。