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

进行中：实施计划见 [plan.md](plan.md)。开发者 2026-10-08 要求写好计划后派子代理在独立 worktree 实施，与 t61 的收口并行。拥有者定义的激活事件暂不演示（插件没有触发入口，见计划“不做与风险”）；开发者 2026-10-08 决定补上插件一侧，记为 [t63](../t63-plugin-activation-trigger/README.md)。

子代理已在 `refactor/w00017-t62-examples` 完成 S0–S5，待主 Agent 审查与合回；实施中与计划不同的地方记在计划末尾的“实施中的调整”。

| 片 | 提交 | 结果 |
|---|---|---|
| S0 | `6bbe0225` | 注释规则给示例开教学例外（根 `AGENTS.md`、`common.md`）；`testing/` 约定写进测试规范；内核“零依赖”改为“运行时依赖只有 TypeBox” |
| S1 | `6a3f7848` | `git mv` 把示例原样搬到 `packages/neuro-book/examples/`，两包 tsconfig 与 `AGENTS.md` 随之改，场景照旧通过 |
| S2 | `6cdd21f2` | 架构检查拦住产品代码引用 `testing/`、内核 `*/testing` 入口与 `examples/`，示例插件按插件规则检查；三条规则各改成不报时反例用例失败 |
| S3 | `0364a84c` | 新场地装真实内置插件；clock、notes（合并 notes、cloud-notes、greeter）重写；场景 01、02、05 |
| S4 | `3f803a42` | counter（合并 board）、menu、file-menu 重写；场景 03、04；删去 board、旧场景 06 与旧场地 |
| S5 | 本片 | `examples/README.md` 重写；收口验证 |

收口验证：[evidences/test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)：`--since 4d4e3465` 选中内核与应用，内核 292 例、应用 333 例与组件 57 例、两包类型检查通过；示例的 20 例场景最慢约 25 ms。`docs:check`、`governance:check` 无告警。
