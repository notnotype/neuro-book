# deepseek-harness 测试策略与基础设施调研

- 调研日期：2026-08-18
- 目标仓库：`C:\Users\notnotype\Documents\CodeRepository\GithubProjects\deepseek-harness`
- 文档状态：已完成；非规范调研资料
- 置信度：高。结论来自目标仓库的测试策略、Vitest 配置、测试支持包 README、Agent Note、代表性测试源码与实际运行结果。

## 一、结论先行

`deepseek-harness` 采用多层测试闭环，而不是“单元测试加覆盖率”：

```text
包内契约
  → 真实 Loader 组合
  → 无密钥录制/回放快照
  → 真实浏览器链路
  → 带密钥真实 API
```

最重要的三个设计判断：

1. **不让 Agent 自己决定正确结果。** Agent 的文字回复只是过程输出；测试会重新运行命令、读取文件、比较持久化日志，或校验用户可见界面。
2. **覆盖率是执行度门禁，不是质量证明。** 仓库明确承认行覆盖率只能证明代码被执行过，不能证明功能符合预期。
3. **Agent 必须处于执行反馈闭环。** 测试尽量保留真实 Agent Loop、工具、执行器、Loader 和持久化，只替换昂贵或不确定的模型、网络和时钟边界。

## 二、检查边界

### 已检查

- 根 `package.json` 及测试脚本；
- `vitest.config.ts`、`vitest.e2e.config.ts`、`vitest.snapshot.config.ts`、`vitest.web.config.ts`、Web 性能和压力配置；
- `docs/testing.zh.md` 与相关 Agent Note；
- `packages/test-support/` 的 replay、mock server、ACP snapshot、Loader smoke 和 Agent Loop testkit；
- Agent Loop 契约、属性测试、API proxy 协议测试、GUI 对象层测试、Web 组装快照和 Web 浏览器 E2E；
- 真实 API CI 工作流；
- 代表性 Vitest 命令的实际输出。

### 未完成或未执行

- 未执行全仓 `pnpm run test`；
- 未执行全仓 `pnpm run test:coverage`；
- 未执行完整 `pnpm run test:snapshot`；
- 未执行完整 `pnpm run test:web`；
- 未执行带真实密钥的 `pnpm run test:e2e`；
- 未执行 Web perf / stress lane；
- 本次没有进行浏览器人工验收或真实 Provider 调用。

因此，本报告确认测试体系和多个代表性 lane 的实际行为，不宣称当前提交的所有测试和覆盖率门禁全绿。

## 三、测试入口与配置

根 `package.json` 的主要入口如下：

| 命令 | 作用 |
|---|---|
| `pnpm run test` | 普通 Vitest 单元、契约和脚本测试 |
| `pnpm run test:coverage` | V8 覆盖率门禁 |
| `pnpm run test:e2e` | 带密钥真实 API / 示例 E2E；缺密钥时相关测试自跳过 |
| `pnpm run test:snapshot` | 无密钥 snapshot replay |
| `pnpm run test:snapshot:record` | 使用真实 API 录制或更新模型 fixture |
| `pnpm run test:snapshot:refresh` | 无密钥 replay 并刷新预期输出 |
| `pnpm run test:web` | 构建前端后运行 Web lane |
| `pnpm run test:web:built` | 复用已有构建产物运行 Web lane |
| `pnpm run test:web:refresh` | 构建后以 refresh 模式运行 Web lane |
| `pnpm run test:web:perf` | Web 高基数性能诊断 |
| `pnpm run test:web:stress` | Web 压力测试 |
| `pnpm run test:gui` | `packages/client` 与 `packages/host` 的 GUI 快速 lane |

### 普通 Vitest

`vitest.config.ts` 扫描：

```text
packages/*/*/tests/**/*.spec.{ts,tsx}
apps/*/tests/**/*.spec.ts
examples/*/tests/**/*.spec.ts
scripts/**/*.spec.ts
```

配置还包括：

- 所有测试使用 `scripts/test-invariants.ts`；
- 普通测试和 process-bound 测试拆成两个 fork pool；
- process-bound 清单包含 JSONL 持久化、子 Agent ACP、进程 spawn、time context、应用启动和 worker thread 等测试；
- Windows 会显式排除需要 POSIX shell、Linux sandbox 或特定进程语义的测试；
- 客户端 React 测试通过文件级 `@vitest-environment jsdom` 使用 jsdom。

### 真实 API E2E

`vitest.e2e.config.ts` 扫描：

```text
packages/*/*/tests/**/*.e2e.ts
apps/cli/tests/**/*.e2e.ts
examples/*/tests/**/*.e2e.ts
```

它不包含 `apps/web/tests/*.e2e.ts`，因为 Web 测试需要独立的构建产物和 Web 配置。真实 API lane 设置：

- `testTimeout: 120_000`；
- `hookTimeout: 30_000`；
- retry 为 2；
- 默认最多 4 个 worker，可通过 `DSH_E2E_MAX_WORKERS` 调整；
- 不收集普通覆盖率。

### Snapshot

`vitest.snapshot.config.ts` 扫描：

```text
scripts/**/*.snapshot.ts
apps/cli/tests/**/*.snapshot.ts
examples/*/tests/**/*.snapshot.ts
```

只有在 `DSH_EXAMPLE_MODE=lib` 时才把 `apps/web/tests/**/*.snapshot.ts` 加入该配置。Replay 模式可以并行；record 和 refresh 串行，因为它们会写入 fixture 或 golden。

### Web

`vitest.web.config.ts` 只扫描：

```text
apps/web/tests/**/*.e2e.ts
apps/web/tests/**/*.snapshot.ts
```

Web 文件不并行，超时时间更长。`vitest.web.perf.config.ts` 只选取 `*.perf.ts`，`vitest.web-stress.config.ts` 只选取 `apps/web/stress-tests/**/*.stress.ts`，二者不进入默认 Web 正确性门禁。

## 四、测试分层与理由

### 4.1 单元、契约和生命周期测试

测试与包源码共置，重点覆盖：

- 边界和错误路径；
- 事件顺序；
- 并发竞态；
- Agent Loop 的 turn / step / tool 生命周期；
- HMR dispose 后的资源清理；
- 永久回归合同。

代表文件：

```text
packages/core/agent-loop/tests/contract-regressions.spec.ts
```

该文件用 `MockAdapter` 驱动真实 Agent Loop，覆盖：

- 工具执行期间 abort 是否正确结束 turn；
- 延迟扩展点的 steering 是否丢失；
- 插件异常是否被隔离；
- dispose 后 status 是否保持平衡；
- adapter 注册、路由与输入归属；
- seeded session 的 turn 编号连续性；
- finish-error stream chunk 是否结束为 error；
- step boundary 发布顺序；
- tool result 与原始 call identity 是否保持一致。

测试以 `agent/status = idle` 作为 durable settle 信号，而不是依赖 wall-clock sleep。这使时序测试更快、更确定；如果没有正常 settle，超时被视为缺陷，而不是自动重试掉。

### 4.2 属性测试

仓库有四组 `fast-check` 属性测试：

```text
packages/llm/llm/tests/properties.spec.ts
packages/core/tools/tests/properties.spec.ts
packages/core/session/tests/properties.spec.ts
packages/core/agent-loop/tests/properties.spec.ts
```

覆盖的协议形状包括：

- arbitrary LLM chunk stream；
- Session event log replay；
- Parameter Schema 到 JSON Schema 和运行时校验；
- Agent Loop 的发送调度和状态机。

生成器偏向短字符串、小索引池、有效但带敌意的输入，使重复索引、straggler、交错调用和缺失边界更容易出现。失败保留可复现 seed。

仓库 Agent Note 记录：BlockAssembler 属性测试首次运行发现了重复 `block-end` bug。修复策略是同一块第一次 close 生效，并补充了专门回归测试。这是覆盖率无法单独提供的价值：100% line coverage 并不能证明所有事件交错都正确。

### 4.3 覆盖率门禁

覆盖率使用 V8，纳入：

```text
packages/*/*/src/**/*.{ts,tsx}
```

门禁是逐文件 100%：

```text
statements: 100
branches: 100
functions: 100
lines: 100
```

但这不是全仓库所有源文件的绝对 100%：

- `vendor/` 和 `examples/` 不在普通源码覆盖范围；
- 子进程和 worker 入口由真实进程测试覆盖，不由进程内 V8 覆盖统计；
- Windows 不支持的测试按平台排除；
- `vitest.config.ts` 明确豁免一批 GUI、Web、Host API proxy、动态组合和生成器源码，并标有 `TODO(gui)` 等说明。

正确解读是：**纳入门禁的产品源码逐文件达到 100%，但覆盖率仍然不是行为正确性的充分条件。**

## 五、全局不变量宿主

`scripts/test-invariants.ts` 是 Vitest-wide setup：

1. 通过 `import.meta.glob('../packages/*/*/src/invariant.ts')` 发现包级 invariant companion；
2. 包装 `RegistryService.prototype.plugin`；
3. 把包级运行时合同自动挂载到普通 Cordis 测试根；
4. 对手工拓扑测试保留显式例外。

不变量必须验证权威事件流或可观察数据关系，例如注册表释放、持久化状态一致性和 HMR 清理；不能只验证某个 service 或 method “存在”。

## 六、Loader、组合和构建产物测试

仓库不把手工 `ctx.plugin(...)` 视为完整产品测试。真实组合测试通过 Loader 和测试专用 `cordis.yml`，只替换外部服务或不确定输入，保留下游真实实现。

`@deepseek-ai/dsh-loader-smoke` 负责：

- 隔离 cwd、`DSH_HOME` 和诊断路径；
- 选择源码 `src` 或构建后 `lib` 模式；
- 注入 stdin；
- 管理超时和终止；
- 收集 stdout / stderr；
- 在成功或失败后清理资源。

真实入口 E2E 还会从普通 Node 执行构建后的 `lib/bin.js`，检查：

- 包 exports；
- Loader 导出解包；
- 构建后模块解析；
- 子进程退出和结算竞态；
- worker thread 的非 index 入口。

## 七、无密钥 Snapshot 与 replay

### 7.1 Session JSONL 是唯一 fixture 来源

`@deepseek-ai/dsh-llm-replay` 从持久化 `session.jsonl` 重建模型调用：

- `assistant/chunk` 事件按 `(turn, step)` 分组；
- terminal `finish` chunk 标记一次 stream 结束；
- 标记过的 compaction summary 可以恢复为成功的 canonical stream；
- 纯 throw、hang、cancel 不能从 chunk 自动推断，必须使用 `replay.override.json`；
- `ReplayHandle.assertConsumed()` 在 teardown 检查每个录制脚本和 cursor 都被正确消费。

这避免了单独手写一个与真实产品日志脱节的模型 mock。录制是“使用真实模型运行一次并 harvest JSONL”；回放是“使用真实组装链路重复执行”。

### 7.2 ACP Snapshot

`@deepseek-ai/dsh-acp-snapshot` 的主要组件：

- `launchAcpTestAgent`：启动源码或 `lib` Agent 子进程；
- `runScenario`：驱动 ACP JSON-RPC stdio；
- normalizer：归一化 UUID、路径、时间、RPC ID；
- `defineAcpSnapshotSuite`：统一 replay、record、refresh、fixture guard 和 diff。

每个场景至少比较两个表面：

1. `stdout.expected.jsonl`：自动化客户端看到的 ACP wire；
2. `session.jsonl`：Agent Loop、工具调用、边界事件和持久化日志。

fixture guards 会检查缺失目录、孤儿文件、重复 header pin、未清理 JSONL header、非规范 cwd token 和 malformed pinning header。

### 7.3 嵌套 Agent 回放

嵌套 Agent 使用每个 calling Session 独立的模型脚本：

- 录制 fixture 保存 parent 和 child 的多个 Session 日志；
- live Session ID 每次随机，不按 ID 相等匹配；
- 按第一次模型调用顺序绑定录制脚本；
- 每个 Session 独立推进 cursor；
- 实际 harvest 所有父子日志，并按 parent-first / `createdAt` 排序；
- 未录制的额外子 Agent 直接失败。

当前限制是 first-call order 对真正并发 sibling subagent 仍不充分，仓库将更强的并发绑定列为后续工作。

## 八、Web GUI 的三层测试

GUI Agent Note 将 Web 测试沿架构切成三层。

### Tier 1：协议同构

位置：

```text
packages/host/apiproxy/tests/client-handler.spec.ts
```

核心路径：

```text
InProcessApiClient(toFetchHandler(scriptedApi))
```

不经过真实网络，但保留真实 envelope、rpcId、Zod parse、SSE framing、batch、timeout、unary 和 stream 处理。

### Tier 2：对象层编排

位置：

```text
packages/client/runtime/tests/
packages/client/connection/tests/
```

测试 `Session`、`SessionManager`、`ConnectionController` 等状态机，覆盖 stitching、去重、分页、乐观状态清理、pending buffer、reconnect 和 backoff。

测试模式为：

```text
事件序列输入 → deferred / fake timers 控时序 → 稳定状态快照输出
```

### Tier 3：组装与浏览器

jsdom 组装快照读取构建后的 client bundle，通过真实 Loader 启动跨插件组合，固定稳定的用户可见投影，例如 sidebar、tool row、plan strip 和 `document.title`。它不重复断言下层 wire 或状态机。

浏览器 E2E 则运行：

```text
Chromium
  → client bundle
  → HTTP unary RPC + SSE
  → toFetchHandler / API proxy
  → Agent Loop
  → tools
  → JSONL persistence
```

Web scaffold 会：

- 创建隔离 workspace、`DSH_HOME`、skill roots 和 persistence root；
- 通过真实 persistence API seed Session，而不是直接写内部文件；
- replay 模式禁用 shipped model adapter row，并安装 `dsh-llm-replay`；
- 用 `whenIdle()`、durable `turn/end` 和稳定 DOM poll 作为同步屏障；
- 归一化 UUID、cwd、workspace basename、duration 和 throughput；
- 对 pageerror、connection-loss、gap-repair warning 设置 fail-loud tripwire；
- 检查每个 replay fixture 完全消费；
- 每个 scenario 使用新 browser context 和独立 host；
- 不依赖 Vitest retry。

Linux PR 的浏览器门禁是 compare-only：

```text
DSH_SNAPSHOT=replay pnpm run test:web:built
```

`record` 和 `refresh` 只在明确的本地流程中写入 fixture 或 golden。

## 九、Mock、fixture 与资源隔离

仓库的原则是：只替换高成本或不确定的边界。

典型组合：

```text
脚本化模型 / replay
  + 真实 Agent Loop
  + 真实工具注册
  + 真实执行器
  + 真实持久化
```

而不是同时 mock 工具、执行器和持久化。

### LLM Mock Server

`@deepseek-ai/dsh-llm-mock-server` 提供可脚本化 Node HTTP server，覆盖：

- connection refused 的生命周期场景；
- header 后断开、partial reset、stall；
- clean EOF 和 malformed payload；
- HTTP provider error；
- 空 completion、reasoning、tool call；
- slow chunks 和 max-token finish；
- UTF-8 请求分片；
- bearer token / route 校验；
- script exhaustion、repeat-last 和可复现 random seed。

Server 只报告 wire 事实，不替产品决定 retryability。真正的 HTTP adapter、Agent Loop 和 retry policy 由集成测试组合起来。

### 资源释放

测试普遍使用：

- `mkdtemp` 临时 cwd；
- 独立 persistence root；
- 独立 spill root；
- `afterEach` / `afterAll` dispose；
- 即使失败、超时和 retry 也释放 Agent Loop、子进程和本地执行器；
- 恢复被测试临时覆盖的环境变量；
- 不触碰开发者真实 `~/.dsh`。

## 十、Agent 参与测试的实际工作流

1. **按行为选择 lane。** 函数和状态机走包内测试；组合输入走属性测试；Loader 和构建入口走真实组合或 built E2E；模型、协议和用户可见变化走 snapshot；浏览器承载走 Web E2E；Provider 漂移走带密钥 E2E。
2. **只在边界 mock。** 模型、网络、时钟可以替换；真实工具、Agent Loop、Loader、执行器和持久化尽量保留。
3. **让 Agent 执行真实动作。** 发送用户任务、调用工具、修改文件、运行命令、生成 Session event。
4. **从外部验证结果。** 重新执行命令、重新读取文件、检查未修改文件字节一致、检查持久化状态和用户可见界面。
5. **把模型可见变化录成 replay fixture。** 默认门禁 keyless replay；只有明确 record 时才调用真实 API。
6. **用 fail-loud 守卫防止假绿。** 缺失 fixture、script underrun、未知工具、缺失 secret、未预期 console warning、未消费 replay 都应失败。

### 最直接的例子：coding task E2E

`examples/headless-agent/tests/coding-task.e2e.ts` 的流程：

1. 创建一个真实失败的 `add.test.js`；
2. 创建返回 `a - b` 的 bug 版本 `add.js`；
3. 先由测试执行 `node add.test.js`，确认 fixture 确实失败；
4. Agent 使用真实 bash 修复；
5. 测试重新执行 `node add.test.js`；
6. 检查 stdout 包含 `PASS`；
7. 检查 `add.test.js` 字节级未被修改；
8. 检查 `add.js` 不再包含错误实现。

Agent 的摘要即使声称“已修复”，外部命令不通过也不能通过测试。

## 十一、实际验证结果

以下命令在目标仓库实际执行：

| 命令 | 可观察结果 |
|---|---|
| `pnpm exec vitest run packages/host/apiproxy/tests/client-handler.spec.ts packages/test-support/llm-replay/tests/llm-replay.spec.ts packages/core/agent-loop/tests/contract-regressions.spec.ts --reporter=dot` | `Test Files 3 passed (3)`；`Tests 159 passed (159)` |
| `pnpm exec vitest run packages/test-support/llm-mock-server/tests/server.spec.ts packages/test-support/acp-snapshot/tests/suite.spec.ts --reporter=dot` | `Test Files 2 passed (2)`；`Tests 153 passed \| 1 skipped (154)` |
| `pnpm exec vitest run packages/llm/llm/tests/properties.spec.ts packages/core/tools/tests/properties.spec.ts packages/core/session/tests/properties.spec.ts packages/core/agent-loop/tests/properties.spec.ts --reporter=dot` | `Test Files 4 passed (4)`；`Tests 19 passed (19)` |
| `pnpm run test:gui -- --reporter=dot` | `Test Files 271 passed \| 1 skipped (272)`；`Tests 3754 passed \| 4 skipped (3758)` |
| `pnpm exec vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/subagent-inheritance.snapshot.ts --reporter=dot` | `Test Files 1 passed (1)`；`Tests 1 passed (1)` |
| `pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/full-loop.e2e.ts examples/headless-agent/tests/coding-task.e2e.ts --reporter=dot` | `Test Files 2 skipped (2)`；`Tests 2 skipped (2)`；原因是没有 `DEEPSEEK_API_KEY` |
| `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/todo-row.snapshot.ts --reporter=dot` | 未进入测试；缺少 `packages/typert/registry/lib/client.js` |

`test:gui` 输出中出现了若干 React 错误栈，但最终退出码为 0；这些是测试主动触发的错误处理场景，不是失败结果。

第一次并行执行 pnpm 命令时，Windows 环境出现：

```text
[ERR_PNPM_EPERM] ... rename ... eslint-plugin-sonarjs ...
[ERR_PNPM_EPERM] ... rename ... knip ...
```

随后单独执行的测试正常通过。该问题记录为并行依赖安装的环境摩擦，不归因于被测代码。

## 十二、风险与未验证边界

### 已确认风险

1. **覆盖率存在显式豁免。** 纳入范围的源码逐文件 100%，但若干 GUI、Web、Host 和动态组合文件仍在豁免列表。
2. **真实 API 本地缺失密钥时自跳过。** 这保证 fork CI 可运行，但开发者只看绿色结果时可能误以为真实模型已经执行；受信任 CI 的 preflight 可避免 CI 假绿。
3. **嵌套 Agent replay 依赖 first-call order。** 顺序委派可靠，真正并发 sibling subagent 的绑定仍未解决。
4. **Web header pin 尚未完整建立。** Web fixture 会 scrub header，避免环境漂移，但降低了 Web 组装层对请求头结构变化的敏感度；ACP snapshot 有更严格的 header pin。
5. **Web lane 依赖构建产物和 Chromium。** 本次直接运行 Web snapshot 因缺少 `packages/typert/registry/lib/client.js` 未执行；完整 `pnpm run test:web` 会先 build，但本次没有运行完整 build 和浏览器门禁。

### 未执行项

- 全仓 `pnpm run test`；
- 全仓 `pnpm run test:coverage`；
- 完整 `pnpm run test:snapshot`；
- 完整 `pnpm run test:web`；
- 带真实密钥的 `pnpm run test:e2e`；
- Web perf / stress；
- 浏览器人工验收和真实 Provider 调用。

## 十三、证据来源

目标仓库内主要证据文件：

```text
package.json
vitest.config.ts
vitest.e2e.config.ts
vitest.snapshot.config.ts
vitest.web.config.ts
vitest.web.perf.config.ts
vitest.web-stress.config.ts
docs/testing.zh.md
scripts/test-invariants.ts
packages/test-support/README.md
packages/test-support/acp-snapshot/README.md
packages/test-support/llm-replay/README.md
packages/test-support/loader-smoke/README.md
packages/core/agent-loop/tests/contract-regressions.spec.ts
packages/core/agent-loop/tests/properties.spec.ts
packages/host/apiproxy/tests/client-handler.spec.ts
packages/test-support/llm-mock-server/tests/server.spec.ts
packages/test-support/acp-snapshot/tests/suite.spec.ts
packages/test-support/llm-replay/tests/llm-replay.spec.ts
examples/headless-agent/tests/coding-task.e2e.ts
examples/headless-agent/tests/full-loop.e2e.ts
examples/acp-agent/tests/acp.snapshot.ts
apps/web/tests/scaffold.ts
apps/web/tests/workflow-run.e2e.ts
apps/web/tests/todo-row.snapshot.ts
.github/workflows/e2e.yml
.agents/notes/implemented/testing/2026-06-11-property-based-testing.md
.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md
.agents/notes/implemented/testing/2026-06-19-real-api-e2e-ci.zh.md
.agents/notes/implemented/testing/2026-06-22-subagent-snapshot-replay.md
.agents/notes/implemented/testing/2026-07-25-scriptable-llm-wire-fault-server.md
.agents/notes/implemented/process/2026-07-20-gui-testing-system.zh.md
```
