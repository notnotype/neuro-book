---
schema: nbook.adr/v1
status: accepted
decided: 2026-11-19
superseded-by: null
---

# ADR 0056：后台工作的清单只汇总、状态归各自的提供方；会话的缓冲区收提示，唤起的门挂在会话上

- 日期：2026-11-19
- 决策者：开发者
- 关联工作：[w00032 t22](../../.agents/works/w00032-agent-integration/tasks/t22-background-work/README.md)、[t41](../../.agents/works/w00032-agent-integration/tasks/t41-session-notices-and-wake/README.md)、[t42](../../.agents/works/w00032-agent-integration/tasks/t42-task-list-providers/README.md)
- 相关文档：[提案：统一后台任务](../proposals/unified-background-tasks.md)、[`workbench/background-tasks.md`](../specs/workbench/background-tasks.md)、[`agent/jobs.md`](../specs/agent/jobs.md)、[`harness/runtime.md`](../specs/harness/runtime.md)
- 补充：[ADR 0055](0055-input-buffer-entry-states.md)：缓冲区多一种不进输入状态机的提示；0055 的决定不变

## 背景

后台工作分在几处：插件的长任务在 `nbook.tasks` 的清单里，Agent 的后台命令与子代理运行在 Agent 的任务中心里，Agent 的运行只在对话里看得到；以后还有更新、带进度的计算、定时任务与服务。Agent 不知道后台任务结束了，插件也没法给会话递一句“你该知道的事”（例如 eval 的内核被回收）。开发者 2026-11-19 要求所有后台工作归 `nbook.tasks` 管、按类型与会话分类，并提出缓冲区里的话各有发送时机：提示下一次请求就发、排在插话前面。

## 决策

1. **清单只汇总，状态归提供方**。`nbook.tasks` 是后台工作的一份清单，按归属（应用、项目、会话）、形态（一次性、服务、定时）与种类分组，只负责汇总显示与把操作转发回去。拥有状态的插件（Agent 的任务中心、以后的日程与服务插件）作为提供方交出行，状态、寿命与操作的执行都留在它那里；没有自己状态表的简单长任务照旧直接登记进 `nbook.tasks`。服务与定时的定义由提供方存。
2. **缓冲区收提示**。会话与宿主能往会话的缓冲区发提示：在取插话的同一处取走、排在插话与新话前面，不进输入的就绪与留着、不用放行，给模型时是带来源行的 `<system-reminder>`，不算用户的授权。Agent 把后台任务的结果、子代理给父 Agent 的同步提问作为提示送回会话；eval 在内核被回收或意外退出时发提示。
3. **唤起的门挂在会话上**。提示可以要求唤起空闲的会话。用户的停止被受理、运行不是正常结束时关门，用户自己的发话、继续或放行真正开起运行时开门；门的状态写在会话日志里，回退、换分支、压缩都不改变它。收口时一个会话只开一次后继运行，推迟的用户的话优先。

理由：

- 第一稿把 Agent 的任务状态搬进 `nbook.tasks`，两套生命周期（清单的 50 件上限与 Agent 的“留到取过”、两种 id、校验卡住收口、一次执行登记两行）在审查里冲突出一半的问题；状态归提供方、清单只是投影，是系统的任务管理器、VS Code 的 Task Provider、systemd 的 Unit 与 Job 的普遍做法。
- 结果若作为宿主的插话送进会话，模型看到的是用户角色的话，停过之后还要定谁放行；提示只告诉、不要求，不开一轮，用自己的取走规则更简单，也合开发者给的发送时机。
- 唤起若看当前叶子上最后一次运行，停止之后回退一下就能被后台结果唤起；把“等你”记在会话上，用户的停止不会被回退绕过。

代价：内核多几种会话级与路径事件（旧内核拒读、不能降级），并要调整边界上取插话的先后；`nbook.tasks` 的远程合同改版本；提供方要守注册代次、分页与隔离的约定；Profile 裁掉历史时提示与插话一样可能没进模型的请求，由 Profile 自己注意。

## 后果

- 实施拆成三个 Task：t41（内核的提示与唤起门）、t42（清单的提供方与分组视图）、t22（Agent 的结果送达、`shell` 自动转后台、eval 的提示、工具里登记任务，依赖 t41；交给清单的行依赖 t42）。各 Task 先用真实内核探针列全路径，再写 planned 的 Spec、各自审查；提案的两轮审查已按 Task 分好，作为输入。
- t24 的 Workflow 由 Agent 给工具的登记入口登记成会话的任务，得到 `wait`、送达与清单的行；w00043 t10 的日程作为提供方交出条目。
- `nbook.tasks` 的“不收 Agent 的后台工作”取消；Agent 的任务中心、`jobId` 与远程合同保持。
