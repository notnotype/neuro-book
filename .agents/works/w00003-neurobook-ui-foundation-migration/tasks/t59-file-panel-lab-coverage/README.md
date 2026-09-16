---
schema: nbook.task/v2
taskId: t59-file-panel-lab-coverage
role: tasker
---

# 文件树组件的文档与 Lab 覆盖

**状态：待实现。** t55 把文件树接进产品左叶，但 `app/components/novel-ide/workspace/**`（14 个文件）**零 `.md`**，按 `app/component-lab/component-index.ts:59-108` 的标签推导规则连 Lab 索引都进不去；红分支要求组件独立达到 Lab-ready，本 Task 补齐**用户可见的入口组件**这一环（与 t57 对视图宿主做的一致）。

依据：[清单 §2.1](../../view-migration-inventory.md) 与 §2.2 的跨面事实（239 个组件仅 39 个有同名文档）。

## 结果

`WorkspaceFilePanel.vue`（t55 迁移后的形态）有同名契约文档并可被 Lab 索引；能确定性挂载则给出 fixture 与场景，不能则按规则标注不可挂载、写明原因并给出替代验证方式（不得静默跳过）。

## 范围

- 新增 `packages/neuro-book/app/components/novel-ide/workspace/WorkspaceFilePanel.md`：契约文档（职责、与 `files-view-session`/记录的关系、展开项归属、打开文件链路、失败可见语义、不支持项）+ frontmatter 标签。
- 视情况新增 Lab fixture 与 `fixtures/index.ts` 登记；若需要注入缝隙（例如注入记录会话/树数据），沿用 t57 的做法：**最小、可选、文档化**，产品默认行为不变。

## 排除

- 不改文件树行为、不改 `files-view-session.ts`/`user-record-session.ts`、不改 Storage 定义与 `product-definitions.ts`。
- 不为其余 13 个 workspace 组件补文档（本 Task 只做入口组件；其余按后续视图迁移立项）。
- 不新增裸 `localStorage`/`sessionStorage`；fixture 不得依赖持久化状态。

## 实现要求

1. **文档与实现一致**：先读 t55 后的实现再写（展开项走记录、旧裸键已退役、失败有诊断条），不抄迁移前的旧计划；不得把「已不做的事」写成现状。
2. **可挂载性判定**：按标签规则给出结论。若可挂载 → fixture 至少覆盖「Project 态渲染文件树行并展开」「空树/失败态可读」；若不可挂载 → 标签理由（`io:`/`persist:` 等）+ 替代验证（聚焦测试或真实浏览器观察）。
3. **不回归**：Lab smoke 保持绿；`bun run docs:check` 通过。

## 约束

- **3001 是开发者正在使用的服务**：禁止启停/重启；禁止启动第二个 dev server（共享 `.nuxt`）；验收直接对 3001 只读跑 Lab smoke。
- 禁止 `bun run typecheck` / `nuxt prepare|generate|build`；类型信息用 `bunx tsc --noEmit` 级别。
- 不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`；只逐文件 `git add`；不提交、不 push；不联网。

## 验证与交付

- 真实浏览器：`node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3001 --browser-executable <chrome>`（cwd `packages/neuro-book`）exit 0；若加了 fixture，用 omp 托管 Chromium 对 3001 只读取证场景观察。
- 报告写 `walkthroughs/implementation.md`：命令、cwd、退出码、可挂载性结论与证据、若不可挂载的原因与替代验证、未运行项。
- 最终回复具体结果，不返回空文本或句点。