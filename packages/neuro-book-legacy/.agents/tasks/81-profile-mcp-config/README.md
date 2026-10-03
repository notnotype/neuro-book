# Profile MCP Config

> Active task. 第一阶段目标是先定下 profile 级 MCP 配置和运行时接入边界，不急于实现 profile helper 或大改工具类型。

## Relative documents refs

- [reference/agent/profile-guide.md](../../../reference/agent/profile-guide.md) - profile DSL、`tools` 绑定、`defineProfileTool()` inline 工具合同。
- [reference/agent/runtime-hooks.md](../../../reference/agent/runtime-hooks.md) - RunFrame / TurnSnapshot / runtime hook 的冻结快照心智。
- [reference/agent/profile-compiled-artifacts.md](../../../reference/agent/profile-compiled-artifacts.md) - profile 编译产物作为运行真相源的边界。
- [docs/tasks/47-agent-profile-tool-bindings/README.md](../47-agent-profile-tool-bindings/README.md) - profile 工具绑定历史任务。
- [docs/tasks/48-agent-tool-definition-layer/README.md](../48-agent-tool-definition-layer/README.md) - `AgentToolDefinition` / inline execute 工具层。
- [docs/tasks/58-agent-profile-settings-low-code/README.md](../58-agent-profile-settings-low-code/README.md) - profile settings 与设置页心智。
- [docs/tasks/79-profile-build-system/README.md](../79-profile-build-system/README.md) - profile 编译和运行时加载的严格状态机。
- [ARCHITECTURE.md](ARCHITECTURE.md) - 从性能、用户体验、加载逻辑、Harness 复杂度、开发者心智、安全和失败恢复分析 MCP 架构。

## User Request / Topic

- 给 Agent profile 增加 MCP 功能支持。
- 用户初始想法：
  - 提供 helper 加载 MCP 服务，把 MCP tools 转成 NeuroBook 工具后像普通工具一样配置给 profile。
  - profile 设置页像默认模型、TopK、推理强度、流式一样配置 MCP。
- 进一步讨论后确认：
  - profile 已支持 inline 定义工具逻辑，即可在 profile 代码中用 `defineProfileTool()` 写 `execute` / `executeWithContext`。
  - 第一版不要做 profile helper 加载 MCP。
  - 第一版优先做 `ProfileMcpConfig` 这类配置能力，并细化运行时和前端边界。

## Goal

设计并实现 profile 级 MCP 配置能力，verified by：

- Global Config 可注册 MCP server，profile 可配置显式 MCP tool allowlist。
- Project Config 可覆盖 profile 对 MCP tools 的选择，但第一版不允许 Project Config 新增 MCP server 启动配置。
- Agent run 的模型可见工具集合和执行硬权限集合都包含同一份经过 profile MCP 配置允许的 MCP tools。
- 配置变更只影响下一次 run，active run 使用冻结工具快照。
- MCP 工具能通过统一 `NeuroAgentTool` 执行，并保留可读日志、错误和审批信息。

必须保持：

- 不破坏现有 profile `.compiled` 内容寻址产物与严格无 stale 规则。
- 不要求 profile 作者在 profile 源码里启动 MCP server。
- 不把 MCP server 生命周期塞进 profile `settingsForm`。
- 不自动启用某个 MCP server 暴露的全部 tools。
- 默认安全策略偏保守，MCP tools 默认需要用户确认或至少具备可扩展的审批策略。

若 MCP 协议客户端、schema 转换或 server 生命周期无法稳定落地，应先停止在设计/原型阶段，报告阻塞点、风险和可选实现路径，不要用 ad hoc shell wrapper 伪装 MCP。

## Current State

- profile 工具模型已经支持三种来源：
  - 内置全局工具绑定，例如 `builtin.file.read`。
  - profile 自带 inline 工具：`defineProfileTool({... execute / executeWithContext ...})`。
  - 未 typed 化的 runtime 插件工具：`pluginTool("tool_key")`。
- `ToolBinding` 已有 `definition?: AgentToolDefinition`，`AgentToolDefinitionInput` 已支持 `execute` 和 `executeWithContext`，因此“不需要为了 inline execute 升级工具类型”。
- Harness 当前在 `prepareRun()` 中直接从 profile 静态声明推导：
  - `toolKeys = [...runProfile.rootToolKeys]`
  - `executionToolKeys = runProfile.toolKeys ? [...runProfile.toolKeys] : undefined`
- `AgentToolRegistry` 已区分：
  - `toolKeys`：模型可见工具集合。
  - `executionToolKeys`：执行硬权限集合。
- Config 当前已有 `agent.profiles[profileKey]`，里面保存 `model` 和 `settings`，并支持 Global / Project 合并。
- 设置页已经有 Agent Profile 模型参数与 profile 低代码 settings 区块，适合继续承载 profile 级 MCP 选择。

## Decisions / Discussion

- 第一版采用配置优先：`ProfileMcpConfig` 是上层使用方式，MCP loader / adapter 是运行时内部能力。
- 不在第一版提供 `mcpTool()`、`loadMcp()` 或类似 profile helper。
- 不让 profile 源码直接拥有 MCP server 启动配置；profile 只表达“允许哪些 MCP tools”。
- MCP server 注册表归属于 Workspace Root 级配置，profile 配置只引用 tool allowlist。
- Project Config 第一版只允许覆盖 profile 的 MCP tool 选择，不允许新增或覆盖 server command / env / URL。
- MCP tool ID 内部稳定形态建议：

```text
mcp:<serverId>:<toolName>
```

- provider-visible tool key 应使用模型友好的安全形态：

```text
mcp__<serverSlug>__<toolSlug>
```

- 第一版工具 allowlist 只保存明确选择的 `toolIds`，不要支持“启用整个 server 的所有工具”。MCP server 后续新增工具不应自动暴露给 profile。
- 核心工具执行类型不需要升级；可以考虑给 runtime tool 增加只读 metadata：

```ts
origin?: {
    kind: "builtin" | "profile" | "mcp";
    serverId?: string;
    toolId?: string;
}
```

- sidecar 第一版可以明确不继承 MCP；如果需要，再设计 `sidecar.mcpToolIds` 或让 sidecar 显式继承主 run 的动态工具集合。
- 多角度架构分析见 [ARCHITECTURE.md](ARCHITECTURE.md)。当前推荐 Option B：Workspace Root MCP server registry + profile explicit tool allowlist + run tool snapshot resolver。

## Architecture Summary

核心分层：

1. Profile source：声明 profile 天生拥有的内置/inline 能力。
2. Config：声明外部 MCP server 与 profile 对 MCP tools 的使用策略。
3. Run tool snapshot：单次 invocation 的工具真相源，合并 profile 静态 tools 与 MCP 动态 tools。

推荐不要采用：

- profile helper 直接加载 MCP，因为会把动态外部服务拖进 profile 编译/加载心智。
- 全局动态注册所有 MCP tools，因为权限和来源会变得不清楚。
- 单个 `call_mcp` 代理工具作为主方案，因为模型看不到具体 tool schema，容易退化成手写 RPC。

推荐采用：

- `agent.mcp.servers` 保存 Workspace Root 级 MCP server registry。
- `agent.profiles[profileKey].mcp` 保存 profile 级 tool allowlist。
- `RunToolSnapshotResolver` 在 `prepareRun()` 合并静态 profile tools 与动态 MCP tools。
- provider-visible tools 与 execution permission 都来自同一份 frozen run tool snapshot。

分期建议：

1. DTO / Config：先保存 server registry 与 profile MCP config。
2. Discovery / Catalog：手动刷新 tools，设置页展示状态，不自动启动全部 server。
3. Run Tool Snapshot：接入 Harness 工具快照和 MCP adapter。
4. Approval / Recovery：默认审批、pending resume、server/schema 失败的确定错误。
5. UX Hardening：搜索、分组、风险提示、tool count/context cost 提示。

## Proposed Config Shape

第一版建议的存储形态：

```ts
type StoredMcpServerConfig = {
    id: string;
    name?: string;
    enabled?: boolean;
    transport:
        | {
            type: "stdio";
            command: string;
            args?: string[];
            env?: Record<string, string>;
            cwd?: string;
        }
        | {
            type: "http";
            url: string;
            headers?: Record<string, string>;
        };
};

type StoredAgentProfileMcpConfig = {
    enabled?: boolean;
    toolIds?: string[];
    requireApproval?: boolean;
};
```

建议落在：

```ts
agent: {
    mcp: {
        servers: Record<string, StoredMcpServerConfig>;
    };
    profiles: {
        [profileKey: string]: {
            model: ...;
            settings?: ...;
            mcp?: StoredAgentProfileMcpConfig;
        };
    };
}
```

合并语义建议：

```ts
effectiveProfileMcp = {
    enabled: project.enabled ?? global.enabled ?? false,
    toolIds: project.toolIds ?? global.toolIds ?? [],
    requireApproval: project.requireApproval ?? global.requireApproval ?? true,
};
```

## Runtime Design Sketch

在 `prepareRun()` 中，不直接把 profile 静态 root tools 作为最终工具集合，而是通过运行时 resolver 得到冻结快照：

```ts
type ResolvedRunTools = {
    visibleToolKeys: string[];
    executionToolKeys: string[];
    overrides: Record<string, NeuroAgentTool>;
    userResolutionToolKeys: string[];
};
```

Resolver 负责：

1. 读取当前 effective config。
2. 根据 `profileKey` 解析 profile MCP config。
3. 懒加载对应 MCP server，执行工具发现。
4. 把 allowlist 中的 MCP tools 转成 `NeuroAgentTool`。
5. 合并 profile 静态 tools 与 MCP 动态 tools。
6. 同时写入模型可见工具集合和执行硬权限集合。
7. 将工具快照冻结到本次 run；配置变更只影响下一次 run。

## Frontend Design Sketch

- 设置页在 Agent Profile 参数区附近增加 MCP 区块。
- Global scope：
  - 可以管理 MCP server 注册表。
  - 可以给每个 profile 选择 MCP tools。
- Project scope：
  - 只显示已注册 server / discovered tools。
  - 允许覆盖 profile tool allowlist。
  - 不提供新增 server command / env / URL 的入口。
- MCP tool discovery 应懒加载，避免打开设置页就启动所有外部服务。
- UI 需要显示 server 健康状态、工具数量、上次发现时间、错误信息。

## Verification / Test

- Config normalizer / DTO：
  - Global MCP server 注册可保存、读取、脱敏必要 secret。
  - Project Config 不能新增 server transport。
  - Global / Project profile MCP 合并符合预期。
- Runtime：
  - profile 未启用 MCP 时，工具集合与当前行为一致。
  - profile 启用 MCP allowlist 后，模型可见工具和执行硬权限都包含对应 MCP tools。
  - allowlist 外 MCP tool 调用被拒绝。
  - active run 使用冻结工具快照，运行中改配置不影响当前请求。
- Tool adapter：
  - MCP input schema 能转换为 provider-visible TypeBox/JSON schema。
  - MCP 调用错误能返回可读 tool result。
  - `requireApproval` 能进入 pending approval / user resolution 链路。
- Frontend：
  - Global 设置可选择 MCP tools。
  - Project 设置可覆盖 profile allowlist。
  - MCP server 异常时设置页展示状态，不阻塞其它 profile 设置。

## Implementation Walkthrough

- Initial design discussion：确认 profile 已支持 inline execute，因此第一版不升级核心工具执行类型；MCP 先走 profile config + runtime adapter。
- Architecture round：补充 [ARCHITECTURE.md](ARCHITECTURE.md)，从性能、用户、加载逻辑、Harness 复杂度、开发人员心智、安全和失败恢复角度比较方案，推荐 `RunToolSnapshotResolver` 作为第一版实现中心。

## TODO / Follow-ups

- [ ] 设计 `agent.mcp.servers` DTO、normalizer、脱敏和 Global Config 写回。
- [ ] 设计 `agent.profiles[profileKey].mcp` DTO、normalizer 与 Global / Project 合并。
- [ ] 设计 MCP client manager 生命周期、缓存、健康状态和懒加载策略。
- [ ] 设计 MCP tool schema 到 `NeuroAgentTool` 的 adapter。
- [ ] 修改 harness 工具解析，使 profile 静态 tools 与 MCP 动态 tools 进入同一个冻结 run tool snapshot。
- [ ] 设计 MCP tools 的审批策略，默认保守。
- [ ] 设计设置页 MCP 区块和 Project 覆盖交互。
- [ ] 决定 sidecar 第一版是否完全不继承 MCP，并写入测试。
