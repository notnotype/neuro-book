# 13 扩展控制面重构：联邦 Catalog 之上的描述快照

> 本章是研究建议，不是产品 Spec、Proposal 或 ADR。`docs/specs/README.md` 当前“待实现规范”为空；`extension-control-plane` 不是已登记的 `planned` capability。
> 证据状态：**已验证当前实现** = 当前代码与已读测试直接确认；**已批准但未实施的目标合同** = Reference/Task 明确描述但产品代码尚无实现；**研究建议** = 本章提出的控制面映射；**未验证/候选** = 没有足够源码、测试或真实运行证据。

## 结论先行

NeuroBook 当前没有统一 Extension Description Registry、统一 contribution API 或通用 activation state machine。它已经有多个各自成立的 Catalog/Registry：Profile 最接近“描述快照 + 编译发布”，Skill 是目录扫描与整包遮蔽，Workflow 是三层目录覆盖与受限求值，Tool 是进程内 schema/execute 分离，Job 是跨重启 durable 执行记录。

研究建议不是把这些领域改名为一个 `Plugin` 类，而是增加一个**只读联邦描述快照**的观察层：

```text
Profile / Skill / Workflow / Tool / first-party View / Command
  → 各自 owner 负责加载、覆盖、编译、错误和持久化
  → Host federation 只索引 identity/source/capability/status/issue
  → Workbench/Command/Agent 读取当前快照
  → 具体执行仍回到原领域 authority
```

这个层不拥有安装、编译、Job、Session、Project 文件、secret 或 Provider side effect。它的存在目的是让宿主可以回答“提供了什么、来自哪里、当前是否可用、为什么不可用”，而不是让一个总注册表接管所有生命周期。

## 1. 当前联邦证据

### 1.1 各领域真相源和边界

| 领域 | 已验证当前实现 | 覆盖/版本/issue | 运行边界 | 不能合并成什么 |
| --- | --- | --- | --- | --- |
| Profile | `../../../server/agent/profiles/catalog.ts::AgentProfileCatalog` 读取 system/user 源、compiled manifest、artifact；`../../../server/agent/profiles/profile-registry.ts::ProfileRegistry.publish` 只在进程内翻转 catalog 并递增 epoch | Profile snapshot 有 item/source/builtin/loadStatus/issue；`catalogGeneration`、`memoryRevision`、`ProfileRegistry.epoch` 不是同一计数 | Runtime 只加载 compiled artifact；build coordinator 的 running/queued 会使 profile 不可运行 | 通用 Extension Registry 或第三方沙箱 |
| Skill | `../../../server/agent/skills/skill-catalog.ts::SkillCatalog` 每次扫描 system/user 两层；目录名是当前稳定 key | 用户同名目录整体遮蔽 system；无效 user 包占用 key 并隔离，不静默回退；当前无统一 issue/epoch/snapshot | 正文按需由 Agent `read` 使用；没有可恢复的运行时实例 | Profile 的 compiled release 模型 |
| Workflow | `../../../server/agent/workflow/workflow-catalog.ts::WorkflowCatalog` 扫描 system/user/project，目录名覆盖文件内 key | system→user→project；system/user 有 mtime cache，project 不跨 Project generation 复用；单条加载失败 warn 跳过 | `transpileModule → CommonJS → new Function`，无 `require/fs/process` 注入；`run_workflow` 经 approval 并可创建 Job | 安全沙箱或第三方任意代码执行宿主 |
| Tool | `../../../server/agent/tools/tool-registry.ts::AgentToolRegistry` 进程内 key→`NeuroAgentTool` | 后注册同 key 覆盖；`allowed()`/`allowedWithOverrides()` 只产生 Provider schema；无 durable snapshot/epoch | execute 函数保留在 Harness；`executionToolKeys`、approval、user input、`mutatesWorkspace` 由调用上下文守门 | “模型看见 schema 就能执行”或远程插件 API |
| Job | `../../../server/agent/jobs/agent-job-manager.ts::AgentJobManager` 管内存 live record 和 durable store | Job status 与 deliveryStatus 独立；事件有 `eventEpoch/seq`，不是 Catalog epoch | `<Workspace Root>/.nbook/agent/jobs/<jobId>.json` 是 durable truth；running/waiting 重启转 interrupted，不自动重放 run | Extension activation 状态或 Provider 幂等合同 |
| Runtime roots | `../../../server/runtime/paths/runtime-paths.ts::createRuntimePaths` 冻结 application/state/cache/workspace/secrets 等根 | 根集合不是 extension description；`secretsRoot` 不进入普通 snapshot | 宿主决定物理边界；模块不得从 cwd/环境自行猜 root | 插件自带任意路径权限 |

### 1.2 Profile 为什么只是相似先例

`ProfileRegistry.publish(catalog)` 的实现只做内存替换和 `epoch += 1`；它不读盘、不 import、不持久化，也不负责激活事件。`AgentProfileCatalog` 的 snapshot/loadStatus/issue 和 `.compiled/manifest.json` 发布链确实可以作为“描述先登记、运行时再解析”的证据，但它只适用于 Profile artifact。

三个容易被误读的版本字段必须保留不同名字：

- `catalogGeneration`：Profile catalog invalidate 后的加载代次；
- `memoryRevision`：内存 builtin/profile 注册变更代次；
- `ProfileRegistry.epoch`：已构建内存 catalog 发布次数。

事件流的 `eventEpoch`、Project Session 的 `ready.revision`、Agent Surface 的 operation revision 也各有 owner。研究快照若需要版本，必须带领域和来源，不能把所有数字投影成一个无类型 `epoch`。

## 2. 安装身份、描述、贡献和运行实例分离

### 2.1 四个对象不是一件事

```text
安装包 identity
  = 来源、包 id、版本/内容指纹、安装状态（候选）

Extension description
  = 宿主可发现的资产描述（研究建议）

Contribution description
  = View/Command/Setting/Tool 等宿主入口声明（研究建议）

Runtime instance
  = 当前进程中的 Profile/Workflow/Tool/View/Job 执行对象（按领域实现）
```

`reference/agent/agent-asset-install.md` 描述的 Seed Root、Install Root、Project Root、`agent/installed.json` 和 provenance ledger 属于**已批准但未实施的目标合同**。Task 135 的 Verification 明确写出协议尚未实施、没有行为证据；产品代码中没有已验证的 `installed.json` 读写、Install Root installer 或 provenance ledger。

当前实现仍由 Harness 装配 system/user roots；`resolveSystemNbookRoot` 指向随应用发布的 `assets/workspace/.nbook`，当前 system root 直接参与 Catalog 加载。这与目标协议“Seed Root 不是 catalog 层、Install Root 才是安装落点”存在已记录的迁移缺口。不能在本章把目标合同写成当前安装行为。

### 2.2 联邦快照只读投影

研究建议的联邦描述快照最小字段是：

| 字段 | 含义 | owner |
| --- | --- | --- |
| `id`/`kind` | 稳定寻址和领域类型，例如 Profile/Skill/Workflow/Tool/View/Command | 各领域 Catalog 或宿主 View/Command registry |
| `source` | system/user/project/builtin/first-party 等来源标签 | 各领域 owner；不由联邦层猜测 |
| `capabilities` | 可发现能力标签，例如 image-input、view、command、workflow | 描述生产者；联邦层只索引 |
| `loadStatus`/`issue` | 当前描述是否可使用以及结构化诊断 | Profile 直接提供；其他领域需先定义映射，当前未统一 |
| `schemaReference` | 参数/设置/工具 schema 的引用或摘要 | 具体 schema owner |
| `snapshotVersion` | 当前联邦读视图版本 | 联邦 snapshot owner；不能替代业务 generation |
| `runtimeLocation` | 预期运行域：browser UI、server、Job、Project authority 等 | 宿主声明；不是权限凭证 |

联邦层必须保留“没有该字段”的事实：Skill/Workflow/Tool 当前并没有 Profile 同等的 issue/epoch/snapshot；不能为了表格整齐而伪造 `active`、`loadStatus` 或安装版本。

## 3. 激活、可见性、Job 和资产状态分离

### 3.1 当前与候选状态

当前只有部分领域有加载状态：Profile 有 `loaded`、`compiling`、`compile_failed`、`not_compiled`、`compile_stale`、`compiled_load_failed`、`source_error` 等 load status；Skill/Workflow/Tool 没有统一 activation state。以下是**研究建议**，不是当前状态机：

```text
described
  → eligible
  → activating
  → active
  → failed | stale | disabled
```

这些维度必须分开：

```text
安装状态      ≠ 描述快照状态
描述可用      ≠ View visible
View visible  ≠ runtime active
runtime active≠ Job running
Job completed ≠ Provider side effect committed
asset committed≠正文引用 committed
```

例如图片 View 可以已经 described、eligible、visible，但用户尚未发起图生文 command；图片输入结果可以已经成为 Session message，但没有 Project asset commit；未来文生图 Job 可以 completed，而 Provider outcome 或资产 commit 仍是 unknown。统一 `active` 会丢失这些边界。

### 3.2 惰性激活研究边界

第一阶段只研究第一方宿主入口的惰性创建：命令或 View 第一次需要时，宿主解析当前 descriptor，检查 Project/Session/Tool/Attachment authority，然后创建或调用现有领域对象。激活失败必须：

1. 保留原 descriptor；
2. 产生带 `id/source/phase/cause` 的结构化 issue；
3. 使本次 command/View 结果明确失败；
4. 不回退到同名低优先级资产；
5. 不改变已经 durable 的 Job/Session/Project 事实。

Profile 的 artifact load failure、Skill 的 user package 隔离、Workflow 的单条 warn 跳过和 Job 的 durable recovery 是不同失败合同，只能作为比较材料，不能未经 Proposal 统一。

## 4. 权限、运行位置和安全边界

### 4.1 四层能力分离

现有 Tool Registry 已经把 Provider 可见 schema 与执行函数分开：

```text
Provider-visible parameters
  ≠ AgentToolRegistry execution function
  ≠ executionToolKeys
  ≠ approval/userInput resolution
  ≠ Session/Project/Attachment authority
  ≠ secret/network/process capability
```

`AgentToolRegistry.allowed()` 返回不含 Harness execute 的 `{name, description, parameters}`；真正执行还要经过 `executionToolKeys`、tool validation、approval/user resolution 和只读模式的 workspace mutation gate。联邦描述层只能展示这些关系，不能提升任何一层权限。

`RuntimePaths.secretsRoot`、Project root、Session JSONL、History SQLite 和 Job JSON 都必须由宿主 authority 访问。View descriptor 或 extension description 不得携带 raw root、secret、数据库句柄或任意 HTTP client。

### 4.2 “受限求值”不是安全沙箱

Workflow 的 `new Function` 壳没有注入 `require`、`process` 或 `fs`，这是当前 V1 的受限执行边界；Profile artifact 在进程内加载；Skill 可以包含 runnable 资产和依赖缓存。它们都不能证明恶意第三方代码安全隔离。

同样，VS Code Extension Host 是进程/Worker 故障隔离和 API/RPC 边界，不是 NeuroBook 的安全结论。Web Worker、iframe、Node process 或未来 Extension Host 都不能在没有 threat model、能力白名单、文件/网络 containment、资源配额、取消强制、来源完整性、升级/撤销和 hostile fixture 的情况下开放第三方默认执行。

## 5. 动态变化与恢复

### 5.1 描述变化

研究建议的变化顺序是：

```text
领域 authority 更新/发布
  → 领域自身校验与持久化完成
  → 联邦描述快照重建
  → Workbench/Command 读取新快照
  → 旧运行实例按领域规则结束或标 stale
```

联邦层不能先删除旧描述再等待领域写入；也不能在高优先级资产损坏时静默换低优先级资产。每个领域的损坏、覆盖和删除处理保持原语义：Profile 依靠 issue/loadStatus，Skill 依靠 declared key 遮蔽，Workflow 按条目 warn 跳过，Tool 缺 key 在 allowed projection 中过滤但执行期仍由调用方校验。

### 5.2 宿主重启

宿主重启时：

- 联邦描述快照从各领域当前 authority 重建；不恢复内存 View/Tool/Workflow runtime instance；
- Profile 重新读取 compiled manifest/artifact，不能把 `ProfileRegistry.epoch` 当作跨重启 durable version；
- Job 从 `<Workspace Root>/.nbook/agent/jobs/<jobId>.json` 恢复，running/waiting 变为 interrupted；
- terminal Job 的 pending delivery 依据稳定 deliveryId/clientMessageId 重投；
- activation 不得因为重建 description 而自动重放未知 Provider side effect；
- Session Attachment 仍由 JSONL ownership authority 校验，Provider image hydration 需要新的调用上下文。

## 6. 失败与恢复矩阵

| 场景 | 当前证据 | 研究建议的联邦可观察结果 | 禁止行为 |
| --- | --- | --- | --- |
| 重复 id | Tool 后注册覆盖；Catalog 各自有覆盖语义；View Registry 不存在 | 联邦发布前按 `(kind,id,source)` 检查，冲突产生 issue；不改变领域原有覆盖合同 | 统一层按数组顺序静默覆盖所有领域 |
| 高优先级同名资产损坏 | Skill user key 会遮蔽 system；Profile 有 issue/loadStatus；Workflow 单条 warn | 快照保留损坏条目的来源和 issue；是否可见/可运行由领域合同决定 | 自动回退低优先级资产而不告知 |
| stale description | Profile 有 catalog/source/artifact freshness 检查；其他领域未统一 | snapshot 带来源版本/刷新原因；消费方看到 stale 而非假装 active | 把旧描述当最新执行入口 |
| activation 失败 | 没有通用 activation state；Profile load failure 可见 | descriptor 保留，activation issue 可查询；本次调用失败 | 激活失败后把 command 标 completed |
| snapshot rebuild | Profile registry 是内存翻转；Job/Session 各有 durable truth | 领域 authority 先完成，再发布新只读快照；旧快照只读完成中的 UI 操作 | 让联邦层写回 Profile/Skill/Workflow/Job 数据 |
| 宿主重启 | Job durable recovery 已验证；Catalog/Tool runtime 需重新装配 | 重建描述，恢复 Job；不重放未知 Provider side effect | 用 activation 重跑整个业务操作 |
| 安装账本缺失 | Task 135 目标协议规定 recovery，但当前无实现证据 | 未来实现必须先有独立 Proposal/Spec/Task；本章不规定当前 fallback | 把 Reference 的 `installed.json` 当当前存在 |
| 第三方执行崩溃 | 无第三方 extension host 证据 | 在 threat model 和隔离合同之前不开放；第一方失败只隔离当前能力 | 以 Worker/iframe/process 名称宣称安全沙箱 |

## 7. 场景烟测的研究判定

### 场景：第一方扩展贡献图片 View 和图生文 command

研究上可追踪为：

```text
第一方描述
  → 联邦 snapshot（View + command + image-input labels）
  → Workbench host 判断 Project/Session context
  → View descriptor eligible/visible
  → command 触发既有 Attachment Authority + model.input gate
  → Agent Harness 执行视觉模型调用
  → Session message/事件 authority 发布文本
```

这条图中只有现有图片输入链和第一方 Workbench 槽位是当前证据；联邦 snapshot、View contribution、command activation 和专用图生文结构化结果均是研究建议。若“扩展”改成第三方可执行代码，流程必须在威胁模型门禁停止，不能把 View 可见或 command 已登记当作安全批准。

## 8. 源码锚点与检查边界

### 当前实现锚点

- [`../../../server/agent/profiles/catalog.ts`](../../../server/agent/profiles/catalog.ts)：Profile inventory、snapshot、loadStatus、issue、catalog generation、runtime resolution。
- [`../../../server/agent/profiles/profile-registry.ts`](../../../server/agent/profiles/profile-registry.ts)：`ProfileRegistry.publish` 的进程内 epoch 翻转。
- [`../../../server/agent/profiles/profile-artifact-compiler.ts`](../../../server/agent/profiles/profile-artifact-compiler.ts)：compiled artifact、manifest、publish lock 和发布失败边界。
- [`../../../server/agent/skills/skill-catalog.ts`](../../../server/agent/skills/skill-catalog.ts)：system/user 扫描、declared key 遮蔽和 user 错误隔离。
- [`../../../server/agent/workflow/workflow-catalog.ts`](../../../server/agent/workflow/workflow-catalog.ts)：system/user/project 覆盖、mtime cache 和受限求值。
- [`../../../server/agent/tools/tool-registry.ts`](../../../server/agent/tools/tool-registry.ts)：Provider schema projection、approval/tool key 列表和进程内注册。
- [`../../../server/agent/tools/types.ts`](../../../server/agent/tools/types.ts)：`approvalRequired`、`mutatesWorkspace`、`userInputRequest`、validation schema 与 execute 边界。
- [`../../../server/agent/jobs/agent-job-manager.ts`](../../../server/agent/jobs/agent-job-manager.ts)：`spawn`、`recoverInterrupted`、`commitTerminal`、delivery 恢复。
- [`../../../server/agent/jobs/agent-job-durable-store.ts`](../../../server/agent/jobs/agent-job-durable-store.ts)：每 Job JSON、strict schema、临时文件/fsync/原子 rename 和 quarantine。
- [`../../../server/runtime/paths/runtime-paths.ts`](../../../server/runtime/paths/runtime-paths.ts)：不可变物理 roots 和 secrets/cache/workspace containment。
- [`../../../assets/reference/agent/agent-asset-install.md`](../../../assets/reference/agent/agent-asset-install.md)：Task 135 的目标安装协议；不是当前实现。
- [`../../../.agents/tasks/135-agent-asset-install-protocol/README.md`](../../../.agents/tasks/135-agent-asset-install-protocol/README.md)：协议未实施的验证记录。
- [`../../../docs/adr/0011-agent-asset-install-identity.md`](../../../docs/adr/0011-agent-asset-install-identity.md)：资产 identity 取舍；不等同于安装器实现。
- [`../../../../../docs/specs/README.md`](../../../../../docs/specs/README.md)：当前待实现规范为空，决定本章只能使用研究建议口径。

### 检查边界

本章读取了当前 Profile/Skill/Workflow/Tool/Job/RuntimePaths 代码、相关类型、Task 135、Reference、ADR 0011 和 Spec 注册表。没有发现通用 Plugin/extension contribution 面、`installed.json` 生产读写、Install Root installer、第三方 activation host 或安全沙箱；没有执行资产安装、第三方代码、真实 Provider、跨重启真实运行或浏览器验收。因此联邦描述快照字段、activation 状态和第三方隔离均是**研究建议/未验证**，不能进入当前产品合同。
