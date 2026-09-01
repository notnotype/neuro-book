# NeuroBook 规范编程

`docs/specs/` 是 NeuroBook 产品、模块和组件规范的唯一落点。Spec 用受约束的自然语言连接模糊需求与确定代码：人类不必阅读全部实现，Agent 也不能只凭一句需求猜测输入、状态、副作用或失败语义。

本目录当前先做注册表，不复制现有正文。每项功能只有一个当前真相源；迁移完成前，注册表指向应用持有的 [`../packages/neuro-book/assets/reference/`](../../packages/neuro-book/assets/reference/)、`docs/modules/`、`docs/testing/` 或根规范文件。Monorepo / Module 的唯一正文仍在 [docs/modules/monorepo-boundaries.md](https://github.com/notnotype/neuro-book/blob/master/docs/modules/monorepo-boundaries.md)，不得另建 `docs/specs/architecture/monorepo-boundaries.md`。

## 两种成熟度，一个文件

每个可独立验收的能力只有一个稳定 Spec 文件，使用 `status` 表示成熟度：

| 状态 | 含义 | 权威边界 |
|---|---|---|
| `planned` | 已批准、尚无代码完整支持的目标合同 | 规定下一次实现必须达到的行为；不能用来宣称当前产品已有该能力 |
| `implemented` | 已由代码和验证证据支持的当前合同 | 规定当前产品行为；与代码或测试冲突时视为缺陷并停止猜测，核实后修正错误的一侧 |

不创建 `*-draft.md` 与 `*-current.md` 两份正文。能力实现后，原文件从 `planned` 原地晋升为 `implemented`，补充实现合同和证据。一个模块同时包含已实现与未实现内容时，按可独立验收的能力拆成多个 Spec，而不是在同一文件标记“部分实现”。

Proposal 的 `draft` / `reviewing` 表示方案尚未批准；Spec 的 `planned` 表示目标行为已经批准。未批准需求不能进入 `planned` Spec。

## 共同行为合同

所有 `kind: behavior` 的 Spec，无论成熟度，都必须使用黑盒语言说明：

1. **目标与非目标**：解决什么问题，明确不承诺什么。
2. **术语与参与者**：消除同义词、角色和对象边界。
3. **输入与前置条件**：触发方式、数据形状、权限、有效范围与约束。
4. **输出与可观察行为**：返回结果、界面反馈和外部可见变化。
5. **状态与转换**：初始状态、事件、下一状态、幂等与并发语义。
6. **副作用与数据**：持久化、文件、事件、网络、缓存和清理责任。
7. **失败与恢复**：校验失败、部分失败、重试、回滚和 fail-closed 边界。
8. **边界与兼容**：模块所有权、权限、安全、版本与迁移影响。
9. **验收与 Smoke**：能直接观察输入、输出、状态和副作用的场景。
以上九个名称是 `kind: behavior` 的固定二级标题，供机器稳定提取；API、UI 或领域特有表达放在对应章节正文或三级标题。无状态、无副作用或不适用的能力保留章节并明确说明“无”，不通过改名或合并章节省略合同主题。

`planned` Spec 把实现当作黑盒，不指定类名、函数名、算法、目录布局、框架技巧或逐文件改法。它允许约束公开接口、持久化格式和必须维持的架构边界，因为这些本身就是外部合同。

## Implemented Spec 的内部信息

`implemented` Spec 仍以共同的可观察行为为主体。它额外记录未来维护者必须知道、且代码阅读成本高的内部合同：

- 实现 owner、数据 owner 和依赖方向；
- 公开接口、事件、持久化 schema 与事务边界；
- 决定失败恢复、并发、安全或兼容性的关键不变量；
- 实现入口、合同测试和实际 smoke 命令。

逐函数控制流、文件改动清单、临时诊断、实现日志和“先改 A 再改 B”的过程属于代码或 Task。难以逆转且需要解释原因的内部取舍进入 ADR。这样重构内部实现时，只要行为和关键不变量不变，Spec 无需跟随文件结构改写。

## 文件格式

新 Spec 从 [`TEMPLATE.md`](TEMPLATE.md) 开始，文件名和目录使用英文 kebab-case。除 `README.md`、`AGENTS.md` 和 `TEMPLATE.md` 外，每个 Markdown Spec 都必须包含：

```yaml
---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: editor.html-mode
owners:
  - markdown-studio
---
```

- `kind`：`behavior`、`architecture` 或 `glossary`。
- `status`：只允许 `planned` 或 `implemented`。
- `capability`：仓库内唯一、稳定的点分标识；文件移动时不改变。
- `owners`：对行为与数据边界负责的一个或多个模块，必须使用 YAML 列表，不写临时执行人。

`architecture` 和 `glossary` 可使用与内容匹配的章节，但同样必须登记成熟度、稳定 capability 和 owner。`kind: behavior` 使用模板的完整行为合同。

## 流水线

### 新功能或长期行为变化

1. 原始自然语言进入 [`../proposals/`](../proposals/)；补齐歧义、备选方案和影响。
2. 人类接受 Proposal 后，创建或更新 `planned` Spec，把目标写成黑盒行为与验收场景。
3. `.agents/works/` 中的 Work/Task 引用 Proposal 和 Spec，记录具体实现、role、验证和交接。
4. 代码、测试和 Spec 在同一交付中收敛；证据支持全部合同后，将原 Spec 晋升为 `implemented`。

### Bug
- 代码偏离 `implemented` Spec：Spec 保持目标不变，Task 修复代码并验证回归。
- Spec 与代码、测试和稳定用户文档共同证明的当前行为不符：这是规范事实失真；Task 修正规范并记录依据。原 Spec 已被对外承诺或测试锁定时，必须经 Reviewer 复核并请求人类确认，不能由实现者单方改写。
- 现有材料能推出唯一行为、但 Spec 没写：在 Task 内补齐合同。
- 存在两个以上合理的可观察结果，或涉及跨模块、数据所有权、公开接口、安全与兼容取舍：这是产品歧义，回到 Proposal 或人类决策，不把诊断结论伪装成当前规范。

### Code-first 与重构
Code-first 只调整已授权 Task 内的修改顺序，不绕过人类授权、Task 范围或 Proposal 门禁。紧急修复或既有未记录行为可以先修代码，但同一 Task 完成前必须补齐或更新 `implemented` Spec；修复中出现产品歧义时先采用现有合同可推出的 fail-closed 行为，无法推出则停止请求决策。纯内部重构若不改变可观察行为，只核对现有 Spec 仍成立并在 Task 中记录行为基线；行为章节发生变化时不再属于纯重构，必须按行为变化流程处理。

## 已实现规范

| 功能域 | 当前规范 | 说明 |
|---|---|---|
| 基础术语 | [`../packages/neuro-book/docs/specs/foundation/terminology.md`](../../packages/neuro-book/docs/specs/foundation/terminology.md) | State Root、Cache Root、Workspace、Product、Agent 与安装等稳定领域语言 |
| Agent Runtime 与 Profile | [Reference: Agent](../../packages/neuro-book/assets/reference/agent/README.md) | Session、Profile、Workflow、Skill、Job、Project Workspace 与 Agent 协作协议 |
| Agent 资产运行期安装与 Catalog 根 | [`agent/asset-install-runtime.md`](agent/asset-install-runtime.md) | State Root Install Root、Runtime Reference Root、Install → Project 覆盖和显式 artifact context 已由代码与合同测试支持 |
| Agent Session Abort | [`agent/session-abort.md`](agent/session-abort.md) | HTTP abort、合作/forced 收口、唯一 durable lifecycle、写入恢复与 409/503 失败合同已由实现和行为测试支持 |
| Agent Context Compaction | [`agent/compaction.md`](agent/compaction.md) | 压缩触发、输入输出预算、最终请求门禁、checkpoint 降级、thrashing 保护和受验证恢复材料已由 Task 147 实现和测试覆盖 |
| 内容与 Project Workspace | [Reference: Content](../../packages/neuro-book/assets/reference/content/README.md) | 内容节点、正文、素材、检索、引用与 Workspace 术语 |
| World Engine | [Reference: World Engine](../../packages/neuro-book/assets/reference/world-engine/README.md) | 时间线、slice、subject、schema、calendar 与写作协作 |
| Plot | [Reference: Plot](../../packages/neuro-book/assets/reference/plot/README.md) | Story、Thread、Scene、Writer Brief、Agent 与前端合同 |
| Theme | [`theme/system.md`](theme/system.md) | 主题变量和消费规则 |
| Media | [`media/image-variants.md`](media/image-variants.md) | 图片原图、变体、缓存和 Project 封面 |
| Character | [模块需求](https://github.com/notnotype/neuro-book/blob/master/docs/modules/character/requirements.md) | 当前需求与界面字段；尚待补齐状态和失败语义 |
| Monorepo / Module | [Monorepo 边界](https://github.com/notnotype/neuro-book/blob/master/docs/modules/monorepo-boundaries.md) | Monorepo 当前包布局、唯一文档真相源、包级继承/覆盖、依赖方向和 worktree 根边界 |
| 测试与验收 | [`../testing/README.md`](../testing/README.md) | 测试组织、临时根、验收和证据合同 |
| 人工评测 | [`../testing/manual-eval/README.md`](../testing/manual-eval/README.md) | 用户视角旅程、判定口径和报告结构 |
| 数据迁移 | [`../packages/neuro-book/docs/migrations/README.md`](../../packages/neuro-book/docs/migrations/README.md) | 有状态升级、备份和回滚入口 |
| 贡献与交付 | [CONTRIBUTING](https://github.com/notnotype/neuro-book/blob/master/CONTRIBUTING.md) | Issue、开发、Git、PR 与维护者交付流程 |

## 待实现规范

以下已获批准但尚未实现的行为合同必须在代码切换前完成；实现和验证闭合后原地晋升为 `implemented`。

| 功能域 | 计划规范 | 说明 |
|---|---|---|
| Component Lab | [`ui/component-lab.md`](ui/component-lab.md) | Source Dev-only 确定性 fixture、响应式检视和 Product 排除合同；当前尚未实现 |

## 冻结过渡规范

以下正文描述已有实现，但仍被产品 Profile、资产投影、测试或打包流程直接消费。它们在迁入 `docs/specs/` 前保持冻结，不是新规范落点：

| 功能域 | 当前规范 | 固定目标 |
|---|---|---|
| Agent Runtime 与 Profile | [`../../packages/neuro-book/assets/reference/agent/`](../../packages/neuro-book/assets/reference/agent/) | `docs/specs/agent/` |
| Content / Project Workspace | [`../../packages/neuro-book/assets/reference/content/`](../../packages/neuro-book/assets/reference/content/) | `docs/specs/content/` |
| World Engine | [`../../packages/neuro-book/assets/reference/world-engine/`](../../packages/neuro-book/assets/reference/world-engine/) | `docs/specs/world-engine/` |
| Plot | [`../../packages/neuro-book/assets/reference/plot/`](../../packages/neuro-book/assets/reference/plot/) | `docs/specs/plot/` |

## 规范缺口

以下功能已有代码、测试、ADR 或 Proposal，但缺少足以判断当前行为的 `implemented` Spec。修改这些功能前先建立规范归属：

| 优先级 | 功能域 | 现有证据 | 缺口 |
|---|---|---|---|
| P0 | Desktop、安装与 Product Runtime | `packages/neuro-book/docs/adr/0010-*`、`0013-*`、`0014-*`、`0016-*`，`desktop/`、`scripts/install/`、`scripts/deploy/` | 安装状态机、UAC、启动/关闭、升级、卸载和失败恢复未汇成当前规范 |
| P0 | 应用状态、备份与数据迁移 | `packages/neuro-book/docs/adr/0005-*`、`0008-*`、`0012-*`，`packages/neuro-book/server/backup/`、`packages/neuro-book/server/database/` | 数据所有权、备份恢复、catalog 演进和 release activation 未形成端到端规范 |
| P0 | Agent Session 持久化与历史 | `packages/neuro-book/docs/adr/0003-*`、`0014-agent-job-*`，`packages/neuro-book/server/agent/session/`、`packages/neuro-book/server/workspace-history/` | durable event、Job 历史、附件、租约和文件历史缺少统一状态与恢复规范 |
| P1 | 配置、模型与凭据 | `packages/neuro-book/server/config/`、`packages/neuro-book/server/models/`、`packages/neuro-book/shared/dto/app-settings.dto.ts` | 配置优先级、敏感字段、provider identity、错误和 UI 行为没有单一规范 |
| P1 | Markdown Studio 与编辑工作台 | [`../../vitepress/locales/zh-Hans/core/markdown-studio.md`](../../vitepress/locales/zh-Hans/core/markdown-studio.md)、[历史 editor plan](../../packages/neuro-book/docs/archived/plan/06-editor-workbench.md)、`packages/neuro-book/shared/editor-workbench.ts` | 用户文档与历史 plan 存在，但需要按当前代码和测试核对后转成内部当前规范 |
| P1 | Passport 与身份 | `packages/neuro-book/server/passport/`、相关 migration 与测试 | 登录、官方 origin、凭据存储和失败语义缺少当前规范 |
| P1 | Manager 与发布资产 | `packages/neuro-book-manager/`、`scripts/release/`、`RELEASE.md` | 安装身份、manifest、资产、健康检查和发布门禁分散 |
| P2 | Character 与 Low-code Form | `docs/modules/character/requirements.md`、`packages/neuro-book/server/low-code-form/` | 需求存在，但状态、校验、持久化、权限和失败语义不完整 |

## Reference 迁移合同

每个待迁域必须一次性完成正文分类、Profile Import、产品投影、合同测试、文档链接、工作流与打包入口切换，然后删除旧 `reference/<domain>/`。不保留两份可独立修改的正文。Project Workspace 内的 `reference/` 是用户素材协议，不属于本迁移目标。

1. 新功能先检查本表是否已有规范归属。
2. 尚未决定的跨模块方案写入 [`../proposals/README.md`](../proposals/README.md)；小型、可逆且不改变长期合同的工作可直接更新现有规范。
3. 提案获批后，先更新或创建当前规范，再在 `.agents/works/` 创建 Work 与实现 Task。
4. 实现期间如果行为变化，规范和代码在同一变更中更新。
5. 验收以规范中的可观察行为为依据；Task 完成不能代替规范更新。
6. 旧行为退出时，更新当前规范；需要保留理由时写 ADR，需要用户升级步骤时写 migration。Task 和 proposal 保留历史但不再作为当前行为依据。

`bun run docs:check` 只负责确定性结构：元数据、模板占位、必需章节的实义内容、成熟度登记、capability 精确唯一、implemented 证据链接和活跃相对链接。它不判断自然语言是否互相矛盾、owner 是否真实、两个近义 capability 是否重叠，也不推断代码 diff 是否改变行为。

Reviewer 必须核对每项输入、输出、状态、副作用和失败语义没有冲突；`planned` 没有泄漏实现步骤且具有真实批准依据；`implemented` 的代码、测试和 smoke 证据覆盖正文；Task 和 PR 链接具体 Spec 或明确说明行为合同未变。两层都通过才算完成。