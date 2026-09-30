# 产品 Agent 资产规范

适用：`packages/neuro-book/assets/workspace/.nbook/agent/**` 中的 Profile、Workflow、Skill、变量和模板源码。TypeScript/TSX 同时读取 [`common.md`](common.md) 与 [`languages/typescript.md`](languages/typescript.md)；Python Skill 工具追加 [`scripts/python.md`](scripts/python.md)。

- `builtin/`、Workflow、Skill 和变量源码是可编辑真相源；`.compiled/`、`.staging/`、artifact hash 文件和生成类型只由现有资产生成命令更新。
- Profile TSX 使用 `profile-sdk` 公开入口，Import path 必须通过产品 allowlist；引用规范路径时同步 Profile 合同测试、资产投影和打包消费者。
- Workflow 定义节点身份、输入输出、并发、暂停/恢复和失败路径；跨 Run 数据保持可序列化并由稳定 schema 约束。
- Skill 的说明、脚本和资源共同构成调用合同；修改时保持触发条件、步骤和完成标准可验证。
- 变量定义、Profile 模板和运行期生成类型必须同源；资产变化运行 `prepare-system-assets` 相关聚焦测试和 Profile 文档示例扫描。

完成标准：只编辑资产源码，生成物由命令重建，Profile/Workflow/Skill 入口可被真实资产编译器消费，所有静态路径和 Import 消费者同步切换。