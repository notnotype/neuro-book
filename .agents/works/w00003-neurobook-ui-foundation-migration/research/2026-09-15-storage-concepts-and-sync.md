# Storage：VS Code 概念与 NeuroBook 同步取舍

状态：设计讨论稿。两层作用域等已确定部分见 [ADR 0020](../../../../packages/neuro-book/docs/adr/0020-user-project-storage-boundaries.md)；
本文的同步策略、消费者分配与接口示例是建议，尚未批准或实现。讨论范围限产品 Storage。

2026-09-15 设计审查后，架构边界沉淀到 [storage.boundaries](../../../../docs/specs/storage/boundaries.md)；
未决的服务和同步行为进入 [draft 提案](../../../../docs/proposals/storage-service-and-sync.md)。
本文保留概念对照和候选矩阵，不作为新服务 API 或消费者同步清单的批准依据。

## 结论

Storage 中确实有适合同步与不适合同步的状态。建议保留 `user | project` 两个 scope，
另由模块声明“跨设备共享 / 设备本地”的同步策略。策略由开发者定义，不必做用户逐项勾选界面。
Config 继续采用开发者确定的统一配置同步规则。

## 1. 先分清五个概念

| 概念 | 它回答什么 | 例子 |
|---|---|---|
| Config | 用户希望系统怎样工作 | 默认字体、主题、模型选择、项目配置覆盖 |
| Storage | 模块需要记住什么运行结果 | 布局、展开项、置顶身份、插件的可序列化内部状态 |
| scope | 这份状态归谁、在哪个范围复用 | user 跨项目；project 按项目分别保存 |
| 同步策略 | 这份状态是否在另一设备使用 | 置顶项共享；本地尺寸各设备独立 |
| 内存共享 | 当前运行期间谁需要观察这个值 | 焦点、拖拽、任务状态投影、当前选择 |

Config 和 Storage 都可以有默认值、校验、版本与迁移；这些技术特征不能用于判断归属。
“是否由后端消费”也不能用于判断：后端模块、内置插件同样会有需要记住的状态。
正文、Agent Session、历史与草稿等已有领域数据合同继续由对应模块负责，不全塞入通用 KV。

Config 可以合并“默认 → Global → Project（允许覆盖的字段）”得到有效配置。
Storage 的两层是独立分区，不自动把 User 的同名键继承为 Project 值；模块可以另行定义默认值。

## 2. VS Code 中同名的 scope/target 不在同一个层面

以下源码基准为 `microsoft/vscode@7774b174c378a9d406a6a248ffed33f5e6eb22f5`。
本轮重新下载该提交的 storage.ts、configuration.ts、layout.ts，与上轮下载副本比较，正文一致；
其它引用结合已下载原文复读。属于源码核对，未运行 VS Code 做行为验收。

| VS Code 概念 | 实际含义 | NeuroBook 的映射 |
|---|---|---|
| ConfigurationTarget | 这次写入哪个配置层：USER、WORKSPACE 等；没有 MACHINE 枚举值 | 保留 Global/Project Config |
| ConfigurationScope | 一项设置允许配置在哪些层；这里有 MACHINE、WINDOW 等 | 沿用现有 global-only / 可项目覆盖规则 |
| StorageScope | APPLICATION_SHARED / APPLICATION / PROFILE / WORKSPACE 的归属范围 | 第一版折叠为 user/project |
| StorageTarget | USER 表示跨机器通用，MACHINE 表示机器相关；同步服务消费该标记 | 可借鉴策略区分，不新增 scope |
| Memento | 按 owner 隔离的状态袋，建立在 Storage 上 | 模块/插件自己的逻辑键空间 |
| Context Key | 内存中的条件变量，供 when 等规则求值 | 仅适合简单条件；复杂共享数据交给模块服务/store |

StorageScope 枚举与扩展的 globalState/workspaceState API 都没有 session/window 档位。
有些状态随窗口结束而释放，并不要求增加持久化 scope；桌面窗口几何在 WindowsStateHandler /
IStateService 中保存，也不构成产品 window scope。

特别是 **StorageTarget.USER 不等于“只要标上就一定同步”**。
通常的 Settings Sync / UI State 管线读取 Profile 等被纳入管线的数据，并过滤 USER 标记；
不能据此断言所有 WORKSPACE/USER 数据都走同一条同步管线。
VS Code 的编辑会话迁移是另一功能，本稿不承诺复刻它。

## 3. VS Code 的具体先例

| 状态 | 实际 scope / target | 对 NeuroBook 有用的区别 |
|---|---|---|
| sideBar.size、panel.size、auxiliaryBar.size | PROFILE / MACHINE | 尺寸可跨项目通用，但仍属设备本地 |
| sideBar.hidden、panel.hidden | WORKSPACE / MACHINE | 显隐也可能是项目在当前设备的工作现场 |
| panel.alignment | PROFILE / USER | 布局的一部分可以是跨设备偏好 |
| views.customizations | PROFILE / USER | 视图定制可以共享 |
| 容器内 pane 尺寸/折叠状态 | WORKSPACE / MACHINE | 同一视图容器不一定全部状态都采用相同策略 |
| EditorPart 的 editorpart.state | WORKSPACE / USER memento | 单个 owner 可以保存自己的网格快照；标签不代表普通 Settings Sync 一定处理它 |
| 扩展 globalState / workspaceState | PROFILE / MACHINE、WORKSPACE / MACHINE | 扩展状态各自隔离；globalState 选出的子键另走扩展同步通道 |

主 Workbench 使用分散键，EditorPart 使用序列化 grid 快照；两者都成立。
NeuroBook 可以保存自己的 grid 快照，前提是 owner、scope、恢复与同步边界清楚。

## 4. 哪些状态适合同步：建议矩阵

| 状态 | 建议 scope | 建议处理 | 原因/约束 |
|---|---|---|---|
| 主侧栏/World Engine 的绝对像素尺寸 | user；如要逐项目不同则 project | 设备本地持久化 | 4K 桌面和窄屏对布局的需求不同；使用同一个 grid 原语不决定 scope |
| 桌面窗口坐标、全屏/最大化、显示器选择 | 桌面宿主已有机制 | 设备本地 | 依赖当前显示器；不为此建立产品 window scope |
| 视图位置、用户隐藏偏好、排序 | user（沿用已有布局归属） | 可共享 | 保存明确用户偏好；窄屏自动隐藏是派生结果，不上传 |
| 项目置顶的角色、节点、Agent Session 身份 | project | 可共享 | 使用跨设备可识别的对象身份；缺失对象可忽略但不能误指向别的对象 |
| 文件树展开项、筛选历史 | project | 可共享的候选 | 是否希望跨设备恢复取决于产品体验，不能从“属于项目”自动决定 |
| 打开的 Tab 集合、最近项目、滚动位置、当前活动项 | user 或 project，按对象归属 | 默认设备本地 | 可另做“接续工作”功能；同步到达不应立即替换另一设备正在看的页面 |
| 正在编辑的未保存内容 | 编辑器/草稿数据合同 | 专用恢复和同步流程 | 两台设备的改动必须防覆盖、处理冲突，不能使用普通 KV 的后写覆盖 |
| 本地路径、文件监听游标、缓存有效性标记 | 按模块归属 | 设备本地或可重建缓存 | 另一机器可能没有这些路径/缓存，复制标记会产生错误判断 |
| 焦点、hover、拖拽过程、请求中的状态 | 不属于持久化 scope | 仅内存 | 重启后恢复这些值没有意义 |

“设备本地持久化”仍然会在本设备重启后恢复；它不等于“内存态”。
共享只表示保存的状态可到另一设备使用；远端值何时应用到正在运行的界面，是额外的恢复策略。

## 5. 接口上怎样保持简单

建议由内置模块/插件登记状态定义，宿主验证后提供读写句柄。下面只是元数据示意，不是已实现 API：

```ts
{
    owner: "nbook.world-engine",
    states: {
        layout:      { scope: "user",    sync: "local",  schema: 1 },
        pinnedNodes: { scope: "project", sync: "shared", schema: 1 },
    },
}
```

- scope 只有两个；sync 策略不暴露在普通用户设置中。调用方每次写值不临时切换同步策略。
- 同一个插件可保存用户通用尺寸和按项目的节点状态；无需强迫所有键服从 View 的单个 stateScope。
- 插件使用自己的 `layout`、`pinnedNodes` 等逻辑键。宿主隔离 owner 与 scope，并决定适配层；
  “命名空间隔离”不等于给任意可执行插件建立了安全沙箱。
- grid 持有内存布局；宿主在合适的提交时机保存快照。拖拽每一帧更新内存，持久化可在拖动结束或节流后提交。
- 内置系统与插件消费同一存储合同；Pinia 只承担前端投影，底层文件、数据库、HTTP 都不进入 grid 原语。
- `update` / `write` 的返回值必须明确表示宿主接收、本机持久化还是远端同步完成。VS Code 内部
  saveMemento 是 void，扩展 update 是 Promise；不能把任意 Promise 成功理解成已落盘并完成跨机同步。

可先采用“未声明同步的状态默认设备本地，明确可迁移的键声明共享”的策略，避免无意共享运行现场。
这是建议；尚未把 sync 枚举或默认策略加进运行时代码。

## 6. 同步前必须解决的行为

1. **设备差异**：恢复同步尺寸时夹取到当前视口，不把夹取结果自动上传成新的用户选择，否则两设备会相互覆盖。
2. **同时修改**：独立逻辑键独立提交，避免一台改布局时覆盖另一台的置顶项；同键冲突规则另定。
3. **版本差异**：旧客户端看到新 schema 时保留原值并回退显示；不能上传默认值抹掉新版本状态。
4. **引用身份**：project 的身份要能跨设备对应；本地绝对路径或路径哈希不能直接充当跨设备项目身份。
5. **应用时机**：持久化值同步与正在交互的工作面更新分开；正在拖动或有未提交内容时不能被远端值抢占。
6. **部署方式**：两设备连接同一服务时，shared 可以是一份服务端状态；各自有 State Root 时需要复制通道。
   两种情况下 local 状态都必须留在客户端，或在服务端显式按设备隔离；仅“不上传云端”不足以保证设备隔离。

## 7. 本仓库核对与本轮边界

- w00003 的 Global Config 在 Workspace Root 的 .nbook/config.json，Project Config 在对应项目根的 .nbook/config.json。
  主题是 ui.themeId / ui.appearance / ui.colorwayId / ui.userColorways，原报告引用 master 的 ui.theme 等字段不适用于本分支。
- novel.ide.session 同时存项目编辑器、user-assets 编辑器、currentProjectRoot、选择项、撤销栈；不能全迁 Project。
  “上次打开项目”须先于 Project 上下文读取，应是 User 记忆；未保存正文服从编辑器合同。
- 主 Workbench 左右栏宽度写回 novel.ide.local；World Engine 三个尺寸目前是 ref；没有新的通用 Storage service。
- descriptor 的 stateScope 已收敛为 user/project；Agent Session authority 仍保留。spike 的旧 session 枚举是验证台债务，
  未借这次概念讨论改造验证台或迁移用户数据。
- 本稿替代上轮分析中“非 UI 消费即 Config”“World Engine 全部 Project”“不能存布局快照”等过度推断；
  [omp 原始报告](2026-09-15-vscode-storage-reframe.md)只保留为取证过程，不能直接当规范。
- 尚未实施同步、Storage adapter、浏览器持久化迁移或 World Engine grid 接入。

## 来源

固定提交源码：
- [ConfigurationTarget](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/platform/configuration/common/configuration.ts#L40)
- [ConfigurationScope](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/platform/configuration/common/configurationRegistry.ts#L184)
- [StorageScope / StorageTarget](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/platform/storage/common/storage.ts#L228)
- [LayoutStateKeys](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/workbench/browser/layout.ts#L2860)
- [ViewContainer 状态](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/workbench/services/views/common/viewContainerModel.ts)
- [内部 Memento](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/workbench/common/memento.ts)
- [扩展 Memento](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/workbench/api/common/extHostMemento.ts)
- [扩展 Storage](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/platform/extensionManagement/common/extensionStorage.ts)
- [UI State 同步](https://github.com/microsoft/vscode/blob/7774b174c378a9d406a6a248ffed33f5e6eb22f5/src/vs/platform/userDataSync/common/globalStateSync.ts)
