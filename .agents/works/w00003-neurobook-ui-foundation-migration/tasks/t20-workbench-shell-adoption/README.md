---
schema: nbook.task/v2
taskId: t20-workbench-shell-adoption
role: tasker
---

# Workbench 外壳接入（阶段 1）

> **状态：尚未开工（pending）**。本 Task 只登记目标、范围、批次与验收，正文不含任何已实施的改动；开工前由 Leader 指派执行者，执行时先读本文链接的 `planned` Spec 与已批准提案。

## 目标

把已在 `/workbench-spike` 验证过的 view 模型接入主应用外壳：标题栏、图标栏（活动栏）、主侧栏、右侧栏、编辑器区、面板与状态栏按已批准的 [`workbench-view-host.md`](../../../../../packages/neuro-book/docs/proposals/workbench-view-host.md) 渲染；**保留现有固定槽位与旧入口，不删任何东西**——提案阶段 1 的原文口径是「外壳接入但**保留现有槽位**，不删任何固定入口」。

主题与组件接入沿用现有 nb-ui 通道（已实现）：宿主上的角色变量桥接（`app/styles/theme-vars.css`）与浮层的显式 portal 宿主，不新增第二套通道。

## 已批准决策（引用，不重新发明）

- 提案 2026-09-13 获批（`accepted`）：13 条开放问题与遗留设计项已逐条定夺（`titleKey` 由宿主解析、`when` 用枚举数组、descriptor 级错误进 view 级 issue、状态栏固定底部、面板对齐默认 `justify`、`layout(sizes)` 后反算逻辑尺寸；`containerPlacements`、`defaultRevision`、`deserializeLayout`、`hiddenViews`、`ViewRenderModel` 全做；「分支 sash 不可拖」与「移动单向性」为第一版已知限制）。
- 阶段 1 定义（提案「迁移顺序与删除门禁」）：原语 + 测试矩阵 + 新 Lab 验证台；外壳接入但保留现有槽位。**前半已闭合**：原语 `packages/nb-ui/src/components/layout/grid.ts` 单测 13/13；验证台 `app/pages/workbench-spike.vue` + `app/components/workbench-spike/` 四条验收全绿。本 Task 做后半。
- #192 门禁「Proposal 获批并登记唯一 `planned` capability Spec 后，才创建实现 Task」：提案已获批，Spec 已登记为 [`docs/specs/ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)（`capability: ui.workbench-shell`），本 Task 引用它。

## 范围与不做的

**做**：

- 外壳结构（标题栏、图标栏、主侧栏、右侧栏、编辑器区、面板、状态栏）按提案的位置模型落到主页面；
- 图标栏容器切换与选中态、侧栏收起/展开、面板呈现、状态栏摘要；
- 外壳几何与可见性进版本化布局快照，恢复语义与尺寸夹取一致；
- 现有入口（文件树、角色、情节、设置、Agent、历史、World Engine 等）**以今天的实现形态**挂在新外壳里。

**不做**（本 Task 明确排除）：

- 阶段 2–5 的消费者迁移：`files` / `characters` / `plot` 逐个切 descriptor、L1 内置插件注册路径、命令与只读描述快照桥接；
- 不删固定槽位、不删旧组件（`app/components/common/Dialog.vue` 等）、不删旧状态字段；
- 不改数据 authority：Project 文件、Session、Job、Trace、dirty/save 仍归原 owner；
- 编辑器分屏、L3 可执行第三方、跨窗口浮动、状态栏换位；
- 第二套 resize 边界或第二套布局存储。

## 批次拆分建议（每批可在两周内闭合）

| 批次 | 内容 | 验收 | 回退点 |
|---|---|---|---|
| 1 标题栏与图标栏 | 写死的图标栏列表换成 descriptor 驱动的图标项（容器项 / 命令项分类）；标题栏拥有自绘 chrome 的布局 | 点击容器项切换并落选中态；命令项仍打开原入口；外观与现状等价 | 撤下接入层，恢复写死列表（旧槽位未删） |
| 2 侧栏容器 | 主侧栏 / 右侧栏按容器渲染视图行，现有视图原样承载 | 左右栏容器切换与收起/展开；现有入口行为不变 | 同批撤下容器层，回到现有左右栏模板 |
| 3 面板与状态栏 | 面板 Part（位置/对齐按提案，第一版默认 `justify`）与状态栏两段 | 面板显示/隐藏与现状等价；状态栏信息与现状等价 | 面板回到现有模板 |
| 4 外壳接线保持槽位 | 前三个批次接进主页面根；布局快照读写收敛到唯一入口（安全解析 + 宿主 load/save 适配） | 全量回归（见验收条件） | 整批 revert 回当前页面根（旧槽位完整保留） |

- 每批独立提交、独立验证；批次之间不互相引用未落地的中间态；
- 任何一批出现回归都只撤该批；「旧槽位未删」就是各批的天然回退路径。

## 验收条件

- **布局等价**：外壳渲染出与现状等价的布局（区域顺序、相对位置；无双重边框 / 双重标题条 / 双重标签条）。
- **现有入口全部仍在且可用**：文件树、角色、情节、设置、Agent 面板与侧栏、历史、World Engine 等入口的打开、切换、关闭与接入前一致；没有任何入口被移除或降级为占位。
- **主题跟随**（含浅/深色对照）：外壳与其中浮层的颜色来自主题宿主；非 sepia 主题下不出现 sepia 兜底底色（对照 `acdc627b` 的实测口径）。
- **原语与验证台的既有验收不回退**：`bun run --cwd packages/nb-ui test` 通过（最近基线 279）；验证台浏览器验收不回退（最近实测 34 条断言全部通过，2026-09-14）；`/workbench-spike` 四条交互验收逐条复核。
- **窄屏与桌面两种 surface**：`390 × 844` 与桌面宽度下核心操作可完成，无页面级横向滚动。
- **布局恢复**：改尺寸 / 收起 → 重新进入恢复；快照版本不符 / 未知引用 / 非法尺寸 → 按 Spec 的失败合同回落并逐条给诊断。

## 依赖与前置

- 提案 `packages/neuro-book/docs/proposals/workbench-view-host.md` 已 `accepted`（2026-09-13）；
- `planned` Spec `docs/specs/ui/workbench-shell.md` 已登记（本次创建，`capability: ui.workbench-shell`）；
- 原语与验证台已就绪（`packages/nb-ui/src/components/layout/grid.ts`，13/13；`app/pages/workbench-spike.vue`，Source Dev only）；
- **#191 剩余项的关系**：旧弹窗清零（`app/components/common/Dialog.vue` 的 10 个冻结窗口 + `useDialog.ts` 命令式服务，见 t19 的 D5/D6/D7）与主题 authority 任务属 #191 的迁移线，**不阻塞本 Task**——阶段 1 不删任何入口，两者可并行；但阶段 2+ 的删除门禁（入口闭环、行为等价证据）依赖 #191 那条线继续收敛，本 Task 不得提前删除任何将被 #191 处置的入口。
- 未决但不阻塞：浮层默认宿主是否改为「宿主上下文」（提案 `docs/proposals/nb-ui-overlay-portal-host.md`，`draft`）。若获批并落地，本阶段新接入的工厂与浮动容器直接受益；未获批时按现有「显式宿主」纪律执行，不阻塞开工。

## 事实基准

- 阶段 1 前半（已闭合）：原语单测 13/13；验证台四条验收（观感像工作台、sash 可发现可拖、视图跨容器拖拽、活动栏切换与侧栏收起）实测通过；相关提交 `9806c7bb`…`c0b5b316`。
- 基线数字：nb-ui 单测 279；验证台浏览器断言 34/34（最近一轮实测）。
- 外壳现状（写死槽位与散落的布局状态）：见提案「问题」节——`app/utils/workbench-chrome.ts:12-26` 的写死 activity 列表、`app/stores/novel-ide.ts` 的 `novel.ide.local` / `novel.ide.session`、`app/pages/index.vue` 的页面级 ref 与 `nbook.settingsDialog.size`。
- 主题通道现状：`app/styles/theme-vars.css` 的角色变量桥接（14 个角色变量在宿主上重声明）+ 24 处模板调用点显式传 `.novel-ide-theme`（`995e5e4f`）。
