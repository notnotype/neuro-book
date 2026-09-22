# 决策简报：通用包测试治理与两领域试点

> Task：`t01-product-host-success-research`；生成者：Leader；日期：2026-09-11（并入开发者测试方向后修订）。
> 依据：`walkthroughs/004-generic-package-testing-research.md`（研究草案与试点证据）+ `docs/testing/README.md` + 两次只读取证（`agent://SseDomainScout`、`agent://WriteEditToolsScout`）。
> 本简报只给候选、建议、选错代价、可逆性与证据缺口；不修改包边界或治理正文。
>
> **状态（2026-09-11）**：开发者已对判断项作答——接受 T1；接受领域级单包 + subpath；SSE 基线取独立包实现；并补充规则「不要 mock LLM API 数据，直接用真实 LLM」。决定记录见 `walkthroughs/006-decision-record.md`；最小抽取 spike 的定义已另行说明，是否单独执行待定。

## 观察状态

- 本次研究由开发者点题（SSE、write/edit 两个领域），并已给出测试方向：**TDD**（先失败测试后实现）；**只测关键、不追求数量**；**smoke 测试重要**；**允许测试做真实 LLM API 调用**（DeepSeek，`DEEPSEEK_API_KEY` 记录到 `.env`）。
- 尚无开发者第一手观察（未运行现有测试套件、未做抽取 spike）。
- 可选观察动作：① 运行 `bun run --cwd packages/neuro-agent-harness test` 与产品 `packages/neuro-book/server/agent/tools/` 的 vitest，感受两套风格；② 指定最小抽取 spike（如 `truncate` + `agent-sse-writer`）验证"抽包后测试仍可运行"。

## 决定 D-TEST-01：通用包测试治理规范

### 候选（已并入开发者测试方向）

| 候选 | 内容 | 与开发者方向的关系 | 风险 |
| --- | --- | --- | --- |
| T1（建议） | 004 §2 草案：TDD 工作流（RED→GREEN→重构、bug 先复现）；只测关键（§2.2 最小集合）；每包 1 条 smoke；L1–L4 分层（L5 属宿主）；包内同目录测试 + 独立配置 + 包内导入；vitest/node；test-support 仅 devDependency；真实 LLM 测试按 §2.5；在 `docs/testing/` 扩展一节 | 直接落实四条方向；L3/L4 只保留失败/恢复/资源相关的最小面 | 条目仍偏多，落地时需按"最小集合"继续裁剪 |
| T2 轻量 | 只强制 TDD + L1/L2 + smoke；L3/L4 由宿主或后续补齐 | 更贴合"不要太多" | 恢复/并发/资源释放失去门禁；SSE 的 hub 预算与真实 socket 测试不受规范保护 |
| T3 更重 | T1 + 发布级门禁（pack smoke、跨进程 E2E） | 超出当前需要 | 无外部消费者的阶段付出发布级成本 |
| T4 | `evidence-insufficient`：先做抽取 spike 再定规范 | — | 阻断 SSE/write-edit 抽包研究 |

### 建议

**T1**。理由：① 与开发者四条方向一致，"最小集合"写法本身就是控制测试数量；② 失败/恢复/资源释放是两类试点最容易出事故的面，保留为必测；③ 与 `docs/testing/` 对齐，不产生第二真相源。

### 选错代价

- 选 T2 后出现恢复或并发事故：属于"规范允许的空白"，返工时要回头补规范与测试。
- 选 T3：无消费者的阶段付出发布级成本，可能拖慢本体。

### 可逆性

规范是文档级约束，可逆性高；已写下的测试不受影响。半不可逆项：测试运行器选型（vitest/node）与 test-support 作为 dev 依赖——出现外部消费者时可替换，代价中等。

### 证据缺口

- 无"抽取后测试仍可运行"的实证（建议 spike）；
- 未确认 `.env` 在 node 运行时下的加载接线（需要显式 loader 或 CI secret）；
- 未评估测试运行时长与真实 API 测试的调用预算。

## 决定 D-SPLIT-01（试点部分）：SSE 与 write/edit 的包边界

### 候选（两边各自适用）

| 候选 | SSE | write/edit |
| --- | --- | --- |
| 领域级单包 + subpath（建议） | `agent-sse`：`frame`/`hub`/`writer` 三个子路径；三处重复 hub 合并为一份参数化实现 | `agent-file-tools`：`truncate`/`patch`/`tools` 三个子路径；执行体经授权、互斥、记账、附件、输出五类 seam 注入；bash 是否纳入另定 |
| 更细粒度 | frame/hub/writer 各自成包 | truncate/patch/tools 各自成包 |
| 更粗粒度 | 与 write/edit 合成一个"agent-kit" | 同左 |
| evidence-insufficient | 先 spike 再定边界 | 同左 |

### 建议

**领域级单包 + subpath**，理由：① 仓库已有"单包 + subpath 导出"先例（独立包 `./storage/jsonl` 等），Issue 早期非绑定假设也是单包 subpath；② 两个领域当前都没有第二个消费者，细拆只会先付包维护与版本成本；③ subpath 保留了未来"某模块独立成包"的升级路径（有独立消费者时再提升）。

同时建议在 `D-SPLIT-01` 中明确两件事：

1. **SSE 基线来源**：独立包的 `sse.ts`/`events.ts`/`event-publication.ts` 已领域无关且带测试；产品实现耦合 DTO。候选：以独立包实现为基线（推荐，保留现成资产与测试），产品侧参数化接入；或严格"从 NeuroBook 抽"重写。
2. **bash 的归属**：它依赖进程托管与输出存储，是否进 `agent-file-tools` 还是留在领域 harness，需要单独判断（本材料未展开）。

### 选错代价

- 粒度太细：包数量与跨包版本维护成本上升，收益（独立消费）在当前并不存在。
- 粒度太粗：复用边界模糊，SSE 与文件工具被迫同版本演进；将来拆分要动依赖图。
- 基线选错：若以产品耦合实现为基线，会把 DTO/领域假设带进通用包；若完全放弃独立包现成 SSE 资产，则重复实现与重复测试。

### 可逆性

包边界与基线选择都属于设计期决定，可逆性较高（尚无外部消费者）；一旦包被产品接入（#117）并有版本承诺，再拆分的成本上升。

### 证据缺口

- 未做抽取 spike（无"抽包后测试可运行"的实证）；
- 未评估 SSE 三处 hub 合并的具体 API 形状（参数化 `maxEventBytes`、泛型 payload 的最小面）；
- 未评估 write/edit 五个 seam 的最小接口（是否够用、是否有第二个消费者会需要不同形状）；
- 未决定包名与 scope（可在合同重写时一并定）。

## 待开发者判断

1. `D-TEST-01`：T1 / T2 / T3 / T4？若选 T1，是否认可 §2.2 最小集合与 §2.5 的"缺凭据 skip + 记录"约定？
2. `D-SPLIT-01`（试点部分）：领域级单包 + subpath，还是更细/更粗？
3. SSE 基线来源：独立包实现（建议）还是从产品重写？
4. 是否先安排一个最小抽取 spike 作为第一手观察（若选 T1 建议做）？
5. 真实 LLM 测试的范围与凭据行为：哪些用例值得真跑；缺 `DEEPSEEK_API_KEY` 时 skip 还是 fail？
