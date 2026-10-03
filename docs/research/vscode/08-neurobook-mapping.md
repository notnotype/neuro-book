# 08 NeuroBook 映射：先借控制平面，再决定是否开放执行

> 本章是研究映射，不是产品 Spec、Proposal 或 ADR。`docs/specs/README.md` 当前“待实现规范”为空；本章提出的 capability 均是研究建议，不写成 `planned` 或 `implemented`。
> 证据标签：**已验证当前实现** = 当前 NeuroBook 源码与已读测试直接确认；**已批准但未实施的目标合同** = Reference/Task 明确批准但尚无代码证据；**研究建议** = 本轮映射结论；**未验证/候选** = 当前没有足够源码、测试或运行证据。

## 结论先行

NeuroBook 已经有比“任意插件 import”更重要的控制平面零件：Profile/Skill/Workflow Catalog、Profile compiled artifact、原子发布、Tool schema 与执行权限分离、Session snapshot、后台 Job、附件 authority、Project history 和显式 RuntimePaths。当前缺口不是增加一个总称为 `Plugin` 的类，而是把这些局部机制用稳定的**声明、快照、宿主入口、状态、权限和持久化边界**串起来。

建议采用四层渐进路径：

```text
L0  声明和快照统一
  → L1  宿主命令 / 配置 / View 注册
  → L2  惰性激活和依赖失败状态
  → L3  受控可执行宿主与隔离评估
```

现在适合研究 L0，谨慎研究 L1；不能把 VS Code 的 Extension Host 当作 NeuroBook 第一步的安全执行方案。所有“建议”都需要后续 Proposal/Spec/ADR 才能变成合同。
## 本轮三项 capability map

本轮不把“扩展系统”设计成一个新造的万能 `Plugin` 类，也不把已有 Catalog 的 owner、覆盖、编译、安装和执行语义抹平。三项 capability 的关系固定如下：

```text
workbench-view-host（研究建议）
  └─ 提供宿主拥有的 View/Container/Editor 位置与生命周期边界
extension-control-plane（研究建议）
  └─ 索引 Profile/Skill/Workflow/Tool 与第一方 View/Command 的描述，不接管各领域真相源
bidirectional-image-workflows（研究建议；内部拆为两条独立链）
  ├─ image-understanding：当前图片输入→视觉模型→文本结果链的结构化研究
  └─ image-generation：候选文本→生成 Provider→Project 图片资产链
```

依赖方向是 `workbench-view-host` 与 `extension-control-plane` 共同支撑 `bidirectional-image-workflows`。图生文与文生图不共用 Provider、Job、资产提交状态：前者当前已有 Session Attachment/视觉模型链，后者仍无生成 Provider、生成 schema 或 Project 图片资产 authority 的实现证据。

### 当前实现、目标合同和研究建议不能混用

| 对象 | 当前可写成什么 | 不能写成什么 | 证据边界 |
| --- | --- | --- | --- |
| 图片输入到视觉模型 | **已验证当前实现** | 专用 OCR、结构化角色卡写入或文生图 | `packages/neuro-book/server/agent/attachments/agent-attachment-codec.ts`、`SessionAttachmentAuthority`、Harness hydration 与 Task 108 测试 |
| Profile Catalog/Registry、Skill Catalog、Workflow Catalog、Tool Registry、Agent Job | **已验证当前实现**，各自语义独立 | 统一 Description Registry、统一 activation 状态机或第三方插件沙箱 | 当前源码与测试；没有统一贡献代码面 |
| `reference/agent/agent-asset-install.md` 的 Install Root/`installed.json`/provenance ledger | **已批准但未实施的目标合同** | 当前安装器、已实现账本或 Seed Root 已完成切换 | Task 135 README 明示协议尚未实施；产品代码未发现对应实现 |
| `workbench-view-host`、`extension-control-plane`、双向图像 capability | **研究建议** | 已登记 `planned` Spec 或当前产品合同 | `docs/specs/README.md` 的待实现规范表当前为空 |

因此后续章节的“阶段”“门”都是研究验收顺序，不是已经批准的 Spec 版本；接受其中任一行为前，必须另建 Proposal、登记唯一 capability 的 `planned` Spec，再创建 Task。

### 本章术语的使用边界

本章把 **控制平面** 用作一个阅读模型：它负责登记描述、选择入口、校验意图、决定运行位置和暴露状态；它不等于一个新模块，也不等于安全沙箱。**authority** 指某类状态/副作用的唯一读写守门边界；**snapshot/epoch** 指某一时刻可复查的描述或内存视图版本；**durable job** 指有持久记录和恢复语义的后台任务。三者分别回答“谁能写”“当前是哪一版”“任务如何恢复”，不能用一个 `Plugin` 对象混合承载。

本章的 L0-L3 是研究分阶段，不是已批准的产品版本号；“进入 L1/L2/L3”表示需要先满足证据条件，不表示当前代码已经实现对应能力。

### 读者如何使用这张映射

不要把 L0-L3 当成“实现清单”逐项打勾。每一层都同时描述三件事：要新增的控制面能力、必须继续禁止的越权路径、以及进入下一层前需要留下的证据。阅读某个具体能力时，按以下顺序核对：

```text
能力描述是否已有稳定 key/版本/来源
  → 宿主入口是否持有参数与权限校验
  → 状态是否有唯一 authority 和恢复作用域
  → 失败/取消/升级是否可观察
  → 是否仍把 UI、运行时代码和业务副作用混在一起
```

这套顺序解释了为什么本章先列现状边界，再谈渐进路径：没有现状 authority 和状态真相，新增 Registry 只会把未定义的行为重新命名。

## 1. 现状底图：已有零件分别守什么边界

| NeuroBook 现状 | 已验证当前实现证据 | 它实际守住的边界 | 不能据此声称 |
| --- | --- | --- | --- |
| Harness 单例 | `packages/neuro-book/server/agent/http.ts::useAgentHarness` | HTTP 入口共享运行期事件中心和依赖；创建时传入 `RuntimePaths`、JSONL repo、`watchProfiles` | 没有统一 IoC 容器；也不是可执行插件沙箱 |
| RuntimePaths | `packages/neuro-book/server/runtime/paths/runtime-paths.ts::createRuntimePaths` | 显式决定 application/state/cache/workspace/secrets 等根，模块从同一组物理边界取路径 | 不能让插件自行发现 cwd/环境或任意根目录 |
| Profile Catalog | `packages/neuro-book/server/agent/profiles/catalog.ts::AgentProfileCatalog` | system/user root 按 key 覆盖；Runtime 只加载 `.compiled` artifact；snapshot 暴露 load status、schema、toolKeys | 不是通用 extension registry；不代表第三方代码已开放 |
| Profile Registry | `packages/neuro-book/server/agent/profiles/profile-registry.ts::ProfileRegistry.publish` | 内存 catalog 原子替换并递增 epoch；不读盘、不 import | 不等于 durable transaction；磁盘和内存翻转仍可能出现 committed-but-registry-failed |
| Profile 发布 | `packages/neuro-book/server/agent/profiles/profile-artifact-compiler.ts::ProfileReleasePublisher` | staging artifact、publish queue/lock、manifest 原子替换；in-process 模式随后翻 Registry | 不保证任意 Provider 或插件执行安全 |
| Tool Registry | `packages/neuro-book/server/agent/tools/tool-registry.ts::AgentToolRegistry` | `allowed()` 只向 Provider 提供 tool schema；执行硬权限由 `executionToolKeys` 等调用上下文决定 | schema 可见不等于执行授权；Profile 不能绕过 Harness 拿函数 |
| Durable Job | `packages/neuro-book/server/agent/jobs/agent-job-manager.ts::AgentJobManager.spawn` | running snapshot、AbortSignal、preview/waiting、durable record、恢复和 delivery | 不是 Provider FIFO；Job 恢复不等于外部副作用自动可重放 |
| Session Attachment | `packages/neuro-book/server/agent/attachments/session-attachment-authority.ts::SessionAttachmentAuthority` | JSONL 是唯一持久真相；内存 index 可按签名重建；引用和 Project 门禁 fail closed | 不是项目资产库；不能把公开 locator 当授权 |
| Project History | `packages/neuro-book/server/workspace-history/project-history.ts::recordProjectWrite` | 写入收口后记账；失败 fail-open，watcher/reconcile 补 external 历史 | 不能保证正文回写与资产写入自动组成一个事务 |
| Workbench | `packages/neuro-book/app/pages/index.vue`、`app/stores/novel-ide.ts` | 固定 Activity item、editor tabs、layout mode、多个 panel width 的前端状态 | 不是通用 View Registry；第三方 Vue 组件不可直接注入主布局 |
| Resize 宿主 | `packages/neuro-book/app/composables/useResizablePanel.ts::useResizablePanel` | 统一边缘拖拽、clamp、动画帧合并、结束时提交尺寸 | 不能让每个插件再私有一套面板尺寸持久化 |
| Config Service | `packages/neuro-book/server/config/config-service.ts::readConfigSnapshot/saveGlobalConfig/saveProjectConfig` | global/project 读取、effective merge、target 校验、Provider connection stability、Profile settings mutation | 不是 VS Code `contributes.configuration`；没有开放式 schema registry |
| 图片变体 | `packages/neuro-book/server/media/image-variant.ts::ImageVariantModule` | 已授权 source 的受限 WebP 变体队列、cache/dedupe、`activeJobs=2`、`queuedJobs=64` | 不是 AI 生图 Provider、Project FIFO 或图片资产发布 authority |

## 2. NeuroBook 当前最接近 VS Code 的不是代码加载，而是边界分离

### 2.1 `ProfileRegistry` 已有 snapshot/epoch 形状

`ProfileRegistry.publish(catalog)` 只做两件事：替换当前内存 catalog，`currentEpoch += 1`。`AgentProfileCatalog` 的 runtime registry 在显式 refresh 或 release publish 后重建 `.compiled/manifest.json` 对应的 catalog，再用 `publish()` 切换。

这是 VS Code description registry snapshot/version 的相似形状，但语义不同：

- VS Code registry 维护 extension descriptions、activation map 和 dynamic delta；
- NeuroBook registry 维护已编译 Profile catalog，不负责通用 activation event；
- VS Code host restart 可用 snapshot 重建 runtime；
- NeuroBook profile publish 后仍须由 Job/Session/Project authority 处理业务状态。

**置信度：已验证现状；相似性判断为从代码推断。**

### 2.2 `AgentToolRegistry` 已经拒绝“模型看见就能执行”

`AgentToolRegistry.allowed()` 把 `NeuroAgentTool` 投影成 Provider 只读 schema；注释直接写明：

```text
Provider 只获得工具 schema，不获得 Harness 执行函数与领域能力。
```

这比把每个 Profile module 直接暴露给 LLM 或 UI 更接近宿主控制面。下一步即使研究 plugin contribution，也应保留这条分离：

```text
声明/展示 schema
  ≠ 执行函数
  ≠ 批准状态
  ≠ Project 写入 authority
```

### 2.3 Session、Job、History 已形成多个真相源

NeuroBook 不是缺少状态，而是状态已经按领域拆开：

```text
Session JSONL       对话、附件 durable truth
Agent Job record    后台任务运行/终态/恢复
Project history     文件变更历史与 actor 归因
Config JSON         global/project 业务配置
Profile artifact    编译后的运行入口和 manifest
RuntimePaths        物理根与秘密边界
```

因此不能照搬“扩展 `globalState` 存一切”。插件研究应先问每一类状态的 authority、scope、恢复、幂等和审计，而不是先设计插件 API。

## 3. 渐进式解耦路径

### L0：统一声明和快照

**新增研究能力**：为 Profile、Skill、Workflow、工具和未来 View 提炼共用的最小 description 形状：稳定 key、版本/来源、capability labels、load status、issue、schema reference、来源根和 snapshot epoch。

**仍禁止**：

- 任意目录扫描后直接 import；
- 插件写入 `.nbook/config.json`、Session JSONL 或 Project 文件；
- 把 Skill/Workflow/Profile 的损坏默默回退成低优先级同名资产；
- 用一个 `trusted` 布尔值替代 asset/workspace/tool authority。

**进入 L1 的证据**：

- 现有 Catalog 的同名覆盖、损坏、删除和 stale 行为形成一致矩阵；
- snapshot 具有明确 epoch、来源和可观测 issues；
- publish 的磁盘 manifest、内存 catalog 和 API snapshot 在 committed failure 时能报告不一致；
- 现有 Profile/Skill/Workflow/Tool 消费者已完成迁移，旧入口删除；
- 对每种状态明确 JSONL/file/history/config/artifact 哪个是真相源。

**判断**：L0 是最保守、最可逆的研究方向。**置信度：从代码推断。**

### L1：宿主命令、配置和 View 注册

**新增研究能力**：宿主维护有限的 command registry、configuration schema registry 和 View descriptor registry。插件只能提交声明和调用稳定宿主 API；工作台决定显示、位置、尺寸和生命周期。

推荐控制面形状：

```text
Plugin description
  → Host registry
  → Host-owned command/config/view models
  → User/session/project intent
  → Host validation
  → existing authority/service
```

**仍禁止**：

- 任意第三方 Vue component 直接挂到 `app/pages/index.vue`；
- 插件自带 CSS/DOM 改写 Workbench；
- 插件私有 resize/localStorage 绕过 `useResizablePanel`；
- 插件直接取得 Harness、数据库、HTTP request 或 raw filesystem root；
- “菜单显示了”就视为“能力已授权”。

**进入 L2 的证据**：

- command 每次调用有来源、参数 schema、取消、结果/错误和权限决策；
- configuration 明确 global/project/session memory target，secret 不进入普通快照；
- View 只有稳定 `viewId/containerId` 和宿主布局意图，不传组件实例；
- Panel 尺寸仍由宿主统一控制，布局状态作用域和恢复失败有测试；
- command/config/view 贡献在插件禁用、升级、删除时有可恢复状态。

**判断**：L1 能支持“可发现的扩展能力”而不先开放外部代码执行。**置信度：从 VS Code 与 NeuroBook 现状推断。**

### L2：惰性激活和依赖失败状态

**新增研究能力**：在已有 Profile compile/build coordinator 与 Job Manager 之上，研究明确的 activation operation：事件、依赖、等待、成功、失败、禁用、取消、超时、重试和 host/status snapshot。

可借鉴 VS Code 的状态图，但不是照搬 `activate()`：

```text
registered
  → eligible
  → activating
  → active
  → failed / disabled / stale
```

**仍禁止**：

- 以 `eval`/动态 import 作为权限模型；
- 依赖不明时静默跳过或低优先级回退；
- 激活失败后仍把 command 结果标为成功；
- 用 Extension Host restart 代替 durable Job recovery；
- 把 Profile build success 当作 Provider side effect success。

**进入 L3 的证据**：

- activation 事件与业务 Job/Session 事件不会互相污染；
- 依赖图有 unknown/loop/failed 语义和可诊断错误；
- activation state 和 durable job state 分开持久化/恢复；
- 能力调用的 side effect 都经过 Tool/Project/Attachment authority；
- host crash、cancel、upgrade、stale artifact 的组合测试闭合。

### L3：受控可执行宿主与隔离评估

**新增研究能力**：只有在 L0-L2 证据闭合后，才研究第三方可执行资产的独立 Worker/Process/VM、能力白名单、资源配额、网络/文件 containment、签名/来源、更新/回滚和审计。

**仍禁止**：

- 因为有 Node process 就声称“安全沙箱”；
- 把 Web Worker 或 iframe 隔离当成恶意代码威胁模型的结论；
- 让外部代码持有 Project root、secrets root 或任意 Provider credential；
- 把升级/卸载和运行中 side effect 当成热替换小问题；
- 在没有 threat model、权限矩阵和故障注入证据前开放默认安装执行。

**进入产品决策的证据**：

- 明确威胁模型、信任来源和租户/用户边界；
- 文件、网络、进程、Provider、secret、Project write 的 capability matrix；
- 资源上限、取消强制、崩溃恢复和残留进程清理；
- 资产发布、来源 ledger、签名/完整性、回滚和撤销；
- 真实 hostile fixture 的端到端测试；
- 独立 Proposal/Spec/ADR 拍板。

## 4. 布局解耦的具体观察

### 4.1 只开放控制意图，不开放组件注入

VS Code 的拖拽数据是 `{ type, id }` 一类身份意图，宿主从 registry 查描述、来源、目标合法性和 `canMoveView`，再更新 View model。NeuroBook 应保持相同的控制面方向：

```text
{ viewId, targetContainerId, position }
  → host validate
  → View model / layout state
  → useResizablePanel / host geometry
```

不允许 payload 带 Vue component、render function、arbitrary HTML 或 file path。

### 4.2 一维 View 和二维 Editor 分开

当前 NeuroBook 有固定 Activity Bar 与多个固定面板。若未来开放 View：

- Sidebar/Panel/Agent panel 仍优先是一维 View Container + PaneView；
- Markdown Studio/编辑器只有确有二维需求时才引入 Editor Group/Grid；
- resize 统一复用 `useResizablePanel`；
- View location、container order、panel width、editor split、session focus 按不同作用域持久化。

这只是架构观察，不表示当前已批准自由布局。

### 4.3 布局状态不等于插件运行状态

一个 View 可以：

```text
registered but hidden
visible but not activated
activated but waiting for user/project authority
active but provider/job failed
```

把这些状态压成 `open: boolean` 会让升级、恢复和故障通知失去判断依据。`app/pages/index.vue` 目前的 `agentPanelOpen`、`layoutMode` 与 store 中 panel width 属于当前宿主 UI 状态，不应直接扩展成“插件状态机”。

## 5. 对几个具体问题的回答

### 是否需要统一 IoC 容器？

**结论：目前不需要为了插件研究立即引入。** `useAgentHarness()` 已经通过显式构造器参数装配主要运行依赖，`RuntimePaths` 也把物理根绑定清楚。统一容器只有在跨模块生命周期、child scope、dispose ownership 和 lazy service resolution 真正成为重复问题时才值得评估。

**置信度：已验证现状 + 从代码推断。**

### 是否需要立即做通用 Plugin Registry？

**结论：先做 description snapshot 观察，不先做可执行 Plugin Registry。** 现有 Profile Catalog、Skill Catalog、Workflow Catalog 仍有同名损坏和 fallback 语义差异；先统一这些事实，比包一层总 Registry 更能降低风险。

**置信度：从代码推断。**

### 是否可以让文生图能力成为插件？

**结论：可以把“命令/View/配置声明”和“后端 Job/Provider/资产 authority”作为候选插件边界；不能声称现有系统已经支持一个可执行文生图插件。** 见 [09 文生图旅程](./09-text-to-image-plugin-journey.md)。

### 是否可以把 VS Code Extension Host 当隔离层？

**结论：不能直接这样做。** VS Code 源码证明 Extension Host 是进程/Worker 与 Workbench 的故障和 API 边界；它不证明对 NeuroBook 的任意第三方代码具有完整安全隔离能力。

## 源码锚点与检查边界

### NeuroBook 主证据

- [`../../../server/agent/http.ts`](../../../server/agent/http.ts)：`useAgentHarness` 的 globalThis 单例与显式 Harness 装配。
- [`../../../server/runtime/paths/runtime-paths.ts`](../../../server/runtime/paths/runtime-paths.ts)：`RuntimePaths` 与 `createRuntimePaths` 的物理根集合。
- [`../../../server/agent/profiles/catalog.ts`](../../../server/agent/profiles/catalog.ts)：`AgentProfileCatalog` 的 compiled catalog、snapshot、runtime registry refresh/publish。
- [`../../../server/agent/profiles/profile-registry.ts`](../../../server/agent/profiles/profile-registry.ts)：`ProfileRegistry.publish` 的内存视图/epoch。
- [`../../../server/agent/profiles/profile-artifact-compiler.ts`](../../../server/agent/profiles/profile-artifact-compiler.ts)：Profile release staging、manifest 原子替换与 Registry 翻转失败状态。
- [`../../../server/agent/tools/tool-registry.ts`](../../../server/agent/tools/tool-registry.ts)：`AgentToolRegistry.allowed/allowedWithOverrides` 的 schema projection。
- [`../../../server/agent/jobs/agent-job-manager.ts`](../../../server/agent/jobs/agent-job-manager.ts)：`AgentJobManager.spawn/cancel/recoverInterrupted/commitTerminal`。
- [`../../../server/agent/attachments/session-attachment-authority.ts`](../../../server/agent/attachments/session-attachment-authority.ts)：Session JSONL attachment authority、canonical ownership 和 Project 门禁。
- [`../../../server/workspace-history/project-history.ts`](../../../server/workspace-history/project-history.ts)：`recordProjectWrite/Delete/Rename` 与 fail-open/reconcile 边界。
- [`../../../server/config/config-service.ts`](../../../server/config/config-service.ts)：`readConfigSnapshot/saveGlobalConfig/saveProjectConfig` 的 global/project target。
- [`../../../server/media/image-variant.ts`](../../../server/media/image-variant.ts)：`ImageVariantModule.render` 的受限变体 cache/queue，不是生图 Provider。
- [`../../../app/pages/index.vue`](../../../app/pages/index.vue)、[`../../../app/stores/novel-ide.ts`](../../../app/stores/novel-ide.ts)：当前固定槽位、editor tabs、layout mode 与 panel state。
- [`../../../app/composables/useResizablePanel.ts`](../../../app/composables/useResizablePanel.ts)：唯一 resize 宿主边界。
- [`../../../app/utils/workbench-chrome.ts`](../../../app/utils/workbench-chrome.ts)：固定 Activity Bar capability 枚举。

### 检查边界

已读取并用于本章：Harness 入口、RuntimePaths、AgentProfileCatalog/ProfileRegistry、Profile release publisher、AgentToolRegistry、AgentJobManager、SessionAttachmentAuthority、Project history、Config service、ImageVariantModule、Workbench 页面/store/resize/chrome。

未验证：NeuroBook 当前所有 Catalog 的完整同名冲突矩阵、真实浏览器/桌面 UI、第三方资产 hostile fixture、Provider sandbox、远程多租户、secret rotation、插件更新回滚和统一 View registry。故本章不提供新的 API 名称、wire schema、权限合同或安全承诺。
