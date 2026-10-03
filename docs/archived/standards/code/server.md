# 服务端领域规范

适用：`server/**`。同时读取 [`common.md`](common.md) 与 [`languages/typescript.md`](languages/typescript.md)；涉及 Prisma、SQL 或 migration 时追加 [`database.md`](database.md)。

- HTTP 路由只处理请求解析、授权、调用领域入口和响应投影；业务状态转移放在现有 service、facade、repository 或 runtime owner 中。
- 请求体、查询、路径参数、文件和 Provider 响应使用现有 schema 或解析器验证。HTTP 错误通过领域既有映射器保留状态码、错误码和可诊断原因。
- Project Workspace 路径先归一化并通过 containment；文件写入、索引、历史和 Session 生命周期使用现有 `server/workspace-files` 与 `server/workspace-history` 所有权边界。
- 长任务、Agent Job、Workflow、进程和流式响应定义取消、超时、恢复与关闭路径；请求结束不能遗留无人持有的异步工作。
- App State、Project State、可重建缓存和用户资产保持独立 owner；跨边界 DTO 在 `shared/` 定义，不从前端组件或桌面宿主反向导入。
- 结构化日志只记录操作身份、稳定字段和脱敏错误；小说正文、提示词、Session、Provider 原始请求和秘密不进入日志。
- 对外 API、状态机、文件所有权、并发和恢复行为使用行为测试；路由测试验证可观察 HTTP 合同，领域测试验证状态与失败语义。

完成标准：每个外部输入经过运行期验证，每个状态修改由唯一领域 owner 执行，每个长任务存在取消和清理路径，HTTP 与领域错误合同都有聚焦测试。