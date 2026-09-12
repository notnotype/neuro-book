# Workbench 与 View Host 提案

状态：draft

对应 Issue：[#192 建立类 VS Code 的 Workbench 与 View Host 抽象](https://github.com/notnotype/neuro-book/issues/192)（硬前置 #191 主应用 nb-ui 底座迁移）。

## 问题

NeuroBook 的产品 UI 是**固定槽位**：Activity Bar 是写死的 capability 列表（`app/utils/workbench-chrome.ts:12-26`），侧栏、右栏、编辑器区各是一段模板，右栏 Agent 面板与左栏文件树是两套独立实现。结果是三件事都做不了：插件（含内置插件）注册入口、视图在栏间移动、按作用域恢复布局。

现状里唯一接近这套模型的是刚完成的设置外壳：元数据驱动区段 + 受控插槽 + 宿主持有 I/O + `layout: scroll|fill` 合同 + 单一加载形态（`app/components/novel-ide/settings/sections/NovelIdeSettingsView.vue:207-224`、同目录 `.types.ts:17-28`）。它是**单容器、手写注册表**的特例，缺 `location/container`、`factory` 绑定与 descriptor 级错误——这一段距离正是本提案要定义的东西。

## 目标

1. **标题栏**：一个 Titlebar Part，支持自绘与 Electron 原生两种呈现；菜单项来自菜单注册表，不作为 Part 内容。
2. **图标栏**：图标 = View Container 的切换项；左、右各可有一条（右栏即辅助侧栏，自带复合栏）；**内置插件与将来的第三方走同一条注册 API**（WorldEngine、图生文先作为内置插件）。
3. **侧栏**：容器的默认位置决定它落在主侧栏还是右侧栏；容器可在主侧栏 / 右侧栏 / 面板之间移动；位置枚举为将来"浮动窗口"留值。
4. **编辑器区**：`EditorPart`，第一版**单组 + Tab**；状态里带 `editorGroupId`，为分屏预留而不实现。
5. **面板与状态栏**：`PANEL_PART` 支持位置与对齐；状态栏支持位置（**注意：VS Code 的状态栏不可换位置，这是我们的自定义项，规则必须在此定死**）。

## 非目标（第一版明确不做）

- **不开放可执行第三方**（安装账本、权限、沙箱、威胁模型、hostile fixture）：与 #192 非目标一致。descriptor 只放 `factoryKey`，解析走一层间接，将来接第三方运行时**不改 descriptor 格式**。
- **不做编辑器分屏**（多 Editor Group）：Tab 可做，组网格留接口。
- **不重写 resize**：sash 与尺寸计算继续走既有唯一边界（`app/composables/useResizablePanel.ts`，nb-ui `Splitter`）。调研原文：「现有 `useResizablePanel.ts` 继续作为唯一 resize 边界；不要新增第二套面板宽度持久化」（`docs/research/vscode/03-workbench-layout-views.md`）。
- **不把任意组件放进快照**：叶子只持宿主认识的 ref。
- **不把 Dialog / 命令塞进 View 抽象**；不引入 Editor Group/Split、Activity Bar、View Container 的混合抽象。

## 术语与 capability 归属

沿用先行调查的分层（`docs/research/vscode/03-workbench-layout-views.md`，Part 词表以固定 commit 核对过）：

| 术语 | 拥有什么 | 生命周期 |
|---|---|---|
| **Part** | 区域级几何、可见性、位置（Titlebar / ActivityBar / Sidebar / AuxiliaryBar / Panel / Editor / Statusbar） | 随 Workbench 建立与恢复，不因单个视图隐藏而消失 |
| **View Container** | 一组视图的归属，及在图标栏上的一个可切换项（id / 标题 / 图标 / **默认位置**） | 可移动、可恢复；空容器可有独立显示规则 |
| **View** | 一项能力的描述与内容 Pane：自己的可见性、最小尺寸、可动性 | 首次可见时实例化，隐藏不销毁 |
| **PaneView** | 容器内一维 split view 里的可布局 pane | 由容器管理，离开容器时释放 |
| **Editor Part** | 文件、Tab、dirty/save、组（第一版单组） | 与 Project / Session 协同恢复；**不走 View 模型** |
| **Command / Dialog** | 结构化意图入口 / 独立窗口 | 与 View 可见性、Job 状态分开记账 |

**三条分界规则**（照抄调研结论）：

1. 三种拖动是三种意图：拖视图 → ViewContainerModel / ViewDescriptorService；移动整个面板 → Layout/Part；拆分编辑器 → EditorPart。
2. **默认位置 ≠ 实际位置**：descriptor/容器写默认，用户改动记在 descriptor service，两者分开存、分开迁移。
3. **可见性 ≠ 权限**：`when` 只决定显示，执行仍走命令与原 authority。

## descriptor 字段

| 字段 | 语义 | 从设置外壳能否直接长出 |
|---|---|---|
| `id` | 稳定 view id（命名空间化：内置 `nbook.*`，插件 `<publisher>.<name>`） | 是（`SettingsSectionOption.value`） |
| `titleKey` | i18n key，**不存译文** | 部分（现有 `label` 已是解析后的字符串） |
| `icon` | 图标 token/class，只表达展示 | 是（`iconClass`） |
| `container` | 所属容器 id | 否（现有只有 `scopes`） |
| `layout` | `scroll`（外壳给内边距并拥有滚动）/ `fill`（自己占满、内部滚动） | 是 |
| `when` | **结构化谓词**（宿主可校验、可解释、可列出原因），非字符串表达式 | 部分（`scopes` 可贡献粗粒度项） |
| `order` / `weight` | 同容器内顺序与初始尺寸权重 | 否（新增） |
| `canToggleVisibility` / `canMoveView` | 用户可否隐藏 / 可否跨容器移动 | 否（新增） |
| `factoryKey` | 第一方解析键；解析器是一层间接 | 否（现在靠模板 `v-if` 分支，`NovelIdeSettingsDialog.vue` 的插槽分支） |
| `stateScope` / `requiredAuthority` | 恢复范围与所需 authority（防止 descriptor 越界） | 部分（现有写回 `scope`/`query` 是另一回事） |

## 位置与排布

**位置枚举**（容器的默认位置；实际位置另存）：`sidebar-left` | `sidebar-right` | `panel` | `window`（第一版不实现 `window`，只在枚举里保留）。

**面板的两种排布**都需要支持，它们是同一属性的两个取值（**对齐**）：

```
(a) 面板横跨全宽               (b) 面板只在编辑器下（嵌套）
    左 | 编辑器 | 右               左 | 编辑器 | 右
    ───────────────                |──────|
         面板                      | 面板 |
```

**实现取向（本提案的核心决定）**：不做「固定骨架 + 特例分支」，而是建一个**可序列化拆分树**原语，两种排布只是同一棵树上叶子的不同父节点。

## 基础原语：可序列化拆分树（SerializableGrid）

**放哪**：nb-ui（领域无关的布局原语，与 nb-ui `Splitter` 同层），因为它被两处复用——Workbench 外壳（Part 排布）与将来的 `EditorPart`（编辑器组）。这也是 VS Code 的分层：该原语在 `vs/base/browser/ui/grid`，不在 workbench 内。

**三条硬约束**：

1. **不拥有 resize**：sash 与尺寸计算委托既有唯一边界；本原语只负责「树 + 尺寸约束传播 + 序列化」。
2. **不装组件**：叶子只持宿主认识的 ref。
3. **不拥有持久化键**：格式共享，键分开（见下节）。

```ts
type GridOrientation = "horizontal" | "vertical";
type GridLeaf<T>   = {kind: "leaf";   id: string; ref: T; minimumSize: number; maximumSize: number; size: number};
type GridBranch     = {kind: "branch"; id: string; orientation: GridOrientation; children: GridNode<T>[]};
type GridNode<T>    = GridLeaf<T> | GridBranch;
type GridSnapshot   = {version: 1; root: GridNode<{ref: string}>};   // 只存 ref 与尺寸
```

操作：`addLeaf(parentId, index, leaf)`、`removeLeaf(id)`、`moveLeaf(id, parentId, index)`、`resize(id, delta)`、`serialize()`、`restore(snapshot, resolveRef)`、`layout()`。

**必须有不变量测试**（这类组件最容易悄悄坏的地方）：

- 尺寸夹取在 add / move / resize 三处都生效；
- 删掉分支里最后一个叶子时，空分支要塌掉（否则快照会堆积空节点）；
- 恢复遇到未知 ref（插件卸载、视图移除）→ 丢弃该叶子并给出可诊断 issue，而不是整树作废；
- 版本不认识 → 回默认 + 说明原因；
- 快照中不出现任何组件/描述符字段（用一条断言锁住）。

**验证方式**：原语自带单元测试 + 一个 Lab 演示（固定骨架、拖 sash、把一个叶子从「编辑器内」移到「全宽」、序列化→重挂→恢复、注入损坏快照）。Lab 演示取代先前的临时探针：它证明的是承重件而非外观。

## 状态分层与持久化键

| 层级 | 内容 | 现有事实 | 本提案取向 |
|---|---|---|---|
| **用户级** | Part 尺寸与可见性、容器位置与顺序、视图隐藏偏好、设置窗口尺寸 | `novel.ide.local`（`app/stores/novel-ide.ts:1988-2030`）、`nbook.settingsDialog.size` | 新增 `workbench.layout`（版本化快照）；容器/视图自定义位置单独一键（对齐 VS Code 的 `views.customizations`） |
| **项目级** | 编辑器 Tab/缓冲、选中文件与视图、每个 Project 的恢复目标 | `novel.ide.session` 按 `novel:${projectRoot}` 分区（`novel-ide.ts:317-326, 420-455`） | 沿用既有分区键，不与用户级混写 |
| **Session / 页面级** | 当前活动视图、临时展开态、Dialog 开关 | 组件内 ref | 页面销毁即释放；不跨 Project 恢复运行时实例 |
| **视图自身** | 展开项、筛选等 | 无 | 按视图 id 的 memento（第一版可暂缓，但键的形态要定） |
| **领域数据** | Project 文件、Session、Job、Trace | 各自 authority | **不进布局快照** |

## 第一版范围

| 项 | 判断 | 理由 |
|---|---|---|
| 注册表 + `when` 求值 + 懒实例化 | **现在做** | 后加会改公共契约 |
| 位置层（默认 vs 实际）+ 位置枚举 | **现在做** | 已决定"允许移动"，晚做要重写快照 |
| 可序列化拆分树原语 | **现在做** | 面板两种排布与将来的编辑器分屏共用 |
| 三层状态分离 | **现在做** | 混了以后是数据事故 |
| Tab（单组）+ 状态带 `editorGroupId` | **现在做** | 日常必需；状态里带组 id 避免以后迁移 |
| 内置插件注册路径（L1） | **现在做** | 有明确用例（WorldEngine、图生文） |
| 编辑器分屏（多组） | 以后做 | 价值靠后、代价最高、贴近数据 authority |
| 任意拖放重排（把面板拖到任意边） | 以后做 | 位置属性写对了就不返工 |
| 浮动窗口 | 以后做 | 枚举留值 |
| 可执行第三方运行时（L3） | 别做（本阶段） | 需独立任务；无需求依赖 |

## 迁移顺序与删除门禁

1. **阶段 0**：只登记边界（本提案 → 获批 Spec → Task），不改消费者。
2. **阶段 1**：原语 + 单元测试 + Lab 演示；外壳接入但保留现有槽位，不删除任何固定入口。
3. **阶段 2**：第一批消费者 `files`（验证 descriptor → 容器 → 既有 Project/文件 authority）。
4. **阶段 3**：`characters`（验证 Project generation、dirty flush、Project 切换与恢复）。
5. **阶段 4**：`plot`（保持左侧 View 与 Plot 专用 Dialog 分开，共享 Project/Markdown authority）。
6. **阶段 5**：命令与只读描述快照桥接（后置，不与首批 View 混做）。

**每个消费者的删除条件**（全部满足才可删旧槽位，不留兼容别名）：

- 入口闭环：Activity、Tab、命令、深链接都已唯一走新路径；
- 行为等价证据：打开、关闭、选中、尺寸、Project 切换、恢复、失败都在真实 Workbench 观察过；
- 生命周期安全：组件销毁、隐藏、Project generation 变化后旧异步结果不发布到新视图；factory 错误不拖垮其他视图；
- owner 已迁移：布局与尺寸进宿主，数据副作用仍回原 authority；
- 单 Editor Group 不变；若迁移要求分屏或新 Character 合同，停回 Proposal。

## 真相源检查点

| 检查点 | 迁移时必须保持 |
|---|---|
| 保存 / dirty flush | 视图只发意图；写入、dirty、save/discard 仍归 Editor Part / Project Session；切 Project 不得绕过 flush |
| Session | JSONL/Attachment 仍是 durable truth，视图只订阅投影 |
| Job | Job 与取消仍归 Agent Job Manager；视图隐藏不等于取消失败，也不替 Job 背书成功 |
| Project 文件 / History | Project generation 与记账仍由既有 authority 持有；视图不持 raw Project root |
| 布局 / 尺寸 | 所有尺寸继续经唯一 resize 边界；不建第二套 |
| 异步 stale guard | Project revision / Session ready revision 变化时，旧结果标记为 superseded，不写当前视图 |

## 已决取舍

- **容器可移动**：允许 View 在既定容器间移动（因此位置层与快照格式**必须第一天就在**）。
- **factory 开放性**：descriptor 只放 `factoryKey`，第一版解析器为第一方（内置插件同路）；接第三方时不改 descriptor 格式。
- **活动视图恢复层级**：保留现有用户级行为（`novel.ide.activeLeftTab` 一类），本期不改既有用户数据。
- **嵌套排布**：采用可序列化拆分树原语，而非固定骨架 + 特例分支。

## 开放问题

1. **`titleKey` 解析位置**：注册表统一解析，还是宿主渲染时解析？（建议：注册表存 key，宿主解析，落 one resolver。）
2. **`when` 谓词形态**：结构化谓词的第一版字段取舍（`requires` 枚举 vs 表达式 AST）。（建议：先枚举，够用再扩。）
3. **descriptor 级错误**：factory 失败、恢复目标缺失、context 不可用是否统一进 view 级 issue + 重试？（建议：是，且与"外壳级 loading/error"分开。）
4. **状态栏位置**：VS Code 无此能力，我们的规则（顶/底、与面板冲突时的优先级）需要单独定。
5. **面板对齐的默认值**与「切 Project 是否重置面板位置」。

## 证据与边界

- 本提案的分层结论来自 `packages/neuro-book/docs/research/vscode/03-workbench-layout-views.md`（Part 词表与四层状态分层以固定 commit 核对；**真实拖拽与重启恢复在该调研中未验证**）与 `08`/`12`/`15` 三份。
- 现有代码结论（写死的 activity union、设置外壳的元数据驱动与受控插槽、布局状态三处分散）来自本次设计门侦察，逐条带 `文件:行号`。
- 本文是**提案**，不是已生效 Spec；获批后需登记唯一 `planned` capability Spec，实现 Task 才可创建。实现被 #191 阻塞。
