# ADR 0007：Project 切换采用 Close-Then-Open

- 状态：Accepted
- 日期：2026-07-28
- 关联任务：[Task 118](../../.agents/tasks/118-project-catalog-snapshot-path-integration/README.md)、[Task 129](../../.agents/tasks/129-project-picker-and-session-entry/README.md)
- 取代：[ADR 0004](0004-project-activation-handoff.md)

## 背景

ADR 0004 让候选 Project 在旧 Project 仍挂载时完成 `open + presence_ready`，再一次性交接工作面。它能避免 strict-open 竞态，但必须同时维护旧 Project、候选 Project、两套 presence 所有权和失败回滚，页面、Preview 与 SSE 都要理解候选 generation。

普通桌面 IDE 的切换语义更直接：先关闭当前前端工作面，再打开目标。NeuroBook 的服务端 Project 生命周期已经由 presence、Agent occupancy 与 grace/sweep 独立管理，前端离开不需要也不应该调用全局 close。

## 决策

Project 切换采用单一 close-then-open 状态机：

1. 路由参数只表示 Project open intent。Header、Picker、浏览器前进后退和冷启动深链都交给同一个页面 transition。
2. transition 在任何释放前先完成草稿、未保存内容和正在保存状态的检查；取消或保存失败时保留旧 Project 并恢复旧 URL。
3. close 开始后，立即停止 Workspace SSE 和 Project consumer，等待本标签页 presence 退出，持久化旧标签状态并清空 Current Project、文件树、标签和 Project store。
4. `ProjectSessionController.open(projectRoot)` 依次等待服务端 open 和匹配的第一帧 `presence_ready`，然后发布递增 ready revision。只有 exact ready root 与页面 bootstrap 都成立时才挂载 Project 数据面。
5. close 后任一 open、presence、文件树或标签恢复失败，都释放未完成 surface 并回到 Project Picker；不恢复旧 Project。
6. same-root opening 使用 single-flight；新 root supersede 在途 opening。迟到结果只能被丢弃，不能发布 ready。
7. presence 断线立即撤销 ready 并进入 reconnecting；重新完成 `open → presence_ready` 后发布新 revision。Workspace SSE 按 revision 重订阅并丢弃旧代事件。
8. `release()`、普通切换和页面退出只释放本标签页 presence，不调用 `/api/projects/close`。全局 close 只属于删除和显式管理控制面。

Workflow Preview 与 World Engine Preview 使用同一 cold transition：先释放旧 preview presence、清空旧数据，再打开目标；只有最新 selection revision 可以提交请求结果。

实现还必须满足两个 generation 约束：离开 `ready` 时立即撤销旧数据与在途请求的提交权；首次 open 和 reconnect 都通过 `projectRoot + readyRevision` 的 single-flight loader 读取数据。旧请求的 `finally` 不能关闭新 generation 的 loading 状态。

Controller 进入 terminal `failed` 时，页面必须停止 Workspace SSE、释放本标签页 presence、清空 Current Project surface 并把 URL 规范为 `/`。Controller 已经展示的领域错误不应在页面层重复通知。

前端只按稳定 `data.code` 识别 `PROJECT_IN_USE` 与 `PROJECT_NOT_OPEN`，不得从 HTTP 409 猜测领域错误。

## 原因

close-then-open 让页面任一时刻最多拥有一个 Project surface，不再需要候选与旧 Project 并存，也不需要把失败回滚扩散到 store、URL、标签和 SSE。它保留 strict-open 的服务端保护，同时把多标签页与后台 Agent 的共享生命周期留给现有 occupancy/grace 机制。

## 后果

- 切换期间显示统一不可编辑空态，旧 Project 不再留在屏幕上。
- close 已开始后的失败回到 Picker，用户需要重新选择；这是简化状态机的明确交互代价。
- 新增 Project 数据面必须受 `projectSurfaceActive` 守卫，不能只观察 route 或 `currentProjectRoot`。
- Preview 数据请求必须同时证明 selection revision 与 ready revision 所有权；Project root 相同但 revision 不同也视为不同 generation。
- Controller 和页面测试必须覆盖 release-during-open、A→B→C、断线重连、旧 SSE revision、保存取消和打开失败。
- 浏览器验收必须确认普通切换不会影响另一标签页或后台 Agent。

## 未采用方案

- 候选 handoff：失败时可保留旧 Project，但引入两套并存 surface 与所有权，复杂度高于实际收益。
- endpoint 重试或固定延时：不能建立 ready 证明，只会移动竞态窗口。
- 普通切换调用全局 Project close：会错误中断其他标签页或后台 Agent。
- 页面各自维护 open watcher：无法约束 Header、路由、Preview 和 SSE 的一致顺序。
