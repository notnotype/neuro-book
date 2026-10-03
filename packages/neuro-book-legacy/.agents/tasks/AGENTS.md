# 应用包 Legacy Task Agent 指令

共享 current Work/Task 合同见根 [`.agents/works/`](../../../../.agents/works/README.md)；本文件只保留应用 legacy Task owner 边界。

- 稳定 legacy Task 名先在根 `.agents/tasks/ownership.json` 精确查找。
- 已登记 Task 只从本目录解析；未登记 legacy Task 只从根 `.agents/tasks/` 解析。
- 不创建 owner 前缀、不模糊匹配、不跨 root fallback；manifest 或登记目标异常时失败。
- 历史 Task 正文、walkthrough 和 evidence 不因模型切换批量改写；本目录不接收 `nbook.task/v2`。
