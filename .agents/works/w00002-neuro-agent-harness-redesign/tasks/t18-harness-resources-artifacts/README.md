---
schema: nbook.task/v2
taskId: t18-harness-resources-artifacts
---

# nb-harness 第二轮优化（二）：资源寻址与工具结果溢出

## 目标

t16 推迟的“通用工具结果预算”，按开发者 2026-10-11 的决定照 OMP 的做法做（全文存 artifact、上下文留头尾、模型按 `artifact://N` 回读），并先补齐资源寻址：内置工具的路径改为 [`workspace.resources`](../../../../../docs/specs/workspace/resources.md) 的 `方案://路径`。

| 提交 | 内容 | Spec |
|---|---|---|
| 1 | OMP `@oh-my-pi/*` 18.2.5 → 18.4.6：编辑引擎多了 `resolveUrl` 回调，带方案的头由宿主解析；`EditPolicy` 字段相应调整 | 无行为变化 |
| 2 | 资源寻址：`ResourceAccess`（按方案取提供者，提供者可按会话构造）、目录型与虚拟型提供者、地址解析；`read` 的 `path` 与 `edit` 的头一律是完整地址；这轮方案 `project://`、`local://`、`tmp://`、`docs://`（根都由使用方给） | [`harness.builtin-tools`](../../../../../docs/specs/harness/builtin-tools.md) 术语、输入、输出 1–9；`workspace.resources` 首批方案表 |
| 3 | artifact 存储（`session` 模块，内存与 JSONL 实现）、适配层溢出（文本超 50 KiB 存 artifact，留头 20 KiB 尾 20 KiB、各 500 行，加回读提示）、`artifact://` 只读虚拟提供者、运行时接线 | [`harness.session`](../../../../../docs/specs/harness/session.md)、[`harness.tools`](../../../../../docs/specs/harness/tools.md) 输出 9、[`harness.runtime`](../../../../../docs/specs/harness/runtime.md) 输入与输出 3、builtin-tools 输出 9 |
| 4 | omp 审查处理 | |

非目标：`projects://`、`user://`、`chapter://`；bash、glob、grep；写入来源与变更事件（插件阶段的 `nbook.files`）。

## 当前状态（2026-10-11）

- 计划见 [`plan.md`](plan.md)。
- 提交 1 `7411128f`（OMP 升级；凭据层改用 `credentials`/`oauth` 子接口，差异记在 [`docs/omp-capabilities.md`](../../../../../packages/nb-harness/docs/omp-capabilities.md) 第 8 节）、提交 2 `a9bb0fc1`（资源寻址；用实际引擎验证了跨方案 edit 与回显里的地址）、提交 3（artifact 存储、适配层溢出、`artifact://` 提供者、示例场景 6 与 live 回读场景）。
- 验证：全包 `bun test` 213 pass、5 skip；`typecheck`；`docs:check`、`governance:check`；真实模型 `bun run test:llm` 6 pass（含新加的“模型按提示回读 artifact 第 2000 行”）。
- 待 omp 审查。

## 依据

- 开发者 2026-10-11 在计划里确认：照 OMP 的溢出做法；先补协议；方案集 `project`、`local`、`tmp`、`docs`、`artifact`；地址一律带方案；升级到 18.4.6。
- Spec 已 `implemented`，原地改条目。

## 下一步

实现、合同测试、示例，omp 审查后处理发现。
