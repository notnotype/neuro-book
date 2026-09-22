# 前端领域规范

适用：`app/**` 以及 VitePress 主题中的 Vue、HTML、CSS 和客户端交互。通用与语言规则由 [`README.md`](README.md) 路由；只有 `app/**` 追加最近的 `app/AGENTS.md`。

## Vue 与交互

- 使用 Composition API 和仓库现有函数式风格；props、emits、slot 与 template ref 保持类型完整。派生状态用 `computed`，`watch` 只承载副作用并负责停止订阅、计时器和请求。
- 通用能力优先复用现有组件、错误映射、通知和面板工具；具体入口由最近的作用域 `AGENTS.md` 登记。
- 交互控件使用语义 HTML、键盘可达名称、正确的 disabled/focus 状态；图标按钮提供可访问名称或 Tooltip。用户文字面向第一次使用 NeuroBook 的普通作者。
- 列表 key 来自稳定实体身份。昂贵派生不在 template 重复调用；布局尺寸使用稳定约束，避免加载、hover 或长文本造成跳动和遮挡。
- `.vue` 单文件组件达到或超过 800 行是硬审查线。新增职责前按稳定边界拆出组件、composable、store 或领域模块。

## CSS 与主题

- 普通界面颜色只消费 `app/utils/theme/README.md` 登记的语义变量；新增变量同步主题文档与全部内置主题。
- 决定某块区域用玻璃、实心还是不给面时，判据在 [`packages/nb-ui/docs/ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) 第 2 节，取舍理由在 [`packages/nb-ui/docs/design-language.md`](../../../packages/nb-ui/docs/design-language.md)。这两份规范此前只从 nb-ui 内部路由得到，主应用侧改样式的人找不到，材料语言因此被逐页重新发明过。
- 样式由组件或语义 class 拥有，保持低特异性；动画尊重 reduced motion，文本、焦点环和状态色保持可辨识。
- 固定格式控件、面板或网格使用 `min/max`、grid track、`aspect-ratio` 等稳定约束；长文本必须换行或动态收敛，不遮挡相邻内容。

## 客户端持久化与存储分层

职责、归属、同步边界和版本恢复的唯一架构合同见 [Storage 架构规范](../../specs/storage/boundaries.md)（planned）；
初始化、生命周期、保存反馈与磁盘落点见 [持久化行为规范](../../specs/storage/persistence.md)；
取舍依据见 [ADR 0021](../../../packages/neuro-book/docs/adr/0021-local-storage-persistence.md)。
本节保留前端消费入口与存量债务；新的通用 Storage service 和数据迁移尚未实现。

### 前端接入

- 新状态先按架构规范确定 Config / Storage / 内存 / 领域数据归属，再声明 owner 与恢复合同；不以 Pinia 或浏览器介质反推归属。
- 禁止新增组件内裸 `localStorage` / `sessionStorage` 读写。现有消费者迁移时由宿主统一接入，Pinia 承担前端投影。
- Project 上下文必须明确有效；用户资产工作区残留的上次项目路径不能拿来选 Storage 分区。
- UI 回落默认、过滤未知引用和夹取尺寸时，按架构规范保留原记录，避免 watch 自动保存回退结果。
- grid 只消费内存布局及快照；组件不得自行建立同步通道。Component Lab / Playground 继续使用独立开发环境前缀。

### 存量迁移方向

下表是已识别的主要入口；仅登记目标，不声称已完成迁移。

| 现状 | 归属与迁移方向 |
|---|---|
| `novel.ide.local` 的主工作台左右尺寸 | Project/local 分别记忆；无项目和用户资产使用显式 User/local；旧全局值不批量复制给每个项目 |
| `novel.ide.local` 的编辑器偏好 | 核对现有 `editor.markdown` / `editor.monaco` Config 投影，消除持久化权威副本 |
| `novel.ide.session` 的 `workspaceSessions` | 拆分项目编辑器与 `user-assets` 编辑器恢复态；未保存正文按编辑器合同处理 |
| `novel.ide.session` 的 `currentProjectRoot` | 当前值是内存事实；需要记住“上次打开哪个项目”时归 User Storage |
| `novel.ide.session` 的选择项和 `detailUndoStacks` | 项目内选择需要恢复时归 Project Storage；撤销栈按编辑器合同决定保留和失效 |
| `nbook.settingsDialog.size`、`nbook.projectCreateDialog.size.v2` | User Storage 的对话框布局状态 |
| `nbook.locale` | 语言作为 Global Config 设置；字段接入仍待迁移 |
| `nbook.costDisplay.usdToCnyRate` | 汇率缓存，注明来源与有效期；持久化缓存或纯内存由缓存需求决定 |
| `agent:pinned-sessions:*`、`agent:last-session:*`、`agent:inline-editor-session:*` | 保存身份记忆；项目入口归 Project，用户资产入口归 User；继续校验 sessionIdentity，不是 Session 本身 |
| World Engine 的尺寸 ref | 目标为 Project/local；按项目分别记忆，由宿主接入，尚未迁移 |

### 待细化

本地阶段、身份分区与恢复已在 [持久化行为规范](../../specs/storage/persistence.md) 固定，
首批顺序见 [迁移合同](../../../packages/neuro-book/docs/migrations/storage-state.md)。
跨独立 data 的在线同步、缓存失效及未列入首批的消费者继续独立设计，不能借本次迁移整桶搬走领域恢复数据。

## 验证

前端改动说明桌面和窄屏影响。逻辑测试、类型检查和浏览器验收分别报告；用户可见交互或布局变化必须运行真实页面并留下可观察证据。

完成标准：目标桌面与窄屏视口均可完成受影响流程，键盘与焦点路径可用，主题和长文本不会产生溢出或布局跳动。
