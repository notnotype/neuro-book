# NeuroBook Agent 治理

仓库级规则从根目录 [`AGENTS.md`](../AGENTS.md) 开始；`.agents/` 只保存可版本控制的 Agent 治理资料。

## 目录

- `issues/`：重大/长期目标的未授权远端草稿与Draft-Key规则；Work 可选引用取得编号后的 Issue。
- `works/`：current Work 与 Task 的唯一入口。Work 保存范围与授权，Task 保存当前执行快照，历史按需链接。
- `tasks/`：legacy Task archive、ownership、密封迁移 provenance 和历史证据；不接收 current v2 Task。
- `skills/`：按需协调、Git／发布、报告、写作与诊断方法；不设置正式角色、额外审批或第二套完成门禁。

修改测试、fixture、验收或临时数据时读 [`docs/testing/README.md`](../docs/testing/README.md)；进入脚本、前端或 package 时读取最近的作用域 `AGENTS.md`。产品运行时使用的 `assets/workspace/.nbook/agent/skills/` 和 Project Workspace 内的 `.agent/` 不属于这里的开发治理资料。