# t19 实施计划：易用性与渐进式示例

## Context

- **为什么做**：内核能力够了，但使用方写最短的程序也要先搭七样东西、每步解包 Result、按 `next()` 轮询审批；Profile 的常用设置写在 `fields` 里像配置文件；示例没有梯度。
- **参照**：OMP `createAgentSession()`（缺省齐全、失败即抛、审批经钩子）与 `examples/sdk/01…12`（每个脚本只比上一个多一个概念）；w00017 的 examples（README 阅读顺序与概念表）已是同款，保留。

## 关键设计

1. **两层**：Result 仍是合同；`unwrap(result)` 抛 `HarnessError(code, detail, diagnostics?)`；`openRuntime` 是异步便捷入口（凭据可以只给 `apiKeys`，缺省 `:memory:` 库）；`createRuntime` 保持同步，但接受 `HarnessConfig`、`Profile[]`，`store` 缺省内存。归一化按对象身份缓存，deps 仍是活的。
2. **宿主审批**：`deps.approve(request)` 在写入 `interaction request` 之后、询问用户之前被问；判定为 `model` 时先问审批模型，模型给不出再问宿主；返回 `null` 落到现有的 pending 事项；抛出按拒绝。响应 `decidedBy: "host"`，`scope: "session"` 同样进 `approvalGrants`。
3. **Profile 一等属性**：`defineProfile({tools, model, compaction, approval})` 映射到 `fields["harness/*"]`，与 `fields` 同给是定义错误；`Profile` 类型不变，主机与运行时的读法不变。
4. **缺工具**：`visibleTools` 多给 `missing`；受理照常，`invocation start` 的 `detail.missingTools` 与 `preview().diagnostics` 的 `unknown-tool` 警告暴露。
5. **示例**：`examples/steps/` 七个独立脚本，真实模型（`.env` 的 `NBOOK_LLM_*`），只过 typecheck；场景测试仍是合同验证；`cli.ts` 继续用 `next()`。

## 验收映射

| 条目 | 测试 |
|---|---|
| runtime 输入（归一化）、输出 18 | `runtime.test.tsx` 场景 10：`openRuntime` 最小程序、`unwrap` 的抛出与返回、坏配置抛 `HarnessError` |
| runtime 输出 6（宿主审批） | `approval.test.tsx`：回调批准、拒绝、返回 null 落到 pending、抛出按拒绝、`scope: session` 的放行 |
| session 输入（`decidedBy: "host"`） | 同上（回放 `approvalGrants`） |
| profile 输入、输出 13（一等属性） | `define.test`/`profile` 测试：映射与冲突；`loadProfile` 报 `invalid-profile` |
| tools 输出 3（`missing`） | `source.test.ts` |
| runtime 输出 2、3、17（`unknown-tool`） | `runtime.test.tsx` 场景 1、12 |
| 示例 | `typecheck`；七个脚本各跑一次真实模型，输出记在 README |
