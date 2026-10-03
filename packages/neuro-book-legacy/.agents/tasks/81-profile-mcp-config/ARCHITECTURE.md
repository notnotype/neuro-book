# Profile MCP Config Architecture

本文从性能、用户体验、加载逻辑、Harness 复杂度、开发人员心智、安全边界和失败恢复几个角度，分析 profile 级 MCP 支持的架构选择。

## Core Tension

Profile 当前是“编译后稳定能力声明”：profile 源码声明 root tools，编译产物是运行真相源。MCP 则是“运行时外部能力发现”：tool schema 来自外部 server，server 可能慢、坏、变化或需要 secret。

如果把 MCP 当成 profile 源码 helper，profile 编译系统会被外部进程、网络、secret 和动态 schema 拖进来，破坏 Task 79 刚收口的严格产物模型。更稳的心智是：

- Profile source：声明内置工具、inline 工具和长期 prompt 合同。
- Config：声明外部 MCP server 和 profile 对 MCP tools 的使用策略。
- Run tool snapshot：单次 run 的冻结工具真相源，合并 profile 静态 tools 与配置动态 MCP tools。

## Architecture Options

| Option | Summary | Performance | User Control | Loading Logic | Harness Impact | Developer Mental Model | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A. Profile helper loads MCP | profile 源码里调用 `loadMcp()`，返回工具 binding | 编译/prepare 可能被外部服务拖慢 | profile 作者控制强，但普通用户难配置 | profile 编译、运行、MCP 生命周期混在一起 | 看似局部，实际侵入 catalog / compiler / harness | “profile 是代码还是配置”变模糊 | Reject for V1 |
| B. Global MCP registry + profile allowlist | Workspace Root 注册 server，profile config 显式选择 tools | 可缓存、可懒加载，run 只解析 allowlist | 用户在设置页可见可控 | server 发现与 run 工具冻结分层 | 需要新增 run tool resolver，但边界清楚 | profile / config / runtime 三层清楚 | Recommended |
| C. Runtime global MCP tools | MCP tools 全注册进 AgentToolRegistry，profile 用 `pluginTool()` 或 key 引用 | 启动或设置页容易被全部 server 拖慢 | profile 仍要知道 tool key，不够用户友好 | 全局 registry 变成动态外部状态 | registry 变复杂，权限容易散 | 动态工具像内置工具，来源不清 | Reject for V1 |
| D. Settings-only terminating proxy tool | 每个 profile 只多一个 `call_mcp` 工具，参数里传 server/tool | schema 小，加载快 | 用户能开关 server，但模型看不到每个 tool schema | 加载简单，但执行时才发现参数错 | Harness 改动小 | 模型失去工具级 affordance，退化成手写 RPC | Possible fallback only |

推荐 Option B。它的核心收益是把“外部 MCP 能力”作为 config/resource 管理，同时保留 Agent run 的工具快照纪律。

## Performance Analysis

MCP 会引入三类性能风险：

- Settings 页面被 MCP discovery 拖慢。
- Agent `prepareRun()` 被冷启动 server 或网络 discovery 拖慢。
- 每次 turn 重新构造 tool schema 时重复解析大量动态工具。

推荐策略：

1. Settings 页面只在用户展开 MCP 区块或点击刷新时发现 tools，不在打开设置页时启动所有 MCP server。
2. MCP discovery 结果放入 runtime catalog cache；可选持久化非 secret tool catalog，供重启后快速展示和 run 冷启动兜底。
3. `prepareRun()` 使用“last known good catalog + 短 timeout refresh”策略：
   - 有新鲜 catalog：直接构造 run tool snapshot。
   - catalog 缺失：尝试受限时间 discovery。
   - discovery 失败：本次 run 不暴露该 server 的 MCP tools，并把 server 状态记录到日志/设置页状态；不要让整个 profile 不可运行。
4. 单次 run 内冻结 `visibleToolKeys`、`executionToolKeys` 和 dynamic `toolOverrides`，不要每个 turn 重读 MCP server。
5. 如果一个 profile 选择了大量 MCP tools，应在设置页提示 tool count 和上下文成本；MCP tool schema 也会占 provider context。

性能结论：MCP 不应进入 app boot 热路径，不应进入 profile compile 热路径，`prepareRun()` 可以承担一次轻量解析，但必须有缓存和超时。

## User Experience Analysis

用户心智应是：

- “我在全局注册可用 MCP 服务。”
- “我在某个 profile 上选择这个 profile 可以用哪些 MCP 工具。”
- “项目可以覆盖选择，但不能偷偷新增会执行命令的 server。”

UI 推荐分三层：

1. Global MCP Servers
   - 添加 / 禁用 server。
   - 配置 transport、命令、URL、secret。
   - 刷新 tools。
   - 查看健康状态和错误。

2. Profile MCP Tools
   - 在 Agent Profile 设置卡片中显示 MCP 区块。
   - 按 server 分组列出 tool。
   - 默认全不选。
   - 支持搜索、全不选、单个 tool 勾选。
   - 显示工具描述、参数摘要、危险提示、是否需要确认。

3. Project Override
   - 只允许在已注册 server 的 tools 中覆盖 allowlist。
   - 显示继承来源：系统默认 / Global / Project。
   - 不提供 server command / env / URL 编辑入口。

用户可见状态需要直白：

- `未启用 MCP`
- `已启用 3 个 MCP 工具`
- `server 不可用，上次可用工具仍可选择但本次 run 可能不可用`
- `Project 只覆盖 tool 选择，server 配置来自 Global`

用户体验结论：MCP 不应要求普通用户编辑 profile 源码；选择粒度应是 tool allowlist，不是“信任整个 server”。

## Loading Logic

推荐加载顺序：

1. Config normalizer 读取：
   - `agent.mcp.servers`
   - `agent.profiles[profileKey].mcp`

2. Effective config 合并：
   - Global 定义 server。
   - Project 第一版不能定义 server。
   - Profile MCP config 按 Global / Project 合并。

3. MCP catalog resolver：
   - 根据 enabled server 和 profile tool allowlist 读取 tool catalog。
   - tool catalog 只包含非 secret metadata：serverId、toolName、description、inputSchema、lastDiscoveredAt、status。
   - catalog cache 应按 serverId 分锁，避免同一 server 并发重复启动。

4. Run tool snapshot resolver：
   - 输入：profile、effective config、MCP catalog。
   - 输出：`visibleToolKeys`、`executionToolKeys`、`dynamicToolOverrides`、`userResolutionToolKeys`。

5. Harness 使用 frozen snapshot：
   - provider-visible tools 来自 `visibleToolKeys + dynamicToolOverrides`。
   - execution permission 来自 `executionToolKeys`。
   - active run 不跟随配置变更。

加载失败策略：

- server 未配置：该 server 下 tools 不暴露。
- discovery 超时：使用未过期的 last known good catalog；没有 catalog 就不暴露。
- schema 转换失败：只跳过该 tool，记录 per-tool issue。
- 执行时 tool 不存在或 server 断开：返回普通 tool error，不让 run 崩掉。

## Harness Complexity

当前 Harness 里与工具相关的关键点：

- `prepareRun()` 生成 `toolKeys` / `executionToolKeys`。
- `prepareTurn` 允许 runtime hook 裁剪 `toolKeys`，但不能突破 root tools。
- `toolOverrides()` 根据 profile binding 生成 provider-visible schema override。
- `executeTool()` 使用 `executionToolKeys` 做硬权限检查。
- pending approval / user input 恢复依赖可识别哪些 tool 会等待用户。

如果直接在这些点分别补 MCP，会很快扩散。推荐新增一个内部对象：

```ts
type RunToolSnapshot = {
    visibleToolKeys: string[];
    executionToolKeys: string[];
    dynamicToolOverrides: Record<string, NeuroAgentTool>;
    userResolutionToolKeys: string[];
};
```

并新增一个 resolver：

```ts
resolveRunToolSnapshot({
    profile,
    effectiveConfig,
    workspaceRoot,
    projectPath,
}): Promise<RunToolSnapshot>
```

Harness 只消费结果：

- `prepareRun()` 不再自己拼最终 tools，只调用 resolver。
- `prepareTurn` 的 `toolKeysPatch` 仍只能裁剪 `visibleToolKeys`。
- `toolOverrides()` 可拆成两层：
  - profile static overrides：report_result、inline tool、binding override。
  - dynamic overrides：MCP runtime tools。
- `executeTool()` 保持用 `executionToolKeys` 判断权限。

待特别设计的复杂点：

- Sidecar：V1 可声明不继承 MCP，避免 sidecar 默认获得主 run 外部工具。
- Pending approval resume：如果 MCP tool 等待确认后配置被禁用，仍应能展示 pending 状态；执行时若 server 不可用，返回 deterministic tool error。
- Runtime hook `toolKeysPatch`：只能裁剪当前 run snapshot，不能新增 MCP tool。

Harness 复杂度结论：MCP 不应直接塞进 `AgentToolRegistry` 全局 map，也不应散落在 `prepareRun` / `prepareTurn` / `executeTool`。一个 run tool snapshot resolver 是必要抽象。

## Developer Mental Model

推荐给开发者的三句话：

1. Profile source 决定这个 profile 天生拥有哪些内置/inline 能力。
2. Config 决定这个 profile 在这个 workspace/project 中额外允许哪些外部 MCP 能力。
3. Run tool snapshot 是一次 invocation 的工具真相源，模型可见和执行权限都从这里来。

不要出现这些双真相源：

- profile 源码里既 `loadMcp()`，设置页又能开关同一个 MCP server。
- `AgentToolRegistry` 里动态注册了 MCP tools，profile config 又有自己的 allowlist。
- provider-visible tools 和 execution permission 分别用两套 MCP 解析逻辑。
- Project Config 能引入新的 server command，导致打开别人项目后获得新执行能力。

建议命名：

- `McpServerRegistry`：保存/读取 server config，不负责执行。
- `McpClientManager`：按 serverId 管理连接、启动、停止、复用。
- `McpToolCatalog`：发现并缓存 tool metadata。
- `McpToolAdapter`：把 MCP tool 转成 `NeuroAgentTool`。
- `RunToolSnapshotResolver`：合并 profile static tools 与 MCP dynamic tools。

开发人员心智结论：不要把 MCP 当成 profile DSL 的一部分；把它当成运行时可配置外部 capability。

## Security And Permission

第一版安全默认值：

- MCP server 默认 disabled。
- Profile MCP 默认 disabled。
- Tools 默认全不选。
- `requireApproval` 默认 true。
- Project Config 不能新增 server transport。
- secret 在 GET 响应中必须脱敏。
- stdio server 的 `cwd` 和 env 需要明确显示来源，不使用隐式项目路径。

权限粒度：

- Server enabled 只表示允许 discovery / execution。
- Profile tool allowlist 才表示模型可见。
- `executionToolKeys` 才是执行硬权限。
- User approval 决定危险动作是否暂停等待用户确认。

后续可扩展：

```ts
type McpToolPermission = {
    requireApproval?: boolean;
    risk?: "low" | "medium" | "high";
    tags?: string[];
};
```

但 V1 不建议先做复杂 policy DSL，避免过早设计。

## Failure Modes

| Failure | User-visible behavior | Runtime behavior |
| --- | --- | --- |
| server command 不存在 | 设置页显示 server unavailable | run 不暴露该 server tools |
| discovery timeout | 显示刷新失败，可用 last known catalog | 有缓存用缓存，无缓存跳过 |
| schema 不支持 | 该 tool 显示 schema issue | 跳过该 tool |
| tool 执行时 server 掉线 | 工具卡片返回错误 | run 继续，让模型处理错误 |
| Project 禁用了某 tool | Project 区块显示覆盖 | 下一次 run 不暴露该 tool |
| 等待 approval 时配置被改 | pending 仍应可见 | approval 后若 tool 不可执行，返回确定错误 |

## Recommended Phasing

### Phase 0: Contract And DTO

- 增加 server/profile MCP config 类型和 DTO。
- 明确 Global / Project 可写字段。
- 不接执行，只能保存配置和展示状态。

### Phase 1: Discovery And Catalog

- 实现 MCP client manager。
- 支持手动 refresh tools。
- 设置页展示 server 状态和 tool catalog。
- 不自动启动全部 server。

### Phase 2: Run Tool Snapshot

- 实现 `RunToolSnapshotResolver`。
- 合并 profile static tools 与 MCP dynamic tools。
- 将 dynamic tool overrides 注入 provider-visible tools。
- execution permission 使用同一份 snapshot。

### Phase 3: Approval And Recovery

- MCP tools 默认 approval。
- pending approval resume 覆盖 MCP tool。
- server 不可用、schema 变化、配置变化都有确定错误。

### Phase 4: UX Hardening

- 工具搜索、分组、风险提示。
- last discovered timestamp。
- tool count / context cost 提示。
- Project override 继承视图。

## Open Questions

- MCP tool catalog 是否持久化到 config，还是单独写 Workspace Root `.nbook` 下的 runtime cache？
- stdio MCP server 是否允许引用 bun / node / workspace node，还是第一版只接受显式 absolute command？
- HTTP MCP headers 是否需要独立 secret 字段脱敏，还是先要求用户放到 global config secret map？
- 是否允许 profile 默认声明推荐 MCP tools，但仍由用户在设置页启用？
- Sidecar 是否需要独立 MCP allowlist，还是 V1 一律不继承？

## Recommendation

第一版采用 Option B，并把实现中心放在 `RunToolSnapshotResolver`。这能同时满足：

- 性能：MCP 不进入 boot / compile 热路径。
- 用户：设置页配置，不要求改 profile 源码。
- 加载：server registry、tool catalog、run snapshot 三层分清。
- Harness：只新增一个合并点，避免四处散补。
- 开发人员：profile source、config、run snapshot 各有单一责任。

最关键的设计约束是：**模型可见工具集合和执行硬权限必须来自同一份 run tool snapshot**。只要这个约束守住，MCP 后续扩展到更多 transport、更多权限策略、sidecar 或 plugin 化时，都不会把 profile 系统重新拖回双真相源。
