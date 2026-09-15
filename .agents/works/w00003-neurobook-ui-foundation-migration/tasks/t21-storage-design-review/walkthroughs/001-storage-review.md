# Storage 设计审查与 Spec 沉淀

- 日期：2026-09-15
- Task：[t21-storage-design-review](../README.md)，role：leader
- 基线：`8406964de94f3aecd309d9deacc8cafd8e909384`，分支 `refactor/w00003-nb-ui-adoption`
- 工作区：`.worktree/w00003-neurobook-ui-foundation-migration`
- 状态：完成。架构审查通过并落 planned Spec；完整 Storage 服务与同步行为仍在 draft 提案中。

## 审查结论与范围

Config / Storage / 内存 / 领域数据的区分和 user/project 归属符合当前消费者需求；
按 owner 隔离、grid 不持存储依赖、scope 不决定同步的设计允许新增插件和适配层。
这是源码与架构推演结论，未证明完整 Storage 服务或同步实现已就绪。

前两轮 omp 的结论为“需要修复”。主 Agent 复核其证据后补强上下文、身份、设备隔离和恢复边界，
形成 [storage.boundaries](../../../../../../docs/specs/storage/boundaries.md)（planned architecture）。
聚焦终审结论为“建议合并（仅架构文档），无阻断项”，主 Agent 复核后采纳；本 Task 未执行 Git 合并或提交。
完整读写、并发、删除、同步与具体键分配不具备完整行为合同，保留于
[draft 提案](../../../../../../docs/proposals/storage-service-and-sync.md)。

## 需求覆盖与扩展依据

| 需求 | 源码或现有合同 | 审查判断 |
|---|---|---|
| 主 Workbench 尺寸恢复 | `app/stores/novel-ide.ts` 的 `novel.ide.local`；`app/utils/workbench/layout.ts` | user 归属可以保持，介质封装可后续替换 |
| World Engine 内部复杂布局 | `WorldEngineWorkbenchDialog.vue` 的三尺寸 ref；nb-ui `grid.ts` | 可复用拆分树原语并持有独立实例，不能复用主外壳固定拓扑；尚未接线 |
| 同一插件保存多类状态 | descriptor 只有 View 级 stateScope | 必须允许插件分别使用 user/project/内存，不能把插件强制绑一个 scope |
| 不持久化但需共享 | 现有 ref、Pinia 与宿主状态投影 | 不需要新增 window/session scope；释放订阅与目标绑定仍有生命周期 |
| 非 UI 消费 | Config 与领域服务已在后端存在 | 通用 Storage 允许服务端消费，schema/默认值/后端调用都不是 Config 的充分条件 |
| 未来跨设备同步 | 当前有桌面远端连接；Project identity 依赖路径 | scope 不决定同步；local/shared 元数据轴仍为推荐方案，同步身份与协议尚未定稿 |

## 重要发现与处理

1. **残留 Project 路径会选错分区（从代码推断，尚无产品接线）**。
   `switchToUserAssetsWorkspace()` 只切 `workspaceKind`，保留 `currentProjectRoot`；
   `resolveViewStateLayer()` 仅检查 root 是否为 null，调用方目前只有测试。
   Spec 要求显式有效上下文，用户资产不能借残留 root 选 Project 分区；后台显式绑定 A 的操作仍可处理 A，不能在切 B 后重路由。
   源码：`packages/neuro-book/app/stores/novel-ide.ts:1725`、`app/utils/workbench/descriptors.ts:170`。
2. **当前 locator 不是跨设备身份（源码已核对）**。
   `ProjectWorkspaceKey` 明确是进程内 Symbol；`projectWorkspaceHash` 将 Workspace Root 与 projectRoot 合成哈希。
   `ProjectManifest` 没有可直接用的跨设备 ID。Spec 禁止序列化该 Symbol 或直接把路径哈希用作同步身份，
   同名/替换项目不得自动继承；真正的移动、复制、重建与映射合同留提案。
   源码：`packages/neuro-book/server/workspace-files/project-identity.ts:21`、`:148`、`project-manifest.ts:24`。
   Reviewer 对“同名重建会继承旧分区”的说法是未来风险，通用 Storage 当前不存在，不能当成已复现丢数据。
3. **服务端本地状态需要客户端隔离（架构推断）**。
   Electron/Tauri 的远端连接模式允许两台客户端连接同一服务；一份服务端公共尺寸会互相覆盖。
   Spec 规定无受控客户端身份时本地状态留客户端；未来可在服务端显式分区。
   不采纳 Reviewer 的绝对说法“local 不能落服务端”，也不把一次关键字未命中当作全仓不存在设备身份的证明。
4. **恢复视图不能自动覆盖原记录（合同补强）**。
   未知高版本、缺插件引用、窄屏夹取和读取失败都可能触发默认投影。
   Spec 明确显示回退与持久化替换不同，避免观察器自动写回；实际读写并发和用户新编辑的组合合同仍需服务/消费者 Spec。

## 第二轮审查与修订

omp 第二轮仍判定“需要修复”，主 Agent 核对后处理五项文档问题：

1. 将 Spec 中仿佛已确定的同步属性轴撤回提案。架构只固定 scope 不决定同步及隔离、权限、确认边界；
   是否采用 local/shared、如何组合及默认值均未获批。ADR 与 proposal 使用相同成熟度口径。
2. 明确 Project 上下文必须来自生命周期模块发布的有效就绪代次，不能来自路径或前台选择。
   依据 [ADR 0007](../../../../../../packages/neuro-book/docs/adr/0007-project-close-then-open.md)、
   [前端状态机](../../../../../../packages/neuro-book/app/composables/useProjectSession.ts)、
   [页面门禁](../../../../../../packages/neuro-book/app/pages/index.vue) 和
   [服务端就绪入口](../../../../../../packages/neuro-book/server/workspace-files/project-session.ts)。
   页面 `projectSurfaceActive` 同时允许用户资产，不能单凭该布尔值绑定 Project；必须核对工作面类别和就绪目标。
   前端离开释放本标签页 presence，不能关闭后台操作仍使用的全局 Project；失效后拒绝新操作，已接纳操作的排空由生命周期 owner 管理。
3. 找到既有 Project 决策与源码，但完整生命周期和持久身份规范确有缺口。
   [Root Identity](../../../../../../packages/neuro-book/server/workspace-files/project-root-identity.ts) 当前只提供进程内物理身份保护；
   Spec 链接现有依据，并在注册表登记 Project / Workspace owner 需补齐的合同，不再引用仿佛已完备的迁移规范。
4. Spec owner 明确为 UI 与 server，正文分清 Project / Workspace 和 nb-ui 职责。
5. 就地解释上下文对象与条件键值投影；组件规范改为经宿主接入唯一持久化路径，命令提案 MRU 改为引用 Storage 合同，
   去除新增裸 localStorage 的建议。只修订命令提案的存储落点，未审定或扩展命令设计。

## 具体产物

- 新架构 Spec 与两个索引；新 draft 服务/同步提案。
- ADR 0020、前端/组件规范、Workbench Spec/提案、命令提案的存储段、研究稿及 Work 入口链接到新真相源。
- 本 Task 与本审查记录。未修改运行时代码、未迁移数据、未提交或写远端。
- 进入本轮前已有的 descriptor/test 等未提交改动保持原样，不作为本轮代码交付。

## 终审结论与主 Agent 裁定

第三轮 omp 确认未决取舍的成熟度、Project 生命周期、多 scope 插件、grid 原语复用和关联文档均无阻断项。
主 Agent 复读前端 `release()`、页面门禁、服务端精确代次操作守卫和 grid 原语边界，与该结论一致。
终审另有三条非阻断意见：

- 采纳就绪代次措辞修正：服务端重复 open 已 ready 项目可以复用当前 generation，不能要求每次 open 都使缓存失效。
  Spec 改为只禁止复用已失效上下文，不强制前后端代次一一对应。
  源码：[Project Session service](../../../../../../packages/neuro-book/server/workspace-files/project-session-service.ts) 的 `openProjectControl()` 与精确引用守卫。
- 采纳 Spec 注册表措辞修正：「待实现规范」使用「目标合同」，覆盖 architecture 和 behavior 两种类别。
- 保留客户端隔离要求：它只约束已要求“仅供本客户端恢复”的消费者，防止跨客户端串数据；不因此批准 local/shared 属性或尺寸同步策略。

当前需求均有可扩展归属：主界面 user 布局、插件各自的 user/project/内存状态、后端消费者和独立 grid 实例。
这种架构无需为每个插件增加 scope，也不把布局绑定在 Pinia 或具体磁盘介质上。
不能据此宣称完整服务可直接实现：使用主体/项目/客户端持久身份、读写确认、并发、删除、离线与远端应用时机仍须形成行为合同。

## 验证记录

- `bun run governance:context --work w00003-neurobook-ui-foundation-migration --task t21-storage-design-review --role leader`：通过，身份与实际分支一致，`failures: []`。
- 外部 omp 三轮只读审查均退出 0；前两轮发现已处理，终审建议合并仅架构文档。结论经主 Agent 复核，不能代替运行证据。
- `bun run docs:check`：`failures: []`，检查 5558 份文件。
- 范围内 `git diff --check`：通过，只有仓库 LF/CRLF 提示；14 份本轮文档的本地链接、尾随空白及替换字符检查通过。
- 未运行浏览器或跨设备运行测试；本轮没有可供验证的新 Storage 实现。未把此前的 typecheck/11 项 descriptor 测试当作本轮服务证据。

## 独立复核来源

三轮均以外部 `omp` CLI 执行，只启用 read/grep/glob，无写工具与子代理。
原始输出位于系统 Temp 的 `neuro-book/acceptance/storage-review-20260915/`，未提交原始 CLI 输出。
分别为 `review-output.txt`、`rereview-output.txt`、`final-review-output.txt`；本记录保存必要发现与裁定，不依赖临时文件长期存在。
本文保留主 Agent 采纳与否的判断；子代理结论不替代开发者授权。
