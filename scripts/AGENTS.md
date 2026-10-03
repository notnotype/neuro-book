# scripts 目录规则

- 脚本是仓库治理与自动化命令的宿主适配层；保持现有 CLI 名称和调用路径。
- 使用 `nbook/*` 绝对导入、4 空格缩进和完整类型；领域逻辑留在对应 Module，不为单次调用创建 wrapper。
- Agent、测试、验收、缓存和 scratch 运行数据走 `@notnotype/neuro-book-test-support/paths`，不得新写仓库 `.agent/tmp/`。
- 新增或修改命令必须保留可执行入口、明确错误码和可验证的聚焦测试；脚本默认不加载 `.env.local`。
