---
schema: nbook.task/v2
taskId: t25-release-0-16-0-17
status: active
updated: 2026-11-25
---

# 发 v0.16.0、v0.17.0；推送 CI 的不稳定测试与发版命令的改进

## 目标与范围

两次经流水线发版的记录，以及发版与推送 CI 里暴露的问题：失同步用例的竞态（已修）、S10 冒烟与 shell 输出 21 的偶发（未定位，已加现场证据）、发版预检与 macOS 排队的自动处理（已做）。

合同：行为合同不变；发版流程改动写在 [发布手册](../../../../../docs/standards/releasing.md)。

## 当前状态

### 发出的版本

| 版本 | 日期 | 内容 | 结果 |
|---|---|---|---|
| v0.16.0 | 2026-11-23 | 服务商模板、模型清单、代理；nb-layout 0.1.0 首发（本机发布） | npm 两个包与 Release 发出；“上一版升级到本次”冒烟失败（向导的“跳过”被更新提示盖住），改了冒烟，由 0.17.0 验证 |
| v0.17.0 | 2026-11-24 | 后台任务分组、条目页整篇编辑与预览、代码输入框不弹补全、关键字着色、缓存键按会话固定 | npm 两个包与 Release（Windows）发出，升级冒烟通过；macOS 作业排队被放弃两次，改用手动工作流补传成功（见下一步） |

`PLUGIN_API_SINCE` 两版都没动：nb-layout 0.2.0 删掉的名字不在 SDK 的签名快照里，快照测试通过。

### 缓存键（v0.17.0 的修复）

`prompt_cache_key` 每轮都是新的随机 UUID：pi-ai 在调用方没给 `sessionId`、`promptCacheKey` 时现生成（`stream.ts` 的 `withInferenceSessionId`），`nb-harness` 的 `omp.ts` 没传。现在传会话 id 作 `promptCacheKey`（不传 `sessionId`，它还牵动 Codex 的传输状态与会话头）。Spec 见 harness/models.md 输出 23。没有对真实的 Ollama Cloud 验证命中率，等用户反馈。

### 推送 master 触发的 CI：2026-10-30 以来 40 次里 25 次失败

逐次看过日志的归类：

| 原因 | 次数 | 状态 |
|---|---|---|
| 治理检查没过（目录登记、固定等待等，2026-11-18 集中 8 次，11-23 1 次） | 9 | 都是真违规，已修；`rehearse` 现在先在本机跑 |
| 文档检查没过（`bots/view.md` 登记） | 1 | 已修 |
| 文件监视的用例在慢机器上 5 秒或 30 秒超时（`layer-owner.test.ts` 目录删除重建等，10-31 至 11-07） | 6 | 11-07 放宽上限后没再出现 |
| `markdown-dialect` 输出 18 的“失同步”用例 | 5 | 竞态：轮询里推进手动时钟，批在事件收齐前被切走。已加屏障事件（本机压满 CPU 时修复前 15 遍失败 5 遍、修复后 0），规则写进测试规范 |
| 真实的测试失败（目录场景、SDK 导出面） | 1 | 已修 |
| 零星：ECONNREFUSED 一次、dev-panel 背压用例一次 | 2 | 之后没再出现 |
| `smoke:server` S10 | 1 | 见下 |

同一次 13:00 的运行里还有 shell 输出 21 的 60 秒超时，它与“失同步”那条同在一次失败里。

### 没定位的两条

- **shell 输出 21（`kit/tools/shell.test.ts`）**：CI 上这条用例 60 秒超时，之后 `long.details.artifact` 是空的（全文没存成）。本机 1.4 秒；CPU 压满（核数两倍的空转进程）最慢 8.8 秒；整份跑三遍、整个 nb-harness 包跑一遍（1086 条、32 秒）都通过。读了 `OutputCapture`（60000 行逐行推入 212 毫秒）与 `localFiles` 的保存路径，没发现锁或 60 秒的上限。同一提交在演练的 `--all` 里通过。已改成拿不到全文地址时把结果末尾与 details 带进错误信息。
- **S10 冒烟（占用中的第二个实例）**：`second-exit=1 busy-has-url=false`，占用提示里没有第一个实例的地址。2026-11-20 修过一次“管道没读完”（等 stderr 读完再交退出码），这次又出现，说明不止这一个原因。可能的路径：认领探测 `HELLO_TIMEOUT_MS`（3 秒）内没得到应答时写的是“已有实例，但它没有应答”，不带地址。这是推断，没有现场数据；失败时现在会把第二个实例的 stderr 写进证据。

### 发版命令的改进（已合入）

- `rehearse` 的预检先查会发布的目录与 `bun.lock` 干净（含未跟踪文件）：v0.17.0 被别的会话在示例目录里 `bun install` 留下的锁文件拦在发版的第一步，我却先说了“已经在发了”。同时 `.gitignore` 忽略 `packages/nb-layout/examples/*/bun.lock`。
- 发布只有 macOS 没成功时自动重跑失败的作业一次再盯（手册原来是手工）。

## 下一步

- v0.17.0 的 macOS：原作业排队 15 分钟被放弃，重跑失败的作业后又被放弃（Apple Silicon 的 runner 容量紧张）；改用手动触发 `desktop-macos.yml`（[运行](https://github.com/notnotype/neuro-book/actions/runs/45417993579)，约 10 分钟排上并构建完），macOS 的 DMG、更新清单与 `SHA256SUMS-macos` 已补传到 Release（没有 macOS 补丁文件，手册允许）。原流水线那一轮的 macOS 作业保持“已取消”。macOS 仍没有真机验证。
- 2026-11-25 试复现 S10：直接起两个打包产物跑 15 轮，机器负载 24（别的会话在跑），15 轮都通过，没复现；仍等现场证据。
- S10、shell 输出 21 再出现时读证据：S10 看 `second-stderr`，shell 看错误信息里的“结果末尾”。再出现两次仍无头绪，就给 S10 的探测加日志、给 shell 用例分段计时。
- 9 个源码包有改动但没提版本（flock、runtime、ui、harness、markdown、agent-ui、story、plugin-sdk 等），要发布时再提；nb-layout 0.2.0 已在 npm 上，再发新版前 2 天内配置 trusted publishing。
- Release 说明的 omp 式本机整理步骤仍未做；“magpie”的链接没拿到。
- 2026-11-25 演练（[运行 45638084691](https://github.com/notnotype/neuro-book/actions/runs/45638084691)）CI 挂两条：`scripts/release/packages.test.ts` 里 w00043 t18 加的用例用了 Bun 才有的 `import.meta.dir`，vitest 在 Node 下取到 undefined，已改用文件顶部的 `REPOSITORY`（`87f676f1b`）；`explorer/browse.test.ts` 的“展开的目录改名：子树在新地址继续展开，选择跟随”是原有偶发：本机 master 40 次挂 2 次，11 月 10 日的提交上 40 次挂 7 次，失败时选择变成空（第 256 行），子树已在新地址列出。没查根因；推断是改名的变化分两批到达时，第一批算出的可见行先把选择剪掉了，要查时从 `explorer/web/controller.ts` 的 prune 微任务与 `tree/model.ts` 的 `onPathsChanged` 看起，用 `bun test src/plugins/explorer/browse.test.ts --rerun-each 40 -t '展开的目录改名'` 复现。
