---
schema: nbook.task/v2
taskId: t01-migration-design
---

# NeuroBook UI 底座迁移设计

## 目标

为 Issue #191 固定 NeuroBook 主应用接入 `@notnotype/nb-ui` 的 current 基线、迁移顺序和首个可独立验收的切片。当前 `packages/nb-ui` 已在 monorepo 内提供 Nuxt module、组件、composable、theme、utils 与样式入口；`packages/neuro-book` 尚未声明该 workspace 依赖。

历史 `.agents/tasks/146-nb-ui-shadcn-vue-refactor/` 只作为已完成组件库底座工作的 provenance，不恢复为 current Task，也不继承其旧 sibling 路径或未验证假设。

## Agent 工作

1. 读取 Issue #191、历史 Task 146、`packages/nb-ui` 的公开 exports 与专属规范，并核对 NeuroBook 当前同名组件、composable、theme、utils 及全部调用方。
2. 形成现状清单：哪些 `nb-ui` 表面可直接消费，哪些与 NeuroBook 行为、样式、i18n、SSR 或构建约束不一致，哪些仍需保留在主应用。
3. 把迁移拆成最少的纵向切片；每个切片明确消费者、旧入口删除条件、行为测试和真实桌面/390px UI 验收表面。
4. 选择首个切片并记录依据、风险、回滚边界和受影响 Spec；未经新 Task 派发不修改产品源码或依赖。

## 开发者参与

只有当证据无法消除产品取舍时，开发者决定首个迁移切片、可接受的视觉差异或是否扩大 `nb-ui` 公共 API。Agent 负责代码调查、调用方清单、验证矩阵和可逆方案，不把机械选择交给开发者。

## 任务产物

- `walkthroughs/001-current-baseline-and-slices.md`：current revision 的消费者清单、差异、迁移切片与首个切片建议。
- 必要时 `evidences/`：脱敏的结构化清单或命令结果；无原始证据则不创建空目录。
- 受影响产品行为、接口或状态边界确定后，同步同一个 Spec，再创建唯一下一 Task。

## 完成门禁

- NeuroBook 当前本地实现和 `nb-ui` 对应公开表面逐项映射，所有调用方与删除条件明确。
- 首个切片可独立构建、测试、运行和回滚，不要求提前完成整仓迁移。
- 验证矩阵覆盖实际行为、Nuxt 集成、样式加载以及桌面与 390px 真实 UI；未运行项有真实原因。
- Workbench/View Host 不进入本 Work；相关研究仅作边界证据，不据此新增框架。
- 没有为迁移保留 alias、双入口、兼容分支或静默 fallback；实施时切换完整消费者后删除旧入口。

## 固定依据与非目标

- 公开目标：[Issue #191](https://github.com/notnotype/neuro-book/issues/191)。
- 历史依据：[Task 146](../../../../tasks/146-nb-ui-shadcn-vue-refactor/README.md)。
- 当前组件库规则：[`packages/nb-ui/AGENTS.md`](../../../../../packages/nb-ui/AGENTS.md) 与 [`packages/nb-ui/docs/README.md`](../../../../../packages/nb-ui/docs/README.md)。
- View Host 边界研究：[`packages/neuro-book/docs/research/vscode/12-workbench-view-host-refactor.md`](../../../../../packages/neuro-book/docs/research/vscode/12-workbench-view-host-refactor.md)。

本 Task 不实现 UI 迁移，不建立 Workbench/View Host，不开放第三方扩展，不执行发布、部署、数据库迁移、远端 Issue/Project 写入或浏览器人工验收。
