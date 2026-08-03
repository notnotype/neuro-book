# Agent Asset Package Protocol

本文是 NeuroBook 可发布 Agent 资产包的唯一协议真相源。它统一 Skill、Workflow 与 Profile 的**发布外壳**、版本和固定入口；Workshop 实现必须消费同一合同。

客户端的**本地安装、更新、卸载与来源记账**由 [Agent Asset Install Protocol](agent-asset-install.md) 定义。包结构与依赖细节继续分别由 [Skill package](skill-package.md)、[Workflow](workflow/README.md) 和 [Profile guide](profile-guide.md) 定义。

## Scope

- 通过 Workshop 发布的 Skill、Workflow、Profile 都必须是一个 ZIP，根目录必须包含 `package.json`。
- 本地只含 `SKILL.md` 的 loose Skill 仍可被 catalog 发现，但在发布前必须补齐本协议外壳。
- `package.json.version` 是 Workshop 发布版本和后续客户端更新判断的唯一真相源；不要把它与 Profile DSL 内部版本或业务 schema 版本混用。
- 站点只做结构验证，不执行作者代码。客户端安装、更新、冲突处理和回滚不在当前站点任务内。
- 站点的 TypeScript AST 检查只是发布质量门禁，不是安全沙箱。第三方 Workflow 的客户端自动安装和执行必须继续关闭，直到运行隔离威胁模型另行完成。

## Root Package

```json
{
    "name": "example-asset",
    "version": "1.2.3",
    "type": "module",
    "neurobook": {
        "schemaVersion": 1,
        "assetType": "skill",
        "minAppVersion": "0.8.0"
    }
}
```

- `name` 是唯一安装身份，不新增 `assetKey`，也不使用 Workshop slug 代替。完整决策见 [ADR 0011](../../docs/adr/0011-agent-asset-install-identity.md)。
- Skill / Workflow 的 `name` 必须是 kebab-case。Profile 允许 `leader.default` 形式的小写点分 key，每段只使用字母、数字和连字符。
- `version` 必须是 canonical SemVer。后续发布必须按 SemVer precedence 严格大于当前版本；只修改 build metadata 不算升级。
- `type` 固定为 `module`。
- `neurobook.schemaVersion` 当前固定为 `1`。
- `neurobook.assetType` 只能是 `skill`、`workflow`、`profile`。
- `neurobook.minAppVersion` 可省略；存在时必须是 canonical SemVer。
- 合法的其它标准 `package.json` 字段可以保留；已知字段出现 `null`、错误容器类型或错误元素类型时必须拒绝，不能按空值静默接受。
- 只有 Skill 可以声明 Bun 安装字段、`scripts` 或 `bin`。非空 `bin`、非空 `scripts` 或任一实际 Bun 安装输入存在时，根目录必须带非空 `bun.lock`；Profile / Workflow 声明这些字段一律拒绝。

## Fixed Entries

| Asset type | Required root entry | Additional contract |
| --- | --- | --- |
| Skill | `SKILL.md` | YAML frontmatter 必须包含非空 `name`、`description`，且 `name` 等于 `package.json.name`；可包含 `references/`、`assets/`、脚本、依赖和 `bun.lock`。 |
| Workflow | `workflow.ts` | 必须直接 default export 静态对象，`key` 等于包名并直接声明 `run` 函数；不得使用静态/动态 import、import-equals、export-from 或直接 `require()`。 |
| Profile | `<name>.profile.tsx` | 文件基名必须与 `package.json.name` 一致；源码必须是合法 TSX 并提供 default export，可带同名资料目录。 |

ZIP 内路径必须使用 `/` 分隔的相对路径。拒绝绝对路径、盘符、反斜杠、NUL、空段、`.` / `..`、Windows 保留名、末尾空格或点，以及大小写折叠后冲突的路径。目录不能移动到自身后代。

## Static Source Validation

- 三类固定入口分别限制为 1 MiB；`package.json` 限制为 64 KiB。
- Skill frontmatter 使用严格 YAML 解析，拒绝重复 key、错误对象形状、空 description 和身份不一致。
- Workflow / Profile 使用与服务端生产依赖相同版本的 TypeScript parser 检查语法；浏览器只在编辑这两类源码时懒加载 TypeScript，普通浏览页不加载编译器。
- Workflow 的 AST 门禁遍历全部语法节点，拒绝静态 import、动态 `import()`、`import =`、带 module specifier 的 export 和直接 `require()`；它不执行源码，也不声称覆盖混淆后的运行时行为。
- Profile 在站点只检查语法与 default export。未来 NeuroBook 客户端编译后，必须再次确认 `profileManifest.key === package.json.name`，才可发布到本地 catalog。

## Version And Storage

- Workshop API 对外只暴露 SemVer 字符串。版本查询参数使用 URL 编码后的 SemVer。
- 数据库为每个条目版本保存内部 `ordinal`，只用于发布顺序和磁盘文件寻址；它不是公开版本。
- ZIP 存储路径使用 `<filesDir>/<itemId>/<ordinal>.zip`。
- 旧整数版本 `N` 原地迁移为公开版本 `N.0.0`，原整数保留为 ordinal，因此无需改名旧 ZIP。
- 旧 ZIP 的 `nbook-package.json` 合并进已有或新建的根 `package.json`；旧清单删除，ZIP 大小、SHA-256 和代码风险字段重算。数据库 `packageSchemaVersion` 标记迁移状态，迁移必须可 preflight、幂等且失败时恢复原 ZIP。
- 迁移 sidecar 固定为 `.agent-asset-<versionId>.tmp` 与 `.backup`。schema、数据库摘要与正式文件不能唯一证明恢复方向时必须停止，不得按随机文件名或修改时间猜测。

## Publication And Update Rules

1. `POST /api/v1/items` 只创建作者可见的无版本 `unlisted` 草稿；它不会进入公开列表、详情或作者公开页，也不能在首版成功前切换为 `published`。
2. 首版上传成功时，条目类型必须与 `neurobook.assetType` 一致，安装身份从 `package.json.name` 落库，并在版本与元数据同一数据库事务成功后自动发布。无版本草稿可由作者显式删除并释放 slug。
3. 后续发布必须保持条目类型和安装身份不变；`version` 必须按 SemVer precedence 严格递增。prerelease 按 SemVer 标准排序，build-only 变化拒绝。
4. 版本上传 multipart 固定包含 `file`、`changelog` 和可选 JSON `metadata`。元数据、目标状态、版本和风险字段在同一数据库事务提交，上传失败不得提前修改公开条目。
5. 发布前同时执行 ZIP 20 MiB、实际解压内容 100 MiB、最多 500 条目的门禁；符号链接、特殊文件、伪造大小、路径逃逸和路径冲突必须拒绝。文本预览实际输出超过 200 KiB 时立即停止。
6. 已验证归档先完成文件 fsync 并同盘原子 rename，随后才提交数据库。数据库失败删除最终文件；数据库存在但正式归档缺失属于启动/readiness 故障，不能清理数据库记录掩盖事故。
7. Workflow / Profile 恒标记 `containsExecutableCode = true`；Skill 按 `bin`、`scripts` 和 Bun 安装输入计算。发布卡片、详情、版本历史与确认界面必须消费服务端字段，不能按类型自行猜测。
8. Workshop 的作者源包读取不增加公开下载计数，并允许作者读取自己的 unlisted / removed 资产用于修订。
9. 显式查询不存在的 SemVer 必须返回 404；只有请求未提供 `version` 时才能选择最新版。`+build` 等字符必须经 URL query 编码保真。

## Client Boundary

客户端的安装落点、同名冲突、来源所有权、更新冲突、校验失败回滚和旧版本保留由 [Agent Asset Install Protocol](agent-asset-install.md) 定义，不在本文范围内。

客户端还必须先完成第三方 Workflow 的隔离威胁模型，不能把站点 AST 校验当作执行安全证明。本协议存在不代表用户闭环已经完成。

## Pending Site Changes

以下条目是 NeuroBook 侧已拍板、**站点尚未实施**的合同变化。在站点跟进之前，生产行为仍以本文其余小节为准。

1. **Skill 的发布身份改从 `SKILL.md` frontmatter 读取。** 目标合同：`name` 是 id，`metadata.displayName` 是展示名，`metadata.version` 是版本。站点当前强制要求根 `package.json` 并从中取身份与版本，因此符合 Agent Skills 开放标准但没有 `package.json` 的 Skill 现在传不上去。
2. **Skill 的 `package.json` 降级为可选。** 仅在携带 `bin`、`scripts` 或 Bun 安装输入时必需。Workflow 与 Profile 没有 frontmatter，继续强制根 `package.json`。
3. 上述两条不改变 ZIP 门禁、路径安全规则、SemVer 递增规则和 `containsExecutableCode` 的计算方式。

跟进这两条时，站点的 Skill 校验分支需要新增严格 YAML frontmatter 身份解析，并保持对已发布的、带 `package.json` 的存量 Skill 兼容。
