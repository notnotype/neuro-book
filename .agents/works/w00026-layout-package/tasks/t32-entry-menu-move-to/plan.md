# t32 入口右键菜单的“移到”另外两个区域：实施计划（第 1 稿）

照现成的“重置”菜单项加两项，底层操作已有：按 reviewing 的“按任务大小降级”不做设计审查，实现审查（Claude Sonnet，前端）兜底。

## Context

- 依据：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 44 的两处 planned：
  - 入口的右键菜单里，“移到”另外两个区域各一项（侧栏的入口是“移到右栏”“移到底部面板”）；
  - “移到”把整个容器搬过去，搬法同输出 46：入口排在目标区域入口顺序的最后，目标区域切到它，目标隐藏或拖到零时同一次写入展开。
- 排进第一档：开发者 2026-11-18 对 t31“都按推荐”，Work 的推进顺序 t37 → t32 → t14。
- 现状：
  - 搬法已有：`state/containers.ts` 的 `moveContainerTo`，store 的 `actions.moveContainer(container, region)`。拖入口到别的区域（输出 46）与“重置”都走它。
  - `containers.test.ts` 已测搬法：先后与比例带着、入口排到最后、切到它；目标隐藏或拖到零时同一次显示出来。
  - 菜单在 `WorkbenchShell.vue` 的 `containerMenuItemsOf`，现在只有“重置”。没有一项时菜单不开（`openContainerMenu`）。
  - `e2e/workbench-views.e2e.ts:682`（菜单键打开容器菜单、“重置”）为了造出“容器不在声明的区域”，直接改了数据库里的布局记录，注释写着“移到”还没有。

## 技术选型

无。

## 关键设计

### 哪几个区域：`packages/neuro-book/src/plugins/workbench/web/state/containers.ts`

- 新增 `containerMoveTargets(doc, container): ReadonlyArray<PanelName>`：容器此刻所在区域之外的两个，按侧栏、右栏、底部面板的固定顺序。
- 容器不在任何区域（没有成员）时是空的。
- 和 `canResetContainer` 放在一起，同样是纯函数。

### 菜单：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue`

- `containerMenuItemsOf`：先列“移到”两项（`message("viewContainers.moveTo.<region>")`，动作 `props.layout.actions.moveContainer(container, region)`），再列“重置”（条件不变）。
- 于是有成员的容器总有菜单：容器在声明的区域时只有两项“移到”。
- 关菜单后焦点的去处沿用现有逻辑：入口搬走了，去它在新区域的入口。“重置”已经这样。
- 底部面板只剩一节、并进入口条时，入口的右键开的是那个视图的“移动到”（`openStripMenu`，输出 47），不变。
- 注释里“现在只有重置”改掉。

### 文案：`packages/neuro-book/src/plugins/workbench/locales/`

`viewContainers.moveTo`：

| 键 | zh-CN | en-US |
|---|---|---|
| `sidebar` | 移到侧栏 | Move to Sidebar |
| `auxiliarybar` | 移到右栏 | Move to Secondary Side Bar |
| `panel` | 移到底部面板 | Move to Panel |

区域名与 `viewCommands.parts`、`newContainerIn` 的说法一致。

### 组件文档：`WorkbenchShell.md`

入口菜单那一处写上“移到”两项。

## Spec 与文档改动

- `ui/workbench-layout` 输出 44：实现与验证之后去掉两处“（planned）”，删掉“现在拖入口到别的区域的入口条已经能搬整个容器”这半句（那是没有“移到”时的说明）。
- 实现合同与证据：输出 44 的 e2e 换成新的用例。

## 切片

一片：`containerMoveTargets` 与单元测试、菜单、文案、组件文档、e2e。

自跑：
- `containers.test.ts`、`locales.test.ts`；
- 应用 `typecheck`；
- e2e：`workbench-views.e2e.ts` 里改动的两条（按文件:行号）；
- `workbench-containers.e2e.ts` 里用到入口菜单的用例：先搜，有就跑。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 菜单项：每个区域的入口各列另外两个区域 | `containers.test.ts`（`containerMoveTargets`）；e2e 新用例（侧栏的入口、右栏入口条的入口） |
| 输出 44 “移到”的搬法：整个容器搬过去，入口排在目标区域入口顺序的最后，目标区域切到它 | e2e 新用例（看保存的布局记录与入口条） |
| 目标隐藏或拖到零时同一次写入展开 | `containers.test.ts` 已有的“目标区域隐藏着、拖到零：同一次显示出来”；e2e 新用例里目标是隐藏的底部面板 |
| 容器在声明的区域时没有“重置”、只有“移到” | e2e `workbench-views.e2e.ts:682` 改：菜单里两项“移到” |
| “重置”不变 | 同一条：造状态改用“移到”，不再改数据库记录；后半段的断言不变 |

## e2e 的写法

- **改 `workbench-views.e2e.ts:682`**：
  - 开头：容器在声明的区域时，菜单键打开的菜单只有“移到”两项，没有“重置”。
  - 造“容器不在声明的区域”改用菜单：乙、丙照旧用“移动到”移进戊；甲的入口“移到右栏”；丁在右栏入口条上的入口“移到侧栏”。这样侧栏只剩丁，和原来改记录造出来的一样。
  - 后半段（菜单里有“重置”、回车搬回右栏、侧栏隐藏、焦点去右栏入口条上的入口）不变。
  - 去掉改数据库的那段，以及因此不再用到的导入。
- **新增一条**“入口菜单的移到”：
  - 侧栏的入口右键：菜单是“移到右栏”“移到底部面板”。先把底部面板隐藏，再选“移到底部面板”：
    - 容器的分节都到了底部面板，底部面板显示出来、切到它；
    - 它的入口在底部面板入口条的最后；
    - 活动栏上没有这个入口了。
  - 右栏入口条上的入口右键：菜单是“移到侧栏”“移到底部面板”。

## 不做与风险

- 不改搬法（`moveContainerTo`）：输出 46 已经在用、有测试。
- 风险：有成员的容器从此总有菜单，原来“没有一项就不开菜单”的用例会变。已搜 e2e 里在右键或菜单键之后断言 `getByRole("menu")).toHaveCount(0)` 的地方：入口菜单只有 `workbench-views.e2e.ts:682` 这一条（上文要改的）；`workbench-containers.e2e.ts:371` 与 `editor-area.e2e.ts:1158` 开的是视图的“移动到”，不受影响。
