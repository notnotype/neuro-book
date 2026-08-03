# ADR 0011：Agent 资产只使用一个安装身份

- 状态：Accepted
- 日期：2026-07-29
- 关联任务：[Task 88](../tasks/88-workshop-platform/README.md)、[Task 120](../tasks/120-agent-skill-package-contract/README.md)
- 协议真相源：[Agent Asset Package Protocol](../../reference/agent/agent-asset-package.md)

## 背景

Workshop 同时发布 Skill、Workflow 和 Profile。站点需要一个稳定字段完成版本归属、更新比较和安装冲突判断，而 NeuroBook 运行时又已有 Skill key、Workflow key 和 Profile `profileManifest.key`。如果再引入 `assetKey`，或者让 slug、入口文件名与运行时 key 分别成为身份，就会出现多个字段可以互相漂移：站点能成功发布，客户端却无法判断应该更新哪个本地资产。

Profile 的真实 key 已使用 `leader.default`、`world.engine` 等点分形式；Skill 和 Workflow 则适合目录名与命令行友好的 kebab-case。把三类资产强制压成同一种字符规则，会迫使 Profile 在上架时改名，并破坏现有路由和覆盖语义。

## 决策

1. 根 `package.json.name` 是发布包唯一的安装身份，不新增 `assetKey`，也不从 Workshop slug 推导安装身份。
2. Skill 和 Workflow 的 `name` 使用 kebab-case。Profile 的 `name` 使用小写点分 key，每段允许小写字母、数字和连字符。
3. Workshop slug 只负责网页地址和条目查找。首版成功后，条目的类型与安装身份不可变；后续版本必须与首版一致。
4. 固定入口由安装身份派生：Skill 为 `SKILL.md`，Workflow 为 `workflow.ts`，Profile 为 `<name>.profile.tsx`。
5. Skill 的 `SKILL.md` frontmatter `name` 必须等于 `package.json.name`；Workflow 静态对象的 `key` 必须等于 `package.json.name`。
6. 站点对 Profile 只验证 TSX 语法和 default export，不执行或编译作者源码。NeuroBook 客户端未来编译 Profile 后，必须在发布到 catalog 前确认 `profileManifest.key === package.json.name`。
7. 站点返回的 `containsExecutableCode` 只是风险提示字段，不构成代码可信或隔离证明。Workflow/Profile 恒为 `true`；Skill 按脚本、命令和 Bun 安装输入计算。
8. 在客户端完成第三方 Workflow 的隔离威胁模型、安装事务、冲突处理和回滚前，不允许把站点发布成功解释为可自动安装或可安全执行。

## 后果

- 包作者只维护一个跨版本身份；站点、客户端安装目录和运行时 key 有明确的相等约束。
- Profile 可以保留现有点分 key，不需要为 Workshop 创建别名或改名映射。
- slug 可以为了可读性与安装身份不同，但任何安装或更新逻辑都不得使用 slug 代替 `package.json.name`。
- 客户端安装实现必须在落盘前验证包身份、入口与编译产物身份，并把验证纳入同一可回滚事务。
- TypeScript AST 检查继续只是发布质量门禁。它不能替代进程隔离、权限约束或代码审查。

## 修订（2026-08-01，Task 135）

[Task 135](../tasks/135-agent-asset-install-protocol/README.md) 决定兼容 [Agent Skills 开放标准](https://agentskills.io/specification)，因此 Skill 的身份读取位置发生变化。本 ADR 的核心原则不变——**仍然只有一个安装身份，不新增 `assetKey`，不用 slug 代替**——变的只是 Skill 从哪里读它：

- 决策 1 对 Skill 修订为：`SKILL.md` frontmatter 的 `name` 是安装身份真相源。根 `package.json` 对 Skill 降级为可选，仅在携带 `bin`、`scripts` 或 Bun 安装输入时必需。Workflow 与 Profile 没有 frontmatter，继续以根 `package.json.name` 为身份。
- 决策 5 对 Skill 修订为：`package.json` 存在时，其 `name` 必须等于 frontmatter `name`；不存在时不做该项校验。Workflow 的 `key` 必须等于 `package.json.name` 不变。
- 新增：Skill 的展示名是 `metadata.displayName`，允许中文；它**不是**身份，不参与任何安装、更新或覆盖判断。版本读取顺序为 `metadata.version` → `package.json.version`，两处并存时以前者为准。

决策 2、3、4、6、7、8 不变。站点侧尚未实施本修订，详见 [Agent Asset Package Protocol](../../reference/agent/agent-asset-package.md) 的 Pending Site Changes 小节。

## 未采用方案

- 新增 `assetKey`：会与 `package.json.name`、Workflow key 和 Profile key 形成重复真相源。
- 所有类型统一 kebab-case：会破坏现有点分 Profile key，并增加没有产品收益的迁移映射。
- 用 Workshop slug 作为安装身份：网页地址是平台命名空间，不应决定本地运行时覆盖和更新语义。
- 站点编译或执行作者代码来确认 Profile：扩大公网服务攻击面，且仍不能证明客户端运行时安全。
