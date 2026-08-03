# 更新日志

这里只放当前版本。更早的版本见 [docs/changelog/](docs/changelog/)。

## 0.9.1-canary - 2026-08-03

这一版继续收紧运行时、安装和 Agent 资产的边界，并把 llmlint 的静态检查、检测和复测结果整理成可复查的报告。它仍是 canary 版本，正式发布前的平台和人工验收不会被本地结果替代。

### 新功能

- llmlint 增加审稿报告和轮次指标，能把规则命中、密度信号和复测结果放在同一份报告里。
- Agent 资产和 Skill 现在有明确的安装、frontmatter 与运行时校验合同，内置资源发现异常时会直接报告原因。
- 缺失的 Agent 对话会显示明确的恢复结果；重试、分支和 `/fork` 的语义保持可追踪，不会悄悄创建隐式会话。

### 改进

- Windows Product Runtime Image 以 verified identity 为唯一输入，运行时、安装管理器、Portable 和容器不再从工作树猜测 `.output` 来源。
- Profile/Variable 编译、安装更新、进程关闭和发布候选使用明确的 staging、lease、manifest 与恢复检查，减少中断后留下半成品的机会。
- llmlint 的运行时快照从 sibling 仓库同步，发布包不再维护第二份独立源码。

### 修复

- 修复 Profile/Variable authoring 在完整源码和 Product 目录同时存在时错误借用 Source worker 的问题。
- 修复安装岛在干净 Bun 安装中依赖被提升到根 `node_modules` 后无法解析的问题。
- 修复旧会话、Agent Skill frontmatter 和报告 JSON 字段容易被消费者误读的几类边界错误。

### 升级须知

- 这是 canary 版本。升级前请备份整个 `data/` 目录，并先在不重要的项目上验证启动、迁移和 Agent 编译。
- 正式发布仍需等待五个平台、容器、Portable 和人工界面验收；本版本不能把这些未完成项当作已通过。
