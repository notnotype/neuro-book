---
schema: nbook.task/v2
taskId: t22-background-work
status: shelved
updated: 2026-10-28
---

# 后台任务与协作：shell 后台、Agent 后台调用、Monitor、活动面板

## 目标与范围

把 shell 后台命令与 Agent 后台调用当作同一类后台工作统一管理：执行时限、转后台、通知、Monitor、停止与寿命，以及全局的活动面板（对应 omp 的 Agent Hub）

来源：t12 讨论（2026-10-28）；开发者指出 Agent 后台调用与 shell 后台命令逻辑类似，可以统一管理。

合同：本 Task 搁置，行为合同未变。

## 已知情况

事实见[外部参照](../../../../../docs/research/agent-runtime-references.md)“shell 工具、执行时限与后台任务”一节：

- omp：shell 参数 `async` 转后台，跑过 60 秒自动转后台；`wait` 工具阻塞等自己启动的任务（上限 30 分钟）；`proc://` 读状态与输出、写 stdin、结束；`/hub` 打开 Agent Hub 界面（agents 与 activity 两块，可切到子代理会话）。
- Claude Code：`run_in_background` 后台运行，结束时宿主重新唤起 Agent；Monitor 把长期运行脚本的每行输出当事件推给 Agent；TaskStop 结束。

2026-10-28 会话里的方案草稿（未定）：

| 项 | 草稿 |
|---|---|
| 转后台 | 参数 `background: true`；跑过 60 秒自动转后台；输出写 `session://jobs/<id>/output.log` |
| 管理 | `job` 工具查状态、停止；每会话最多 8 个，另有全局上限 |
| 通知 | 结束时往会话追加一条“后台任务结束”的消息（退出码、输出位置）；会话在运行时按插话送达（t07） |
| 空闲时结束 | 是否自动唤起 Agent 未定；倾向先不唤起，只写进会话并在界面提示（同 t07“中断后不自动续跑”的理由） |
| 以后 | Monitor（输出逐行作事件）、`wait`、服务形态（等就绪行或端口） |
| 寿命 | 会话删除、Agent 插件停用、服务端重启时结束，记为“已中断” |
| 界面 | 全局“活动”面板：运行中的会话、子代理、后台任务，可停止、可跳转（对应 omp 的 Agent Hub） |

统一管理的范围：shell 后台命令与 Agent 后台调用（t14 的后台子代理）用同一套任务模型、通知与活动面板。

## t14 已定的部分（2026-10-30）

[t14](../t14-multi-agent/README.md) 第 10、19 条：能转后台的工具都有 `async` 选项，打开时立即返回任务 id；后台 shell 与后台子代理由同一个任务中心管理，用户在前端能看到；Agent 用 `wait`（`jobs?`、`timeout?`）、`kill`（`job`）、`jobs` 三个工具等待、杀死与列出。本 Task 重开时在此基础上定：结束时怎样通知（空闲时要不要唤起 Agent）、自动转后台、寿命、上限与活动面板。上文草稿的 `job` 工具与 `background: true` 参数由这条取代。

## 当前状态

搁置（开发者 2026-10-28：先记录，开 Task 搁置）。

## 下一步

需要时重开，先与开发者讨论；t14 的后台调用、t17 的活动面板以本 Task 为准。
