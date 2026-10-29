# 事件模型 spike

一次性原型，检验 [Agent harness 的事件模型](../../../../../../docs/proposals/agent-harness-event-model.md) 的架构、API 形状与性能。不是产品代码：模型与工具是假的，日志在内存里，不做流式（适配器）与真实的存储。

第一版（提交 cffac7f42）经过两位审查者审查（`../evidences/design-review-r1-*.txt`），第二版按审查意见改写。

| 文件 | 内容 |
|---|---|
| `api.ts` | 公开接口：`defineExtension`、`defineProfile`、内核事件 `K` 与 `is`、片 `path`/`session`、事件 `conv`/`ext`、跨扩展选择器的声明合并 |
| `kernel.ts` | 内核：追加与归约、派发、单写者与边界、一次运行、工具批次与并发、失败与中止、恢复、换 Profile、视图、请求校验、拦截链、预览、缓存比对、压缩 |
| `template.ts` | Profile 模板：经典 JSX，`<System>`、`<User>`、`<Assistant>`、`<P>`、`<Tag>`、`<If>`、`<History>`、`<Input>`、`<Transcript>`、`<Slot>` |
| `core.ts` | 内置扩展 `core.history`（持久链表）与辅助函数 `historyExtension`、`seed`、`reminder` |
| `examples/plugins.ts` | 全局扩展：文件变更、记忆、模式、任务、库结构、工作区焦点、时间、剩余额度，以及路由、用量、想绕过审批的插件 |
| `examples/profiles.tsx` | 写手、主创（旧 leader.default 的结构）、行内编辑（单轮模板）、总结者（替换 `core.history`）、写错的历史投影 |
| `check.ts` | 53 个场景检查，每个对应提案里的一条承诺或一条审查发现 |
| `typetest.ts` | 八种写错的地方应当是编译错误（`@ts-expect-error`） |
| `bench.ts` | 性能粗测（`FREEZE=0` 关掉开发模式的冻结） |
| `v4/api.ts` | 第四稿的公开接口，只有类型（缓冲区事件、`Turn`、`turn`/`commit`、`<History>` `<Turn>` `<Slot>`、`conv`/`prelude`/`ext`） |
| `v4/leader.default.tsx` | 第四稿的主创 Profile 与两个全局扩展，只过 tsc |
| `v4/typetest.ts` | 第四稿接口的写错应当是编译错误 |
| `v5/api.ts` | 第五稿的扩展与 Profile 接口，只有类型（契约与 `dependsOn`、带作用域的片、`mount`、`system` 与 `prompt`；helper `reminder()`、`opening()`、`standardLayout()`、`finalOnly()`、`withoutEvents()`、`deriveProfile()`） |
| `v5/host.ts`、`v5/testing.ts` | 宿主接口（指令与失败码、帧、预览、插件宿主）与测试工具，只有类型 |
| `v5/plugins.ts`、`v5/profiles.tsx`、`v5/tests.example.ts` | 第五稿的全局扩展、Profile（主创、写手、行内编辑、总结者、整张模板、派生变体）与测试的例子，只过 tsc |
| `v5/typetest.ts` | 第五稿接口的二十九处写错应当是编译错误 |

在本目录运行（`tsconfig.json` 里的 JSX 设置要在这里才生效）：

```sh
bun check.ts
bun bench.ts 1200
../../../../../../node_modules/.bin/tsc -p tsconfig.json
```
