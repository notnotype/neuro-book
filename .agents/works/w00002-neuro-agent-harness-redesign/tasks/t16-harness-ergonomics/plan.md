# t16 实施计划：第一轮优化

## Context

- **为什么做**：示例写完后暴露的手感与正确性问题（README 的表）；开发者选择先做一轮。
- **依据**：各项对应的 Spec 条目已在 README 列出；都是在已 `implemented` 的合同上加几条行为或改措辞，按 `docs/specs/README.md` 的“已实现的 Spec 加新行为”原地改条目，不另起 Spec。
- **工作方式**：一个提交实现全部项；每项先改 Spec 再改代码与测试；示例与命令行改用新接口（它们就是使用方）。

## 关键设计

1. **目录寿命（7）**：`createModelCatalog({config})` 的 `config` 接受 `HarnessConfig | ConfigStore`（有 `current` 的就是存储）；内部每次调用取 `current` 重建索引太贵，所以按快照身份缓存：快照对象没变就用上次的索引。`createRuntime` 在 `deps.models` 缺省时建 `createModelCatalog({config: deps.config})`。
2. **contextWindow（6）**：`compact()` 在受理后、压缩前看 `model.contextWindow`，不是正数 → `compaction-failed`，detail 写明“自建服务的模型要在配置里给 contextWindow”；`soft.applicable` 的 detail 同样写明。自动压缩不变（`shouldCompact` 对无窗口的模型本来就不触发）。
3. **字段（10）**：`prepare` 里未注册字段若 id 以 `harness/` 开头 → error 诊断；运行时注册四个字段，Profile 主机单独使用时需要先注册（profile 模块自己的测试用别的命名空间）。
4. **缺省依赖（1）**：`RuntimeDeps` 的 `host`、`models`、`tools`、`compaction` 可省略；`createRuntime` 填缺省并把填好的 `deps` 传给句柄（句柄代码不变）。
5. **内存凭据（2）**：`openCredentials({sqlitePath, apiKeys?})`，`apiKeys` 在 `reload` 之后逐个 `setApiKey`；`:memory:` 是 OMP SQLite 存储已有的能力，Spec 写明。
6. **`Invocation.next()`（3）**：句柄给每次调用一个 `next`：若该调用正在等待用户且有待处理事项 → 立即 `{kind: "waiting", pending}`；否则等下一次本调用的 `waiting-user` 状态事件或 `done`。实现用 `subscribe` 内部订阅，`done` 完成时释放。
7. **压缩注入（5）**：`createCompactionRegistry(options?: {soft?: {completeImpl}})`。
8. **`status.context`（9）**：句柄记最近一次受理的 `{contextWindow, settings}`；`status` 用 `shouldCompact` 算 `{tokens, window, threshold}`；从未调用过的会话没有这项。
9. **edit 说明（12）**：`description` = OMP `editDescription("hashline")` 加一段本模块约束（路径是根内相对路径；先 `read`）；live 场景补一条先读后改。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | Spec 条目（九处）、实现、合同测试补用例、示例与命令行改用新接口 | `bun test`、`bun run typecheck`、`bun run test:llm`（live 先读后改，需授权，已有） |
| S2 | omp 实现审查 → 处理；仓库门禁 | `bun run docs:check`、`bun run governance:check` |

## 验收映射

| 条目 | 测试 |
|---|---|
| models 输出 10（`ConfigStore`） | `src/models/catalog.test.ts` 新用例：`replace` 后 `resolve` 看到新服务 |
| models 输出 5、7（`:memory:`、`apiKeys`） | `src/models/credentials.test.ts` 新用例 |
| runtime 输入（缺省依赖）、输出 5（`status.context`）、输出 6（`next`）、输出 14（无窗口） | `src/runtime/runtime.test.tsx`、`approval.test.tsx`、`compaction.test.tsx` 新用例 |
| profile 输出 3 | `src/profile/prepare.test.tsx` 新用例 |
| compaction 输出 1、7 | `src/compaction/compaction.test.ts` 新用例 |
| builtin-tools 输出 6（说明） | `src/builtin/edit.test.ts` 断言说明含 OMP 文本；`examples/scenarios/live.llm.test.ts` 先读后改 |
