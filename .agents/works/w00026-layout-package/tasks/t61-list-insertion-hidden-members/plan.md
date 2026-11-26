# t61 实施计划：列表插入位认滚出去的成员；README 写 TS 6 的 types

## Context

t50 摩擦第 3 条（[friction.md](../t50-example-app/friction.md)，2026-11-26 复查仍“没解决”）：`resolveListInsertion` 跳过与内容盒没有交集的成员（滚出去的），指针过了最后一个看得见的成员就交回 `beforeId: null`（追加）。会滚动的标签条上，线画在最后一个看得见的标签后面，放下却插到所有滚出去的标签之后：画的和做的不一样。标签编组示例因此不让标签条滚动、标签一起变窄截断。工作台的标签条为此在调用方补了一段换算（`packages/nb-workbench-layout/src/vue/tab-strip-geometry.ts` 的 `tabStripInsertionIn`：`null` 时找完整顺序里最后一个看得见的成员的后继）。

第 8 条（复查“部分解决”）：发布冒烟的空宿主与三个示例都改成了 `types: ["vite/client"]`，但包 README 的“安装”一节没写 TS 6 下 `types: []` 导入 `style.css` 报 TS2882。

开发者 2026-11-26 定：w00026 收尾后继续自主优化 nb-layout；做法同 t56 到 t59（coder 实施，主会话验收合入，一批做完交 omp 一次）。

## 关键设计

### `packages/nb-layout/src/grid-drop.ts`：`resolveListInsertion`

- 规则：越过最后一个可用成员（与内容盒有交集）之后，`members` 里排在它后面、矩形有效但整个落在内容盒**沿主轴的终点之外**的第一个成员，就是插入位的后继：交回 `beforeId: <它的 id>`。线照旧贴最后一个可用成员的后缘（含 `edgeGap`），跨度照旧取它的可见矩形：画的位置不变，只是“插到谁前面”与画的一致。
- 没有这样的成员（后面没有成员，或后面的都是无效矩形、零尺寸、在内容盒前端之外）时照旧 `beforeId: null`。
- 只看沿主轴的终点：横向列表看 `rect.left >= containerRect.right`，竖向看 `rect.top >= containerRect.bottom`。在交叉轴上被裁掉的（换行到下一行、被上下裁掉）不算后继：那是调用方的行模型（工作台的多行标签条），库不猜。
- 前端滚出去的成员不受影响：指针在第一个看得见的成员前半时交回它，滚出去的都在它前面，结果本来就对。
- 函数头注释的“尾缘同理……越过最后一个可用成员就是追加”一段按新规则改写。

### 使用方

- `packages/nb-workbench-layout/src/vue/tab-strip-geometry.ts`：库交回非 `null` 的 `beforeId` 时走它已有的 `beforeId` 分支；先核对 `line.members` 是否含滚出去的成员（读 `linesOf`）。含的话，库的新结果与它现在的 `null` 分支换算结果要相同（后继、分区、`after`、指示线）；逐项比对，不同就在报告里写明，**不改工作台的行为**：必要时工作台只把这一行看得见的成员交给库（保持现在的输入），换算照旧。工作台的 e2e 要守住（见验证）。
- `packages/nb-layout/examples/tabbed-panels/`：标签条改成能横向滚动（`overflow-x: auto`，标签不再一起变窄截断到看不清；最小宽照旧），`drop.ts` 不用改；README“绕过的库的空缺”里第 3 条那句删掉或改成现状；`model.ts`、`App.vue` 里提到“标签条不滚动”的注释一起改。
- `packages/nb-layout/examples/desktop`、`ide`：用到 `resolveListInsertion` 的地方核对一遍（ide 的 `drop.ts`），行为不变就不改。

### 文档

- `packages/nb-layout/src/vue/DropFeedbackOverlay.md` 第 59 行一带：“越过最后一个可用成员是追加”改成新规则（后面有滚出去的成员时插到第一个前面，线照旧贴最后一个看得见的后缘）。
- `packages/nb-layout/README.md` 的“安装”一节加一句：TS 6 下 tsconfig 的 `types: []` 会让 `import "@notnotype/nb-layout/style.css"` 报 TS2882，用 `types: ["vite/client"]`（或别的声明了 `*.css` 模块的类型）。写法照 README 现有的语气，不引 Spec 编号。
- `CHANGELOG.md` 的 `[Unreleased]`：“改动”一条（列表插入位认滚出去的后继），“文档”或“改动”里一句 README 的 TS 6 说明，照现有分节。

## 切片

1. 库与测试、文档（一个提交）：`grid-drop.ts`、`grid-drop.test.ts`、`DropFeedbackOverlay.md`、`README.md`、`CHANGELOG.md`。自跑：`bun test src/grid-drop.test.ts src/readme.test.ts`、`bun run typecheck`、`bun run api:check`（签名不变，报告应不变）。
2. 使用方（一个提交）：标签编组示例能滚动、README 与注释；工作台核对（只在必要时改）。自跑：`bun test src/examples-tabbed-panels.test.ts`、`bun scripts/examples.ts typecheck`，nb-workbench-layout `bun test` 与 typecheck。

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 过了最后一个看得见的、后面有滚出去的：插到第一个滚出去的前面，线不变 | `grid-drop.test.ts` 新用例（横向、竖向各一；断言 `beforeId` 与指示线矩形逐值） |
| 后面没有、或后面的只在交叉轴被裁掉、或是无效矩形：照旧 `null` | 同上，各一条 |
| 前端滚出去的不影响 | 同上一条 |
| 标签编组示例滚动后拖到行尾，放下的位置就是线的位置 | `packages/nb-layout/e2e/tabbed-panels.e2e.ts` 新用例：标签多到滚动，滚到中间，拖一个标签到最后一个看得见的标签后半，断言放下后的顺序 |
| 工作台标签条行为不变 | 工作台标签条的 e2e（`workbench-dnd.e2e.ts`、`editor-area.e2e.ts` 里标签条换位、行尾插入的用例；按 `文件:行号` 跑，先 grep 出来） |

## 验证

- 每片照上面的自跑命令。
- 合入前：nb-layout `bun run test`、`typecheck`、`api:check`；nb-workbench-layout `bun test`；应用 typecheck；nb-layout `bun run test:e2e`（三个示例）；工作台标签条相关的 e2e 文件（不超过 8 个，跑前看负载）。
- 变异检查：把新规则关掉（照旧交回 `null`），新用例与示例 e2e 应失败。

## 不做与风险

- 不做：交叉轴上被裁掉的成员的后继（多行标签条），留给调用方；不在库里加“滚到插入位”的自动滚动（拖动会话已有边缘滚动）。
- 风险：工作台 `line.members` 若含滚出去的成员，库的新结果会让它走 `beforeId` 分支，分区的取法（`endedWithExcluded` 的特例）可能与 `null` 分支不同。兜底：切片 2 先比对，不同就保持工作台现在交给库的输入，行为不变。
