---
schema: nbook.task/v2
taskId: t15-harness-builtin-tools
---

# nb-harness 的内置工具（read、edit 与 FileAccess）

## 目标

写 [`harness.builtin-tools`](../../../../../docs/specs/harness/builtin-tools.md)（`planned`）并按它实现 `builtin` 模块：受根约束的文件访问接口 `FileAccess` 与本地实现（子入口 `./builtin/local`）、`read`（标签头与行号、目录、图片、预算）、`edit`（OMP hashline 引擎的装配与经 `FileAccess` 落盘）、按会话分开的快照存储。Work 切片 7。

非目标：项目级参数注入与多根（插件阶段）；编辑协议语义（照 OMP）；文件监视与协作锁；第三方格式。

## 当前状态（2026-10-10）

- Spec 与实施计划 [`plan.md`](plan.md) 已写，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进。
- **实现**（计划 S1，一个提交）：`src/builtin/`（`types.ts`、`stores.ts`、`read.ts`、`edit.ts`、`builtin.ts`、`local/local.ts`）；`package.json` 加 `./builtin`、`./builtin/local` 与 `pi-natives` 依赖；模块表登记。`bun test src/builtin` 7 pass；整包 181 pass、4 skip。真实引擎实验（lab）改写了两处 Spec：标签是内容哈希，另一个会话拿同样的标签、文件没变时引擎照常接受，会话隔离的是“展示过的行”的记录；引擎会自己读 `[path#tag]` 头里的文件并在拒绝时回显内容（根外文件也读），所以头里的路径先经 `FileAccess.resolve`，越界不交给引擎。引擎拒绝时回显的内容也算展示过（OMP 语义），测试据此用新文件验证隔离。Spec 加证据，注册表标“待晋升”。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“插件的落脚点”（`FileAccess`）与“影响”（内置文件工具受根约束）；开发者 2026-10-10 决定做完内核再做内置读写工具。
- OMP 编辑引擎的实测语义：[`packages/nb-harness/docs/omp-capabilities.md`](../../../../../packages/nb-harness/docs/omp-capabilities.md) 第 3.3 与第 4 节；旧原型的 read/edit 工具与测试（提交 `a82d026b` 之前的 `src/prototype/tools/`）作为行为参照。

## 下一步

omp 审查（计划与实现合一）→ 处理。
