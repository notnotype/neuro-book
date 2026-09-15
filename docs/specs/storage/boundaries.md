---
schema: nbook.spec/v1
kind: architecture
status: planned
capability: storage.boundaries
owners:
  - ui
  - server
---

# Storage 的职责、归属与消费边界

## 目标与成熟度

为主 Workbench、内置插件和服务端模块提供共同的状态归属规则，使布局、插件内部记忆和运行时共享状态
各有明确 owner。主应用 UI 模块负责前端宿主与状态投影，server 模块负责服务端宿主与持久化访问边界；
Project / Workspace 模块负责项目身份与生命周期。数据内容及其格式由消费模块拥有，nb-ui 只拥有布局原语。

本文件是架构合同，规定后续 Storage 能力必须维持的边界；`planned` 不表示新的 Storage service 已实现。
初始化、身份映射、条件读写、持久化确认、生命周期、备份与恢复见 [storage.persistence](persistence.md)（planned）。
跨独立 data 的在线复制仍由 [同步提案](../../proposals/storage-service-and-sync.md) 继续设计。
命令系统、第三方可执行插件沙箱和领域数据同步不在本能力中。

## Config、Storage、内存与领域数据

| 类别 | 负责的内容 | 归属规则 |
|---|---|---|
| Config | 用户设置与运行策略，例如主题、默认字体、模型选择 | Global Config 与 Project Config；沿用字段覆盖权限及有效配置解析 |
| Storage | 模块运行后需要记住的状态，例如尺寸、展开项、对象身份记忆、插件内部可序列化状态 | user / project 独立分区；模块拥有自己的逻辑键 |
| 内存共享 | 当前运行期间需要观察的状态，例如焦点、拖拽、选择、请求进度 | 模块服务、非持久化 store 或由宿主显式提供的上下文对象；生命周期由 owner 管理 |
| 领域数据 | 正文、未保存内容、草稿、Agent Session、Job、历史等 | 沿用对应领域的保存、恢复、并发与权限合同 |

默认值、schema、校验、迁移和是否被服务端读取都不能单独决定 Config / Storage 归属。
例如插件的内部记忆可以属于 Storage；可重放 Job 的进度仍由 Job owner 负责。
上下文对象在此仅指宿主显式提供、管理生命周期的内存访问入口，不规定具体 API。
供按钮显隐等条件求值使用的键值投影（VS Code 称 Context Key）也属于内存；复杂共享数据不必转成这种投影。
是否引入统一的 Context Key 服务由其它能力决定。

Config 保持 Global / Project 两层，Global 位于 Workspace Root 的 `.nbook/config.json`，
Project 位于 Project Workspace Root 的 `.nbook/config.json`。Global-only 字段仍不能由 Project 覆盖。
配置统一跨设备同步是已确定目标，不引入逐配置项同步选择或机器排除策略；这不改变配置原有生效时机，
也不证明当前已存在同步通道。配置解析及具体字段合同不由通用 Storage 替代。

## 作用域与身份

### 两层独立分区

- `user`：同一使用主体跨 Project 使用的状态；读取不以打开 Project 为前提。
- `project`：在明确的 Project 上下文中分别保存的状态。
- 两层同名键不隐式继承或合并。切换 Project 是切换分区；正常关闭或切换不能删除旧分区。
- 不提供 session/window Storage scope。非持久化共享状态仍可随组件、窗口或任务结束而释放。
  Agent Session 的领域身份不受本项影响。

scope 表达归属，不表示保存介质、设备范围或访问权限。`project` 尤其不等于所有用户可共享读写。
宿主必须明确绑定使用主体及所在服务/Workspace 的身份域；不同身份域内同名的用户、项目或路径不能自动合并。
登录与无鉴权主体、身份域和客户端的映射按 [持久化合同](persistence.md#身份与访问上下文)，不创建新的账号体系。

### Project 上下文与生命周期

- Project 分区由宿主根据 Project 生命周期模块发布的、仍有效的已就绪上下文提供。
  “已就绪”意味着已经完成该模块的打开门禁，并持有其发布的有效代次标识；不能仅凭路径相同复用已失效的上下文。
  消费者不得自行把目录名、标题或任意字符串当作授权，不能用 Storage 读取隐式打开 Project。
- 用户资产工作区和“未打开项目”的界面没有可隐式使用的 Project 上下文。
  即使内存还保留上次 `currentProjectRoot`，也不能据此获得 Project Storage；缺失上下文必须明确拒绝，不能落到上个 Project 或偷偷改用 User 分区。
- 后台操作可以持有其显式绑定的 Project 上下文，不必依赖前台当前选择。异步读写和订阅必须保留原目标：
  从 A 切到 B 后，A 的迟到结果不能显示为 B 的数据，A 的写入不能重新路由到 B。
  生命周期撤销上下文后，拒绝接纳以该上下文发起的新操作；已接纳操作如何完成、取消或排空沿用 Project owner 的生命周期边界，
  Storage 行为合同必须明确其接线与结果，不把前台离开等同于全局关闭 Project。
- 同名目录、同路径删除后重建、不同服务下的同名项目不能仅凭路径相同继承旧记录。
  首期以项目内目录携带记录，移动、复制、恢复与删除规则按 [持久化合同](persistence.md)；Storage 不因读取失败清理记录。
- 本机定位器与跨设备身份必须区分。当前 `ProjectWorkspaceKey` 是进程内 Symbol，路径哈希依赖 Workspace Root；
  两者不能直接序列化为跨设备 Storage 身份。新的身份映射由 Project 边界负责，不能由每个插件各造一套。

前端上下文就绪与失效的已有依据是 [ADR 0007](../../../packages/neuro-book/docs/adr/0007-project-close-then-open.md)：
匹配目标的 open / presence 就绪后发布代次，界面提交还要通过相应工作面门禁；用户资产工作面不能借用残留项目上下文。
服务端已有就绪代次引用与关闭时拒绝新操作的边界，源码依据见 [审查记录](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t21-storage-design-review/walkthroughs/001-storage-review.md)。
这些门禁与 Storage 持久身份承担不同职责。首期 Storage 所需的目录携带、代次、关闭与删除合同已在
[持久化规范](persistence.md) 收敛；完整 Project 领域生命周期仍见 [规范缺口](../README.md#规范缺口)。

## scope 不决定同步

scope 不能自行启用或禁止同步。首期状态定义另带 `local/shared`（默认 local），其客户端分区、物理落点与备份采用规则
由 [持久化合同](persistence.md) 固定；两者都不表示已存在跨独立 data 的同步通道。
未来同步也不能授予访问其它用户或其它 owner 数据的权限。

凡消费者合同要求“仅供本客户端恢复”的状态，即使两台设备连接同一个服务也必须隔离。若放在服务端，必须具有明确且可验证的客户端分区；
在该身份机制建立前不能把现有本地记录迁入无客户端区分的公共记录。
“不上传云端”、服务器 hostname 或一个全局文件名都不足以满足此约束。

保存值的同步与当前界面的应用时机分开。同步到达不能直接抢占拖拽、焦点或未提交编辑；
消费者按持久化合同分别维护已确认值、当前显示和本地意图，明确何时恢复。
服务端接收、本地持久化和远端确认是不同事实，后续接口不得以含混的“保存成功”混为一谈。

## 模块与插件消费边界

- 宿主提供按 owner 隔离的逻辑键空间，并选择适配层。一个 owner 可以同时拥有 user、project 和内存状态。
  View 的单个 `stateScope` 只描述该视图的默认记忆归属，不能限制整个插件的所有状态。
- 状态定义须明确 owner、逻辑键、schema、scope 和恢复行为。调用方不能在一次普通写入中临时改变归属。
  修改归属需要评估旧记录的迁移和保留；未来若引入同步策略，改变策略也必须经过相应兼容评估。
- 内置系统、插件及服务端模块遵守同一归属合同；不要求后端依赖 Pinia，也不要求前端直接操作文件或数据库。
  Pinia 可以承接内存投影，持久化 authority 只能有一处。
- 跨组件共享应由其 owner 的服务或状态投影提供；跨 owner 共享通过明确的模块接口，不能依靠猜测别人的键名。
- 组件不直接新增裸 `localStorage` / `sessionStorage` 读写。宿主的持久化适配层可以封装这些介质。
- 命名空间隔离是数据边界，不等于任意可执行插件的安全沙箱；第三方运行时需要另有权限合同。
- Component Lab / Playground 的 fixture 与偏好保持开发环境隔离，不读写产品 Config / Storage。

## grid 复用与状态所有权

主界面与 World Engine 等视图可以复用 nb-ui 的拆分树、尺寸约束、序列化和 resize 基础能力。
每个宿主持有独立 grid 实例、自己的节点引用及状态，插件不依赖主外壳固定的 Part 名或尺寸公式。
某个插件即使使用了与主界面同名的叶节点，也不能因节点重名覆盖主布局。

grid 原语只计算布局和处理快照，不拥有 Storage 键、Project 身份、同步、Vue store 或存储介质。
宿主负责将用户提交的布局送到持久化边界，并向 grid 提供可恢复的状态。
高频拖拽更新内存；持久化提交时机由消费者合同规定，不能仅凭每帧几何变化产生跨设备写入。

同一个 owner 可以保存完整 grid 快照；无需为了模仿 VS Code 主布局而强制拆成每叶一键。
但不同 owner、scope 的状态必须可独立寻址，不能作为一个不加区分的记录覆盖。
若未来同步布局结构而保留设备本地尺寸，需先定义二者的组合与一致性合同，不能直接复制整份含尺寸快照。

主工作台与 World Engine 尺寸按开发者新决定归 project/local；未开项目和用户资产使用显式 user/local 记录，
具体归属矩阵见 [持久化规范](persistence.md#数据归属与首批消费者)。World Engine 当前仍是内存 ref，尚未接入。
最小嵌套场景的必要原语修复与验收由 [ui.nested-grid](../ui/nested-grid.md) 规定；其它未覆盖结构操作仍保留已有限制。

## 版本、恢复与迁移不变量

- 持久化状态具有明确 schema 版本；已有格式的版本字段可以复用，不强制重复包装。
- 缺失、损坏、不支持的版本与读取失败必须能区分。UI 可回落安全默认并给出诊断，不能把读取失败当作空记录创建写回。
- 未知更高版本的原记录须保留。回落显示不赋予普通自动保存覆盖原记录的权利；有效迁移或用户显式重置才能替换相应记录。
- 视口夹取、临时隐藏、缺少插件导致的引用过滤是当前呈现结果，不能因此自动覆盖保存的用户选择。
  快照解析时丢弃未知引用不等于删除持久化原件。显式新编辑如何与保留状态合成，由对应消费者合同固定。
- 切换上下文、卸载组件或暂时禁用插件不等于删除持久化数据。订阅和内存对象仍须按生命周期释放。
- 旧键迁移要先分清 Config、Storage、内存与领域恢复数据，再验证目标写入。
  `novel.ide.session` 包含项目与用户资产编辑器等不同内容，不能整桶改名、清空或全部放进 Project Storage。
  迁移期间同一逻辑数据只有一个写入 authority；格式不兼容时不得静默双写。

## 架构验收

本阶段以消费者推演和依赖审查核对以下约束。后续行为 Spec 须把相关场景转为合同测试与宿主 smoke；
本文件不将这些未来场景标记为已运行：

| 场景 | 必须保持的结果 |
|---|---|
| 未打开 Project，恢复主侧栏尺寸 | 可以使用 user 分区；不能为此伪造 Project |
| 从项目 A 切 B，再回 A | 使用各自记忆，普通切换不删除 A |
| A 有未结束请求，此时打开用户资产或 B | 不隐式使用残留 A 路径；迟到读写不污染新目标 |
| 两个 Workspace 中存在同名项目，或原目录被替换 | 不凭单段路径合并分区或继承记录 |
| 两台客户端连接同一服务器，保存设备本地状态 | 两者互不覆盖；无客户端身份时禁止落公共服务端记录 |
| 同一插件使用用户尺寸、项目对象记忆、内存焦点 | 三者可共存，焦点不进入持久化 |
| 主 grid 与插件 grid 使用同名叶引用 | 两个实例及快照独立；调整插件不写主布局 |
| 窄视口夹取尺寸、插件暂时缺失、旧客户端读到新版本 | 显示可恢复，原记录不因回退而被自动重写 |
| 未来为某条 Project 状态启用同步 | 不获得其它用户或 owner 权限；未满足同步行为合同不启用复制 |

## 证据与后续合同

- 批准依据：[ADR 0020](../../../packages/neuro-book/docs/adr/0020-user-project-storage-boundaries.md) 记录开发者已确定的职责与两层作用域。
  2026-09-15 开发者追加授权“先审查设计，符合当前需求且具有扩展性后落 spec”；
  [审查记录](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t21-storage-design-review/walkthroughs/001-storage-review.md) 记录本文件的审查范围与结论。
- [VS Code 概念与源码对照](../../../.agents/works/w00003-neurobook-ui-foundation-migration/research/2026-09-15-storage-concepts-and-sync.md) 是研究依据，不替代本规范。
- [ADR 0021](../../../packages/neuro-book/docs/adr/0021-local-storage-persistence.md) 与 [storage.persistence](persistence.md)
  收敛首期本地行为；[同步提案](../../proposals/storage-service-and-sync.md) 保留未来在线复制设计。
  本架构 Spec 和新增 planned 行为规范均不表示运行时已经实现。
