# t41 拖不动时报错：开发模式的配置错误各报一次：实施计划（第 1 稿）

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)“错误与诊断”一节的“拖不动时报错”，第一档第 5 项；开发者 2026-11-18 对 t31“都按推荐”。2026-11-19 从 t39 拆出（[待确认清单](../../pending-confirmations.md)）。
- 提案原话：
  - 开发模式下的配置错误各报一次，只做具体几条，不做通用机制：`sashSize` 为 0、没接 `onGestureCommit`、contextKey 两处对不上、revision 没转交给 `NestedGrid`（体验审查第 11 条）。
  - 开发模式的判据在第一档用库内的开关（宿主传入或模块级设置），不用 `import.meta.env.DEV`：它在库模式构建时会被静态替换，使用者永远读到生产值。
- 今天这四种错误的表现都是“拖不动”：
  - `sashSize` 缺省是 0，分隔条没有宽度、不可交互，也没有诊断（`grid.md`“建树”）；
  - 后三种在松手时以 `handler-missing`、`stale-context`、`stale-revision` 被拒，只经 `NestedGrid` 的 `issues` 事件交出，没接 `@issues` 的宿主什么也看不到。
- t39 之后，用 `useGridHost` 整包绑定的宿主不会犯后三种，但仍有两条路会撞上：
  - 不用 `useGridHost`、自己接 `NestedGrid` 的宿主；
  - 在模板里另写了 `contextKey` 或 `:on-gesture-commit` 覆盖了包里的值（`NestedGrid.md`“接入”里写的那条约定）。

## 技术选型

无。

## 关键设计

### 开关：`packages/nb-layout/src/dev-checks.ts`（新增，从根入口导出）

```ts
/** 打开或关闭开发模式的配置检查（缺省关）。宿主在自己的开发构建里打开，例如 `if (import.meta.env.DEV) setLayoutDevChecks(true)`。 */
export function setLayoutDevChecks(enabled: boolean): void;
```

- 模块级开关，缺省关。理由（提案原话）：库模式构建会把 `import.meta.env.DEV` 静态替换掉，宿主的开发模式只有宿主自己知道。
- 内部给检查点用的函数（不从入口导出）：
  - `layoutDevWarning(kind, message)`：开关打开时，每种 `kind` 只 `console.warn` 一次，整个页面范围；
  - `resetLayoutDevChecks()`：给测试清掉“已报过”的记录。
- 为什么用 `console.warn`、不走 `onIssues`：
  - 这是给开发者看的配置错误，不是运行时诊断；
  - 后三种的运行时诊断（被拒的提交）照旧经 `issues` 事件交出，不变。
- 消息是英文，写明错在哪、怎么改；前缀 `[nb-layout]`。

### 四个检查点

1. **`sashSize` 为 0**（`vue/useGridLayout.ts` 的 `publish`）：
   - 判据：这次布局至少有一条分隔条，并且所有分隔条的占用都是 0（`layout.sashSizes` 的全部值）。
   - 只有“全部为 0”才报：工作台有意把条两侧的缝设成 0，但别的缝不是 0。
   - 消息：分隔条宽为 0、拖不动；`createGrid` 的 `sashSize` 缺省是 0，要可拖就传一个正数。
2. **没接 `onGestureCommit`**（`vue/NestedGrid.vue` 的提交处）：
   - 判据：一场手势要提交时没有处理函数（今天在这里交回 `handler-missing`）。
   - 不在挂载时报：只读的网格可以不接。
3. **contextKey 两处对不上**（`useGridLayout` 的 `onGestureCommit`）：
   - 判据：`commit.contextKey` 与宿主此刻的上下文不同，并且 `commit.revision` 等于宿主此刻的版本。
   - 正常的 `stale-context` 是手势期间换了上下文，这时宿主已经重算、版本递增了。版本没变而上下文不同，只能是两处写的值不一样，例如模板里另写了 `context-key`。
4. **revision 没转交**（同上）：
   - 判据：`commit.revision` 不是这个宿主发布过的版本：大于此刻的版本，或者小于 1。宿主的版本从第一次发布起至少是 1，`NestedGrid` 的 `revision` 缺省是 0。
   - 正常的 `stale-revision` 是手势期间布局重发了，那时 `commit.revision` 是一个更早发布过的版本。

后三种照旧被拒、照旧经 `issues` 事件交出，只是开发模式下另多一条警告。

### 应用里打开：`packages/neuro-book/src/web/main.ts`

`if (import.meta.env.DEV) setLayoutDevChecks(true);`，和加载开发清单的判断写在一起。生产构建与 e2e 外壳不打开。

## Spec 与文档改动

- [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)：
  - 新输出 151“开发模式的配置检查”（planned）：开关、四种情形的判据、每种只报一次、不影响被拒的提交与 `issues` 事件；
  - “边界与兼容”的公开入口加 `setLayoutDevChecks`。
- `grid.md`“建树”：`sashSize` 缺省 0 那句后面加“开发模式下会警告一次”。
- `NestedGrid.md`“接入”：加一句开关怎么开。

## 切片

1. **开关与四个检查点**：
   - `dev-checks.ts`、`useGridLayout.ts`、`NestedGrid.vue`，根入口导出；
   - 测试 `dev-checks.dom.test.ts`；
   - 文档。
   - 提交 `feat(nb-layout)`。
2. **应用打开**：`main.ts` 一行，提交 `feat(web)`。

自跑：nb-layout 的 `bun test` 与 `bunx vitest run`、`exports.test.ts`、应用 `bun run typecheck`。

## 验收映射

| Spec | 测试 |
|---|---|
| 输出 151 的开关 | `dev-checks.dom.test.ts`：开关关着时四种情形都不警告；打开后各警告一次，同一种再发生不再警告。 |
| `sashSize` 为 0 | 同上：`sashSize` 缺省建网格、挂上，警告一次；有一条非零分隔条时不警告。 |
| 没接 `onGestureCommit` | 同上：不传处理函数拖一次，警告一次；提交照旧以 `handler-missing` 交出。 |
| contextKey 两处对不上 | 同上：`useGridHost` 整包绑上、模板里再写一个不同的 `contextKey`，拖一次，警告一次；手势期间真的换了上下文（版本递增）时不警告。 |
| revision 没转交 | 同上：自己接 `useGridLayout` 式的宿主但不传 `revision`，拖一次，警告一次；手势期间布局重发（版本是更早发布过的）时不警告。 |

## 验证

- 单元与 dom 测试（见切片），每条判据做变异。
- 不跑 e2e：开关在 e2e 外壳里不打开，不改变任何 e2e 能看到的行为。
- 收口：`bun run test:affected --since master`。

## 不做与风险

- 不做通用的配置检查机制（提案原话“只做具体几条”）。
- 不在挂载时报“没接 `onGestureCommit`”：只读网格合法。
- 风险：“版本相同而上下文不同”的判据依赖“上下文变了必重算、版本递增”。这条今天成立（`useGridLayout` 侦听 `contextKey()`），用测试守住。

## 待确认

1. 开关做成模块级的 `setLayoutDevChecks(enabled)`，缺省关（推荐）。另一种做法是每个宿主在选项里传，但 `sashSize` 的检查在 `useGridLayout`、`handler-missing` 在 `NestedGrid`，要传两处。
2. 报到 `console.warn`，每种整个页面只报一次（推荐）。
