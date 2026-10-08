---
schema: nbook.task/v2
taskId: t62-plugin-examples-in-app
---

# 示例插件搬到应用包并重组

## 目标与范围

来源：开发者 2026-10-08 在 t60 的讨论与决定。示例在精不在多，注释与文档要特别丰富；示例写的是应用插件，应该能直接用内置插件。

1. **搬到应用包**：`packages/nb-runtime/examples/` 移到 `packages/neuro-book/examples/`。原因是示例教的是怎么写应用插件，要和内置插件一起用；放在内核包里引用 `nbook.storage` 这类内置插件，内核包就要依赖应用包，形成包之间的循环依赖。场景装进真实的内置插件运行；内核包只留自己的合同测试。
2. **合并插件**（8 个合并为 5 个）：
   - `notes`、`cloud-notes`、`greeter` 合为 `notes`：依赖 `clock` 给笔记打时间，服务端按调用方提供门面并提供远程合同，浏览器端以调用方身份代理（`nbook.storage` 结构的缩小版）；
   - `counter`、`board` 合为 `counter`：一份后端定义含 `server` 与 `project` 两个入口；
   - `clock`、`menu`、`file-menu` 保留：贡献双方没有依赖，必须是两个插件。
3. **补齐还没演示的机制**：拥有者定义的激活事件（`activationEventPrefixes`）、可选依赖 `services.resolve`、`context.scope.register` 与 `context.signal`、`context.declarations`、`instances()`、远程不可达时按领域降级（含 [t61](../t61-kernel-catalog-failure-codes/README.md) 的 `not-provided`）。
4. **内置插件的用法**：`nbook.storage`、插件状态 store 与公开状态、命令；工作台视图等外壳实现后再补。
5. **教学注释**：给示例开注释规则的例外（根 `AGENTS.md` 的注释规则要求只写不明显的原因）：允许逐步讲解这一步做什么、为什么、不这样会怎样，并链接 Spec。讲解放在代码旁边、随场景测试一起改；README 只做目录、概念与阅读顺序，不贴代码片段。
6. **`testing/` 目录的约定**：写进 [`docs/testing/README.md`](../../../../../docs/testing/README.md)（放测试支持代码：测试工具、测试插件与测试入口、共用场地、e2e 外壳；不含断言；产品代码不引用），并加架构检查拦住产品代码引用 `testing/`。
7. 搬迁后同步引用示例的文档：[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、`packages/nb-runtime/tsconfig.browser.json`；[`docs/modules/monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md) 里内核一行的“零运行时依赖”已过时（现有 TypeBox），一并改。

## 前置

[t61](../t61-kernel-catalog-failure-codes/README.md) 完成（示例要演示 `not-provided` 的降级）。

## 当前状态

未开工：2026-10-08 先建，记下已确认的范围。开工时按当时的代码与 Spec 修订范围，按 [implementation-planning](../../../../skills/implementation-planning/SKILL.md) 写 `plan.md`，交开发者确认后再实施。
