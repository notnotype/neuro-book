---
schema: nbook.task/v2
taskId: t57-view-host-lab-coverage
---

# 视图宿主的 Lab 覆盖与契约文档

**状态：已实现并验证（2026-09-16）。** 交付物见 [`walkthroughs/implementation.md`](walkthroughs/implementation.md)（契约文档 + 三场景 fixture、可挂载性 `mountable: true`、Lab smoke 对 3001 exit 0、`docs:check` exit 0、未运行项与偏差）。t55 把 `WorkbenchViewHost.vue` 与 `product-catalog.ts` 接进产品（左叶文件树），但该组件**既无同名文档也无 Lab 条目**（`app/component-lab/component-index.ts` 只从 `app/components/**/*.md` 的 frontmatter 标签推导可挂载性，没有 `.md` 就进不了索引）。红分支要求组件独立达到 Lab-ready，本 Task 补齐这一缺口。

依据：[清单 §2.1](../../view-migration-inventory.md)（t55 增量的偏差「未补 Lab fixture」）、`app/component-lab/component-index.ts:59-108`（标签推导规则）、`packages/neuro-book/docs/proposals/workbench-view-host.md:229/247`（内置注册路径）。

## 结果

`WorkbenchViewHost.vue` 有同名契约文档（frontmatter 标签使其**可挂载**），并在 Component Lab 有确定性 fixture：容器按声明渲染可见视图、`when` 判为不可见时给出原因、未知 factory 的失败**可见**（不空白）。Lab smoke 保持绿色。

## 范围

- 新增 `packages/neuro-book/app/components/workbench/WorkbenchViewHost.md`：契约文档 + frontmatter（标签不得含 `io:` / `state:shared-write` / `persist:`，否则会被判不可挂载）。
- 新增 `packages/neuro-book/app/component-lab/fixtures/WorkbenchViewHostFixture.vue`，并在 `app/component-lab/fixtures/index.ts` 登记条目（沿用现有 `{component, scenes, load}` 形状）。
- 如宿主当前只认产品目录单例、fixture 无法注入声明，可加一个**最小且文档化**的注入入口（props 或参数）；这是测试缝隙，不得改变产品的默认行为。
- 需要的内联文案走 i18n（与产品一致）。

## 排除

- 不改文件树行为、不改 `files-view-session`、不改 Storage 定义与 `product-definitions.ts`。
- 不做 Markdown Studio、不做右叶 Agent 面。
- 不新增裸 `localStorage`/`sessionStorage`；不让 fixture 依赖持久化状态。

## 实现要求

1. **文档**：写清本组件的职责边界（容器声明 → 视图解析 → 懒实例化 → 失败可见）、`when` 求值语义、与 `product-catalog.ts`/`view-factories.ts` 的分工、以及「不在本组件内读持久化状态」的约束；与实现一致（先读实现再写，不抄旧计划）。
2. **fixture 场景**（至少三个，确定性、无网络、无持久化）：
   - `default`：一个可见视图正常渲染（可用最小 stub 工厂，不依赖产品组件）；
   - `hidden`：`when` 判为不可见 → 显示不可见原因；
   - `unknown-factory`：未知 `factoryKey` → 失败可见且给出可读诊断（对照 t55 修过的 `DescriptorResult` 包装层缺陷）。
3. **可挂载性**：`component-index.ts` 的标签推导结果必须是 `mountable: true`（自查方式：在 Lab 页面里该组件出现且可选中；或给出推导输入的证据）。
4. **不回归**：Lab smoke 全量保持绿；`bun run docs:check` 通过。

## 验证与交付

- 真实浏览器：直接对**运行中的 3001** 跑 `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3001 --browser-executable <chrome>`（默认 all 套件，只读浏览；**不要启动第二个 dev server**，共享 `.nuxt` 会摧毁 3001；不要启停 3001）。若你需要手点页面取证，用 omp 托管 Chromium 对 3001 做只读检查即可。
- 报告写 `walkthroughs/implementation.md`：真实命令、cwd、退出码、套件结果、三个场景的观察、可挂载性证据、未运行项。
- 不提交、不 push；只逐文件 `git add`（禁止对目录 add）；不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`。
- 最终回复具体结果，不返回空文本或句点。
