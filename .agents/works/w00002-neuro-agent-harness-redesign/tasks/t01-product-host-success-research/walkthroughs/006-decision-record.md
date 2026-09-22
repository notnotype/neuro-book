# 决策记录：通用包测试治理与两领域试点

> Task：`t01-product-host-success-research`；记录者：Leader；日期：2026-09-11。
> 依据：`walkthroughs/005-testing-governance-brief.md`（2026-09-11 修订版）、`walkthroughs/004-generic-package-testing-research.md`。
> 本记录保存开发者的明确判断、补充规则、适用范围、待决项与重开条件。

## 开发者判断（2026-09-11，聊天记录转写）

> 1. 最小抽取 spike 是什么？
> 2. 真实 LLM 测试的范围：当测试打算 mock llm api 的数据的时候，不要 mock，直接用真实 llm
> 3. 其他的可以全部同意。

## 决定

| 决定 | 结论 | 说明 |
| --- | --- | --- |
| `D-TEST-01` | **接受 T1** | 采用 004 §2 草案：TDD 工作流（RED→GREEN→重构、bug 先复现）、关键面最小集合、每包 1 条 smoke、L1–L4 分层（L5 属宿主）、包内同目录测试 + 独立配置 + 包内导入、vitest/node、test-support 仅 devDependency、在 `docs/testing/` 扩展一节 |
| `D-TEST-01` 补充（开发者规则） | **不要 mock LLM API 数据** | 测试只要需要 LLM 响应就直接调用真实 LLM（DeepSeek）；假件只用于完全不涉及 LLM 的层（纯函数、hub、工具 seam） |
| `D-TEST-01` 细节 | 缺凭据：skip + 汇总记录 | skip 用例在 Task 证据中计为"未验证"，不得写成通过 |
| `D-SPLIT-01`（试点部分） | **接受领域级单包 + subpath** | SSE：`agent-sse`（frame/hub/writer 子路径）；write/edit：`agent-file-tools`（truncate/patch/tools 子路径）；包名与 scope 待建包时定 |
| SSE 基线来源 | **接受以独立包实现为基线** | `packages/neuro-agent-harness` 的 `sse.ts`/`events.ts`/`event-publication.ts` 作为抽取来源；产品侧参数化接入 |
| 最小抽取 spike | 定义已说明（见下）；是否单独执行待定 | Leader 建议并入第一个实现切片 |

## 最小抽取 spike（定义，供后续判断）

在正式建包前的一次性最小实验：在系统临时目录建最小包骨架（package.json + tsconfig + vitest 配置），把 1–2 个最小领域无关目标（候选：`truncate.ts` 151 行纯函数、`agent-sse-writer.ts` 135 行零 `nbook/*` 依赖）按包边界改写，配 1 条 smoke + 2–3 条关键测试，跑通 typecheck 与测试；产出为"需要哪些配置、遇到什么障碍、包脚手架模板"的短报告。不提交进仓库、不改 root `workspaces`。
Leader 建议：既然 T1、包粒度与 SSE 基线都已决定，spike 的决策支撑作用已用掉；把同样的工作直接做成**第一个实现切片**（用 TDD 建第一个真包）更省成本。若开发者希望零风险试错，再单独安排 spike。

## 适用范围

- 本决定约束**新建的领域无关通用包**（测试治理与包粒度）；产品现有测试与现有包的 mock 策略不在本轮范围。
- 通用包仍不得依赖 `nbook/*` 别名、产品 workspace/prisma、`@earendil-works/pi-*` 或产品 DTO。

## 待决项

- `D-SPLIT-01` 的 bash 归属：留在领域 harness 还是进 `agent-file-tools`。
- 最小抽取 spike：单独跑一次，还是并入第一个实现切片（Leader 建议后者）。
- 包名与 npm scope。
- 真实 LLM 测试的调用预算（每次本地/CI 的调用上限）。

## 不服务范围

- 本轮不改产品源码、不改依赖/lockfile、不写 Proposal/Spec、不创建包（建包需要单独授权）。

## 重开条件

- 真实 LLM 测试的成本/稳定性不可接受（调用额度、超时、结果波动）时，重开"真实调用范围"。
- 出现第二个消费者需要不同粒度时，重开 `D-SPLIT-01`。
- `docs/testing/README.md` 与本规范冲突时，先更新 `docs/testing`，再同步规范。

## 补充决定（2026-09-11，同日）

**`D-SPLIT-01` 待决项闭合：`bash` 归属 = 单独成包。**

- 开发者判断（聊天记录转写）：`B`——bash 既不并入 `agent-file-tools`，也不留在领域 harness，而是**单独成包**（暂定名 `@notnotype/agent-shell`）。
- 该包成员候选：`shell`（进程执行 + 终端解析 + 超时/中止终态映射；依赖 `@notnotype/owned-process`，注入 cwd 授权与后台 Job seam）与 `output`（`bash-output-store` + `output-accumulator`：lease/TTL/容量回收，路径根参数化）。
- 包名与聚合（2026-09-11 追加决定）：通用包聚合为**单包** `@notnotype/agent-kit`（命名空间 subpath：`./sse`、`./file-tools`…）；已建的 `agent-sse`/`agent-file-tools` 迁移并入；领域 harness 目标名 `@notnotype/neuro-agent-harness`——**被旧包占用，待其退役后复用**。
- 剩余未定：真实 LLM 测试的调用预算；`agent-shell` 与 `file-tools/tools` 的 seam 形状（建包时决策）。

### 补充决定（2026-09-18）

- **共享 domain（决定）**：采用「信封＋游标＋seam」，**不共享事件表**；事件 union 由宿主注入，`/sse` 只放结构契约（游标、序列化、字节预算、降级策略 seam）。
- **`./file-tools` 路线（决定）**：采用**方案 A** —— 早期依赖 `@earendil-works/pi-coding-agent@0.80.6`（同 scope、Node 兼容、MIT；提供 `create*ToolDefinition` + `*Operations` 接缝 + `withFileMutationQueue` + diff/patch 文本），**后续若有扩展或其他需求再去掉该依赖**；kit 自身接缝与 pi 的 `*Operations` 结构对齐，使去依赖成为局部替换。
- **SSE（决定）**：`/sse` 自研已确定，产品级实现不采用上游 sse/事件库。
- **当前重点**：文件编辑四模式（OMP：`replace`/`patch`/`apply_patch`/`hashline`）的能力设计与成员切分，见 `research/2026-09-18-file-tools-four-modes-design.md`。
- **OMP 复用（结论）**：不可直接复用 —— `@oh-my-pi/pi-coding-agent` 只发 `./src/*.ts` 原始 TS、engines 为 Bun ≥1.3.14、编辑引擎在 Rust `crates/pi-edit` 且依赖 N-API 原生包；如需 hashline 语义，仅参考其协议自研，不引入运行时。
