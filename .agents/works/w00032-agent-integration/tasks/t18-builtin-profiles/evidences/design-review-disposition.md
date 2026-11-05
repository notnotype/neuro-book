# t18 设计审查的处理

审查对象：提交 `5f8e66563` 上的计划第一稿与 Spec 草稿。omp 默认模型，用时约 30 分钟，报告 [design-review.txt](design-review.txt)：11 条（阻断 2、重要 9），第 12 条是对第 2 条的收窄。报告按说明里的绝对路径本该写到主工作区的 `.local/`，它用了相对路径写到 worktree 的 `.local/`（git 忽略），主会话拷了出来。

主会话对照 `backend/remote.ts`、`shared/remote.ts`、`backend/sessions.ts`、`backend/resources.ts`、`run/loop.ts`、`api/events.ts` 逐条核实，并实测了 `.tsx`。

| # | 问题 | 归类 | 处理 |
|---|---|---|---|
| 1 | 新指令放进 `CommandMap` 会穿透远程：`COMMANDS` 由 `Object.keys(commandErrors)` 算，不是白名单 | 成立，要改 | 内核加 `hostOnlyCommands`，远程层按排除后的集合算；`SessionTable.view` 照常挂全部。没有采纳“另开宿主内部接口”：`accept` 的写入、幂等、队列都要复用，另开一条路更绕 |
| 2、12 | 压缩运行也写 `runEnded{completed}`，分不出来 | 成立，要改 | 触发改用 `turnEnded{completed}`：压缩运行没有轮。比审查者建议的给 `runEnded` 加 `kind` 更简单，也贴合“第一轮结束后” |
| 3 | `fork` 不触发 `opening()`，沿用复制来的规则 | 部分成立，接受取舍 | 主创会话创建时总会读一次，所以“来源没有片”只在 `changeProfile` 换成主创时才有；“文件改过”只是晚一点生效，与“两次压缩之间改了不生效”同类。写进 Spec 输出 5，不另写加载。主会话另外发现 `changeProfile` 这条，一并写明 |
| 4 | `Resources.read` 只有 `undefined` 或普通 `Error`，分不清 `no-project` | 成立，要改 | `kernelResources` 改抛带码的 `ResourceReadError`，`rules.ts` 按码判断。`Resources` 接口不变 |
| 5 | `session-title-<id>` 可能超过 128 字符；`session-exists` 没核对 | 成立，要改 | id 用前台 id 的 SHA-256 前 32 位；核对会话头的 Profile 与 `background`，对不上报 `session-meta-conflict`。没有采纳“保留来源字段”：会话头没有合适的字段，只为追溯不值得加 |
| 6 | 32 KiB 没定单位 | 成立，要改 | Spec 写明 UTF-8 字节，不切开字符 |
| 7 | `.tsx` 的编译边界没写 | 成立，要改 | 实测 `tsc` 报 `TS17004`（应用的 `tsconfig` 没有 `jsx`）。改成不用 JSX：`Tag`、`If` 按函数调用，从 `@notnotype/nb-harness/prompt` 导入（实测能跑）。文件名不带 `.profile.tsx` |
| 8 | `running()` 会列出标题会话 | 成立，要改 | `AgentService.running()` 不含后台会话，写进 `sessions.md` |
| 9 | 实验样本短、任务偏向 replace、`customFormat` 不兼容混入胜负 | 部分成立，要改 | 加长段（约 1500 字）与重复句任务，共 8 个任务 96 次；加端点预检与“没产生可解析调用”的单独计数；任务只给位置描述不给原文；写明结论只用于定缺省。没有加超过 2000 字符的行与多行段落：前者 `read` 本来读不全，后者不是这次的问题 |
| 10 | 兜底标题污染现有测试、异步未收口 | 部分成立，要改 | 收口由 `runtime.stop` 等集合解决；走兜底不发模型请求，所以按请求数断言的测试不受影响（审查者这点不成立）。第 4 片先量实际失败的测试再改。没有采纳“每个测试的 Profile 加 exclude”：改动面大，也不测真实路径 |
| 11 | `create` 不走 `accept`，停止时会漏关建到一半的标题会话 | 成立，要改 | 每一步碰会话的操作各自经 `table.accept`，只有 `waitRun` 不进去（进去会成环）。不用给 `SessionTable` 加新机制 |

## 审查者确认没问题的

`runEnded` 与重放的时序、`waitRun` 在关闭时以结果完成、`standardLayout({history: false})` 的结构、第二次运行的 `yield`、`titleBy` 从日志恢复、旧索引的 `description`、`pluginExtensions.exclude` 的机制。主会话没有逐条复核，第 4 片的测试会覆盖其中会影响结果的几条。
