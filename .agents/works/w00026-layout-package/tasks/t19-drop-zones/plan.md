# t19 计划：落点分区

## Context

**要解决什么。** 现在拖到面板正文上，只有指针已经落进某一块才看得到结果，事先看不出这块面板能往哪放。t01 决定 14：拖到面板正文上画出上下左右中五块，形状与判定一致；落点指示下压暗内容、线和字都显眼，实时布局下退到卡片后面、只留淡线不写字。

**依据。** [提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 3 节的手感表（“分区（开关）”）、第 5 节“参数分两类”；t01 决定 14、18；t02 原型 `LayoutTreeDraft.vue` 的 `zoneShapes`、`.lt-zones`；[ui/workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 25 到 29 的接受规则。

**开发者已确认。** 2026-11-06“都按推荐”：落点分区单列 Task，排在 t08 之前。分区按收紧后的骨架走：编辑组五块；侧栏、右栏这一列只有上下中；面板这一排只有左右中。

第二稿按设计审查修订（[`evidences/plan-review.txt`](evidences/plan-review.txt)，处理见 README）。

## 技术选型

无新依赖。形状用内联 SVG 多边形（`preserveAspectRatio="none"` 加 `vector-effect: non-scaling-stroke`，原型验证过）。

## 关键设计

**命名。** 中文叫“落点分区”，代码用 `sector`：`zones` 在这些文件里已经是预备区，“分区”在编辑器里也指标签的 partition。

### `packages/nb-layout/src/layout-drop.ts`：形状和判定是一份

```ts
export type LayoutDropSectorId = LayoutEdge | "center";
export interface LayoutDropSector {
    readonly id: LayoutDropSectorId;
    /** 多边形顶点，相对这块正文的比例（0 到 1）。 */
    readonly points: ReadonlyArray<readonly [number, number]>;
    /** 指针落在这块时 `resolveLayoutDrop` 给的动作。 */
    readonly action: LayoutDropAction;
}
/** 这一刻指针算哪块面板（含缝与标签条）；`resolveLayoutDrop` 也用它。 */
export function layoutDropPanelAt(input: LayoutDropInput): LayoutDropPanelGeometry | null;
/** 这块面板的分区；正文零面积、什么都不接收时为 null。 */
export function layoutDropSectors(input: LayoutDropInput, panel: LayoutDropPanelGeometry): ReadonlyArray<LayoutDropSector> | null;
```

- 形状由 `nearestEdge` 的规则推出来：一条边的窄带是“离这条边的相对距离小于比例，且不比别的**可用**边更远”。相邻的边也可用时，这个角按对角线切（梯形）；相邻的边不可用时，窄带占满这个角（矩形）。中央是其余部分；进不了中央时没有这块；空面板整块是中央。
- `nearestEdge` 对零面积的正文（收成标题行）现在会除零：守住，返回 null（审查第 10 条）。
- `enumerateDropCandidates` 对接受中央的空面板只列中央：现在列出四条边的停靠点，判定却都是中央（审查第 18 条）。
- 不变量由两条测试守住：nb-layout 里浮点随机点（避开边界）、四种假策略；`neuro-book` 里 `createLayoutPolicy` 加默认树，对每块面板扫整数网格（含缝），`resolveLayoutDrop` 的动作等于点所在多边形的 `action`，对角线上允许任一相邻块（审查第 8 条）。

### `packages/nb-layout/src/vue/DropSectorsOverlay.vue`（新组件，同名 `.md`，Lab 场景）

```ts
defineProps<{
    /** 这块面板正文的矩形（视口坐标）与分区；没有为 null。 */
    rect: GridDropRect | null;
    sectors: ReadonlyArray<LayoutDropSector>;
    /** 指针此刻落在哪块；没有为 null。 */
    active: LayoutDropSectorId | null;
    /** 每块写的字；不给不写。当前块不写：`DropFeedbackOverlay` 的药丸在说它。 */
    labels?: Partial<Record<LayoutDropSectorId, string>>;
}>();
```

- Teleport 到 body，`position: fixed`，不接指针，根上写 `data-drag-feedback`（`ui/layout-drag.md` 的公开标记）；SVG 与字 `aria-hidden`：播报由 `DropFeedbackOverlay` 的 live 区负责。
- 层级：`NB_Z_INDEX` 新登记 `dropSectors: 59`，低于 `dropFeedback`（区域高亮、药丸、预备区）。预备区只在没有真实落点时才算，那时没有分区，两者不抢。更新 `z-index.test.ts`。
- 压暗与线（只有落点指示这一组，实时布局的一组由 t08 拿到卡片实现后定：Teleport 到 body 的层夹不到树内的卡片后面，现在写只是猜）：

  | 令牌 | 缺省 |
  |---|---|
  | `--layout-scrim` | `color-mix(in srgb, color-mix(in srgb, #000 30%, var(--bg-main)) 60%, transparent)`（原型的值） |
  | `--layout-sector-fill` | `color-mix(in srgb, var(--accent-main) 5%, transparent)` |
  | `--layout-sector-line` | `color-mix(in srgb, var(--accent-main) 65%, transparent)` |
  | `--layout-sector-active-fill` | `color-mix(in srgb, var(--accent-main) 12%, transparent)`（不取 `--drop-area-fill`：区域高亮还要叠在上面） |
  | `--layout-sector-active-line` | `var(--drop-area-border)`：主题改过落点高亮时跟着变 |
  | `--layout-sector-radius` | `0 0 var(--shell-card-radius, 0) var(--shell-card-radius, 0)`：卡片的下两角是圆的，不让压暗露出去（审查第 7 条） |

  写进 nb-ui `tokens.css`，登记进 `nbThemeFeedbackTokens`（主题不能重复声明同名变量），`pack.ts` 的“拖动与落点的反馈”分组加 `layout-`，`docs/specs/theme/system.md` 同步。顺手把已有的 `--motion-layout`、`--ease-layout` 登记进动效令牌（漏登记）。
- 动效：淡入用 `var(--motion-fast)`，减少动效时自然是 0。换面板时复用节点，不重放淡入、不过渡位置。
- `forced-colors`：去掉压暗（系统色会把它变成不透明底），线用 `Highlight`。`prefers-contrast: more`：线不透明。
- 字：放在多边形外接盒的中心；外接盒小于 96×28px 时不写（编辑组最窄 220px，左右窄带约 62px；英文放不下）。

### `DropFeedbackOverlay` 不改

第一稿让分区写字时隐藏药丸。不做（审查第 1 条）：药丸还说“原位”“两块之间”“拆到这一边”（输出 28），分区的字只有方向；隐藏它要改 Spec 与 22 处断言，还有 live 区跟着可见几何走的问题。所以药丸照旧，当前块不写自己的字。

### `workbench/web/layout-drag.ts`

分区跟 `dropAt` 走，不另算（审查第 2 条：另算会绕开“被菜单挡住”“键盘停在预备区”，每帧多读一遍几何，两个宿主各接一份）：

- `LayoutDragDrop` 加 `sectors?: {rect, items, active}`。
- `dropAt` 里：`resolved` 不是 `reveal`、不是标题栏之外的 `strip` 时，按 `layoutDropPanelAt` 的面板算 `layoutDropSectors`，`active` 用 `JSON.stringify` 比对 `action`。预览缓存的键只有动作（同一个 `between` 可以从两块面板进来），所以分区不进缓存，返回 `{...cached, sectors}`。
- `titleOnly` 面板的头：`resolved` 是 `strip`、改写成 `center`，分区照画，当前块是中央（Spec 25 写的就是“等于中央”，审查第 9 条）。
- `options.sectors()`：开关，关掉不算。

### `WorkbenchShell.vue`、`WorkbenchDragFeedback.vue`、Lab 夹具

`WorkbenchDragFeedback` 加属性 `sectors`（透传给 `DropSectorsOverlay`），字由宿主给：`shell.drop.sector.top|bottom|left|right`，中央用已有的 `shell.drop.addTab`（审查第 17 条）。`EditorAreaFixture` 同样接上，开关固定开。

### 设置

`nbook.workbench/dropZones`（布尔，缺省开，只有 `user` 层）。一个开关，不按手感分：提案的手感表里“分区（开关）”就是一行；t08 决定实时布局下怎么画。工作台读法与放在哪个分区照现有的设置（实现时看 `workbench/web/plugin.ts` 与 `nbook.appearance` 的小组，放不下就加一个“拖动”小组，t08 的手感设置也放这里）。中英文说明进 `workbench` 的 locale。

## Spec 与文档改动

- `ui/workbench-layout.md`：输出末尾追加“落点分区”（哪些面板显示、形状与判定一致、当前块、指针在标签条与预备区上没有、设置、不影响判定），“验收与 Smoke”加一条。
- 组件同名 `.md`：`DropSectorsOverlay.md`（新）、`WorkbenchDragFeedback.md`。`ui/layout-drag.md` 不放：它不管反馈长什么样。
- `docs/specs/theme/system.md`：交互反馈令牌。
- `docs/standards/code/components.md`：受管组件目录补上 nb-layout（脚本已含，文档落后）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | `layoutDropPanelAt`、`layoutDropSectors`、零面积、空面板候选，两条一致性测试 | `layout-drop.test.ts`、工作台的策略测试 |
| 2 | `DropSectorsOverlay`、令牌、层级、Lab 场景 | dom 测试、`tokens.test.ts`、`z-index.test.ts`、`lab-scenes` |
| 3 | 工作台接上、设置、Spec | `workbench-dnd` 新增、`editor-area` 的落点用例、`lab-drag-session` |

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 形状与判定一致（五块、只有上下、只有左右、不接受中央、空面板、零面积） | `layout-drop.test.ts`、工作台策略的网格扫描 |
| 编辑组五块，指针靠右时右块是当前块、写字的块不含当前块；侧栏列只有上下中；面板排只有左右中 | `workbench-dnd` 新增 |
| 编辑组的标签条上、工具视图在编辑组上（不接收）没有分区；只有标题的侧栏头上有分区，当前块是中央 | `workbench-dnd` 新增 |
| 键盘拖动停在正文的落点上有分区，停在预备区没有；结束、取消后不留 | `workbench-dnd` 新增 |
| 设置关掉没有分区，落点照旧 | `workbench-dnd` 新增 |
| 压暗不用模糊、外观走变量：改变量后线色变，`backdrop-filter`、`filter` 是 none | `lab` 场景读计算样式 |
| 窄面板不写字 | dom 测试 |

被菜单挡住不单独测：分区跟 `drop` 走，`drop` 为 null 就没有，走的是同一条路。“线和字都显眼”由开发者看截图定（给亮色）。

## 验证

`bun run test:affected --since master --typecheck`；e2e：`workbench-dnd`、`editor-area`（落点与拖动的用例）、`lab-drag-session`、`lab-scenes`（新场景）。给开发者看的截图用亮色。手感与默认开关由开发者确认。

## 不做与风险

- 实时布局里的分区（t08 接：`variant` 与层级到那时定）。
- 不导出 SDK：插件不画自己的落点分区；`pack.test.ts` 要求列出时再说。
