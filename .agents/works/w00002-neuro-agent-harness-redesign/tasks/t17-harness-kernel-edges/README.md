---
schema: nbook.task/v2
taskId: t17-harness-kernel-edges
---

# nb-harness 第二轮优化（一）：内核边界、用量估算与预览

## 目标

t16 的审查者声明未核实的四个边界，加上推迟的预览接口（2026-10-11 开发者确认“这些都可以做”，计划经批准）：

| 项 | 问题 | 改法 | Spec |
|---|---|---|---|
| 3 | `status` 每次回放整份日志算 `pending` 与用量 | 按条目数组引用缓存（每次 append 换新数组）；用量没有服务方报告时用 OMP `Tokenizer` 估算，`context.source` 标明来源 | [`harness.runtime`](../../../../../docs/specs/harness/runtime.md) 输入、输出 5 |
| 4 | `next()` 每次订阅，等待期间反复调用会累积 | 等待点尚未到来时共用同一次等待 | runtime 输出 6 |
| 5 | 目录用“有 `replace` 函数”判断存储 | `createModelCatalog({config} \| {store})` 显式区分 | [`harness.models`](../../../../../docs/specs/harness/models.md) 输入、输出 10 |
| 6 | `:memory:` 关掉重开是空库，文档没说 | Spec 与 README 各加一句（合同测试已有） | models 输出 5 |
| 1 | 看不到模型会收到什么 | `session.preview(input?, options?)`：走受理检查（不要凭据）、准备 Profile、渲染种子、追加消息、系统提示词与请求消息，不写条目、不发请求、不改状态 | runtime 输入、输出 1、17；[`harness.profile`](../../../../../docs/specs/harness/profile.md) 失败表 |

非目标：资源寻址、artifact 溢出与 OMP 升级（[t18](../t18-harness-resources-artifacts/README.md)）。

## 当前状态（2026-10-11）

- 计划见 [`plan.md`](plan.md)。
- **实现**（提交 `dcd71750`）：Spec 条目改动（runtime 输入 `preview`/`Preview`/`PreviewOptions` 与 `context.source`、状态矩阵加 `preview` 行、输出 5、6、17、场景 10–12；models 输入签名与输出 10、`:memory:` 重开一句；profile 失败表链接；术语表“预览”）；代码：`runtime/session.ts`（`status` 的 `pending` 与 `context` 按条目数组引用缓存、无服务方用量时用 OMP `Tokenizer` 估算并标 `source`、`next()` 共用同一个挂起的等待、`preview()`）、`runtime/accept.ts`（拆出不取凭据的 `check()`）、`models/catalog.ts`（`createModelCatalog({config} | {store})`）。合同测试各补一条；示例场景 1 加“先 preview 再 prompt”。
- **实现审查（omp，范围 `62ed7f77..dcd71750`，90 分钟到上限后用 `--resume` 只要收尾）**：7 条（重要 5、建议 2），证据 [`evidences/impl-review.txt`](evidences/impl-review.txt)。全部成立并已改（与 t18 的审查处理同一个提交）：
  1. `status` 把可变缓存直接交给调用方，改一次污染后续查询（重要）——缓存结果冻结（数组、事项、`context`），公开类型改只读；场景 10 加隔离断言；
  2. 预览在 `refresh` 之后才渲染种子与追加消息，真跑在刷新前就写进日志（重要）——改成按 `prepare` 的结果渲染 `seeds`/`appended`，刷新后只渲染系统提示词与请求；用种子与系统提示词都带 `model-call` 数据源的 Profile 锁定两边各自同阶段；
  3. 用量估算测试只断言 `tokens > 0`（建议）——改为断言等于 `Tokenizer(model).countMessages(buildModelContext(entries))`；已知分词器家族在 `NODE_ENV=test` 下 OMP 一律走字节估算，原生计数路径只能在非 test 环境核对，本轮未加子进程 smoke（见“未核实”）；
  4. 预览的种子没有真跑回放时的 `attribution: "agent"`，`History last` 数出的消息不同（重要）——种子按回放形状给出，场景 12 断言预览的 `request` 与真跑第一次请求同形（时间戳除外）；
  5. 受理拆分后可见工具排在凭据之前，没凭据又有工具冲突时报错码不合输出 2 的顺序（重要）——受理分三段（选模型与能力、凭据、可见工具与审批与 signal），真跑三段都走、预览跳过凭据；能力检查按 Profile 要的工具判，不等可见工具算出来；场景 1 加组合失败的断言；
  6. 预览时已中止的 `signal` 被映射成 `invalid-profile`（重要）——受理末尾查 signal，准备与刷新期间的 `cancelled` 单独映射为 `invalid-state`；
  7. 预览把系统提示词的诊断收了两遍（建议）——系统提示词与诊断都取自 `renderRequest`，不再单独 `renderSystem`；场景 12 用一个渲染出未注册节点的内容节点断言只有一条 `unknown-node`。
- 未核实：已知分词器家族的原生计数（OMP 在 `NODE_ENV=test` 下固定走字节估算，测试进程里测不到；生产路径按 OMP 源码推断）。
- 验证见 [t18](../t18-harness-resources-artifacts/README.md) 的审查处理一节（同一个提交、同一次门禁）。

## 依据

- 开发者 2026-10-11：“可以，这些都可以做”，并在计划里确认预览放会话级、不要凭据。
- Spec 已 `implemented`，按 [`docs/specs/README.md`](../../../../../docs/specs/README.md) 原地改条目。

## 下一步

无（本轮完成）。
