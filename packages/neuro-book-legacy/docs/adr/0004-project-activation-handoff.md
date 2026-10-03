# ADR 0004：Project 激活必须以 Ready Handoff 提交

- 状态：Superseded by [ADR 0007](0007-project-close-then-open.md)
- 日期：2026-07-28
- 关联任务：[Task 118](../../.agents/tasks/118-project-catalog-snapshot-path-integration/README.md)

## 背景

> 本 ADR 记录过渡期的候选 Project handoff 方案。实现审查后改为更简单的 close-then-open 状态机；以下内容仅保留决策考古，不再是当前前端合同。

前端过去用同一个 `currentNovelId` 同时表达“用户想打开哪个 Project”和“哪个 Project 已经可以承载数据面”。store 会先提交目标，再由 `useProjectSession(targetRef)` 的 watcher 在后台执行 open 与 presence 连接。Config、文件树、Workflow、World Engine 和 Workspace SSE 因而可能在 Project 尚未 ready 时请求 strict-open route，稳定得到 `PROJECT_NOT_OPEN`。

在请求端增加重试、固定延时或吞掉 409 只能移动竞态窗口。更严重的是，候选 Project 打开失败时，旧实现已经释放旧 presence，页面选择、URL、可编辑数据面和服务端生命周期会互相矛盾。

## 决策

Project 切换是一个显式、可等待的激活事务，由 `ProjectSessionController` 单独拥有：

1. `activate(projectRoot)` 创建候选 generation。
2. 候选必须先完成服务端 open，再收到与目标匹配的第一帧 `presence_ready`。
3. 候选 ready 前，旧 Current Project、旧 presence、store 和 Project 数据面保持不变；界面显示全局阻塞层并禁止继续编辑。
4. 候选 ready 后，调用方才一次提交 Current Project、URL、文件树、标签恢复和 Workspace SSE。
5. 候选失败时保留旧连接和旧数据；普通切换恢复旧 URL，首次深链接失败返回 Project Picker。
6. 同 root 激活使用 single-flight；快速 A→B→C 使用 latest-wins。被取代或迟到的候选 generation 必须主动释放，不能成为无人接管的 ready Project。
7. `release()` 和页面退出只释放本标签页 presence。普通切换不关闭服务端 Project；删除或显式管理操作才调用 close。
8. 服务重启后的重连同样经过 `open → presence_ready → 发布新 revision`，Workspace SSE 按 revision 重新订阅并拒绝旧代事件。

`currentProjectRoot` 只表示已经提交的 Current Project。路由中的 Project 参数在激活完成前只是打开意图。所有 Project 数据面只在 `ready-project` 状态挂载。Header、Picker、浏览器前进后退、Workflow Preview 和 World Engine Preview 共用这条事务。

HTTP 领域错误由服务端统一映射。前端只按稳定 `data.code` 分支；任意 409 不得被推断成 `PROJECT_IN_USE`。

## 原因

strict-open 是数据面代次与资源所有权的保护，不是需要放宽的错误。把 ready 边界放进 Controller Interface 后，调用方无法通过写一个响应式目标绕过 open/presence 顺序；页面只消费已完成 handoff 的状态，也不再需要为每个 endpoint 各自设计时序补丁。

候选 ready 前保留旧连接，使失败回滚不需要重建旧页面状态。普通离开只释放 presence，则避免多标签或后台 Agent 仍使用 Project 时由一个标签页误关全局 Project。

## 后果

- Project 切换期间旧页面暂时保留但不可编辑，直到候选成功或失败。
- Project Picker 与首次深链接失败不会静默选择列表中的第一个 Project。
- 新增 Project 数据面入口必须消费 ready handoff，不能直接观察路由参数或 Current Project 意图。
- Controller 测试必须覆盖 same-root single-flight、latest-wins、失败保留旧连接、disconnect-during-open、迟到 open 清理和服务重启重连。
- 页面行为测试必须证明 ready 前没有 Project 数据面请求。

## 未采用方案

- endpoint 重试或固定延时：不能建立 ready 证明，也会掩盖迟到 generation。
- 服务端把未打开 Project 隐式打开：会把控制面副作用放进数据面读请求，破坏 Occupancy 与 generation 合同。
- 切换开始即提交 store 并在失败后重新加载旧 Project：扩大回滚面，仍存在旧 presence 已丢失的窗口。
- 每个页面各写一套 open gate：会继续产生 Preview、Header 和路由入口之间的行为漂移。
