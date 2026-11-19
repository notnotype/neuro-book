# t41 拖不动时报错：开发模式的配置错误各报一次：实施计划（第 2 稿）

第 2 稿按设计审查（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)，11 条，阻断 0、重要 6、建议 5，都成立，审查者用真实 `NestedGrid` 加 `useGridHost` 做了实验）改，逐条处理见 Task README。

最大的改动：上下文与版本的检查从提交处挪到手势开始处。手势期间换上下文或重发布局时，`NestedGrid` 自己会把手势取消，到不了提交；在提交处判“版本相同而上下文不同”，会把唯一能到达的那种合法拒绝误报出来（第 1、2 条）。

改法有两个方向，第 2 稿取审查者建议的那个，没有再送审：实现审查兜底。

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)“错误与诊断”一节的“拖不动时报错”，第一档第 5 项；开发者 2026-11-18 对 t31“都按推荐”。2026-11-19 从 t39 拆出（[待确认清单](../../pending-confirmations.md)）。
- 提案原话：
  - 开发模式下的配置错误各报一次，只做具体几条，不做通用机制：`sashSize` 为 0、没接 `onGestureCommit`、contextKey 两处对不上、revision 没转交给 `NestedGrid`（体验审查第 11 条）。
  - 开发模式的判据在第一档用库内的开关（宿主传入或模块级设置），不用 `import.meta.env.DEV`。理由是它在库模式构建时会被静态替换、使用者永远读到生产值；这一条提案标着“凭记忆，第二档发产物时核实”。
- 今天这四种错误的表现都是“拖不动”：
  - `sashSize` 缺省是 0：分隔条没有宽度、不可交互，也没有诊断（`grid.md`“建树”）。
  - 后三种在松手或按下时失败，只经 `NestedGrid` 的 `issues` 事件交出，没接 `@issues` 的宿主什么也看不到。
- 覆盖面：
  - `sashSize` 与“没接提交处理”两条在 `NestedGrid` 里检查，所有宿主都经过它。
  - 上下文与版本两条只能在宿主那边比：`NestedGrid` 不知道宿主此刻的值。所以它们放在 `useGridHost` 里，服务整包绑定的宿主，查的是模板里另写的 `context-key`、`:revision` 覆盖了包里的值（`NestedGrid.md`“接入”的约定）。
  - 不经 `useGridHost`、自己接线的宿主，提交处理自己负责：它们照旧能从 `issues` 事件拿到被拒的提交。

## 技术选型

无。

## 关键设计

### 开关：`packages/nb-layout/src/dev-checks.ts`（新增，根入口导出 `setLayoutDevChecks`）

```ts
/** 打开或关闭开发模式的配置检查（缺省关）。宿主在自己的开发构建里打开。 */
export function setLayoutDevChecks(enabled: boolean): void;
```

- 模块级开关，缺省关。
- 状态放在 `globalThis[Symbol.for("nb-layout.devChecks")]`：发布产物里根入口与 `./vue` 入口如果各带一份这个模块，宿主从根入口打开的开关仍然到得了检查点（第 7 条）。
- 内部给检查点用（不从入口导出）：
  - `layoutDevWarning(owner: object, kind: string, message: string)`：开关打开时，同一个 `owner`（一个 `NestedGrid` 或一个 `useGridHost` 宿主）的同一种 `kind` 只 `console.warn` 一次。
  - 记录用 `WeakMap<object, Set<string>>`，寿命跟着那个组件或宿主：一页里有几个网格时，每个各报各的（第 6 条）。
  - `v-if` 反复摘挂的网格会重复报，可以接受。
- 消息是英文，写明错在哪、怎么改，带上 `contextKey` 便于认出是哪个网格；前缀带位置：`[nb-layout/NestedGrid]`、`[nb-layout/useGridHost]`。
- 为什么用 `console.warn`、不走 `onIssues`：这是给开发者看的配置错误，不是运行时诊断。运行时的被拒提交照旧经 `issues` 事件交出，不变。
- 和已有的 `Splitter.vue` 的 `console.warn`（`sashSizes` 配错，前缀 `[nb-layout/Splitter]`，没有开关、每次重算都报）不合并（第 9 条）。那是独立 Splitter 的入参校验，独立 Splitter 由 t14 迁移，迁移时再看要不要并进来。

### 四个检查点

1. **`sashSize` 为 0**：在 `vue/NestedGrid.vue` 里，布局变了时检查（第 3、4 条）。
   - 判据，下面四样同时成立：
     - 宿主传了 `onGestureCommit`；
     - `disabled` 不为真；
     - 这份布局至少有一条分隔条；
     - 所有分隔条的占用都是 0（`layout.sashSizes` 的全部值）。
   - 不传提交处理或停用了的网格是只读的，`sashSize` 为 0 合法。
   - 审查已核对：工作台有非零的缝，空布局没有分隔条，都不会触发。
2. **没接提交处理**：在 `NestedGrid` 交回 `handler-missing` 的地方（第 8 条）。
   - `props.onGestureCommit === undefined`：消息是“没接 `onGestureCommit`”。
   - 有处理函数但它返回了 `undefined`：消息是“要返回 `{ok: true}` 或失败对象”。常见原因是把它写成了事件 `@gesture-commit`，提交处理是属性不是事件。
   - 两种是两个 `kind`。不在挂载时报：只读的网格可以不接。
3. **contextKey 两处对不上**：在 `vue/useGridHost.ts` 里。
   - `bindings` 加一个 `onGestureStart`；`gesture-start` 在按下时同步发出，那时宿主的刷新已经发生。
   - 判据：载荷的 `contextKey` 不等于宿主此刻的上下文。
   - 宿主在模板里自己写 `@gesture-start` 不受影响：Vue 把同名的 `on*` 合成数组、都会调用。
4. **revision 没转交**：同上，判据是载荷的 `revision` 不等于宿主此刻的版本。
   - 写死的常数、过期的拷贝、缺省的 0 都能抓到（第 2 条）。

后三种照旧失败、照旧经 `issues` 事件交出，只是开发模式下多一条警告。提交处不另加检查。

### 应用里打开：`packages/neuro-book/src/web/development-plugins.ts`

- 这个模块只在开发模式由 `main.ts` 动态加载，生产构建里没有它（第 11 条）。
- 在里面导出 `enableDevelopmentChecks()`，调 `setLayoutDevChecks(true)`；`main.ts` 加载它之后调一次。
- e2e 外壳是生产构建，不打开。

## Spec 与文档改动

- [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)：
  - 新输出 151“开发模式的配置检查”（planned）：开关缺省关；四种情形的判据；每个网格（或宿主）每种只报一次；不改变失败与 `issues` 事件。
  - “边界与兼容”的公开入口加 `setLayoutDevChecks`。
- `grid.md`“建树”：`sashSize` 缺省 0 那句后面加“接了提交处理又没停用时，开发模式下会警告”。
- `NestedGrid.md`“接入”：加一句开关怎么开，以及“提交处理是属性不是事件”。

## 切片

1. **开关与四个检查点**：
   - `dev-checks.ts`、`NestedGrid.vue`、`useGridHost.ts`，根入口导出；
   - 测试 `dev-checks.dom.test.ts`；
   - 文档。
   - 提交 `feat(nb-layout)`。
2. **应用打开**：`development-plugins.ts` 与 `main.ts`，提交 `feat(web)`。

自跑：nb-layout 的 `bun test` 与 `bunx vitest run`、`exports.test.ts`、应用 `bun run typecheck`。

## 验收映射

| Spec | 测试（`dev-checks.dom.test.ts`，真实的 `NestedGrid` 与 `useGridHost`；`console.warn` 用桩接住、只数次数） |
|---|---|
| 输出 151 的开关 | 开关关着时四种情形都不警告。 |
| `sashSize` 为 0 | 缺省 `sashSize` 建网格、接了提交处理：警告一次；再重发一次布局不再警告；停用、不传提交处理、有一条非零分隔条时都不警告。 |
| 没接提交处理 | 不传处理函数拖一次：警告一次，提交照旧以 `handler-missing` 交出；处理函数返回 `undefined`：另一条警告。 |
| 上下文对不上 | `useGridHost` 整包绑上、模板里再写一个不同的 `context-key`，按下：警告一次。 |
| 版本没转交 | 整包绑上、模板里再写 `:revision="0"`，按下：警告一次；写一个过期的版本（比此刻小、大于 0）同样警告。 |
| 不误报（第 5 条） | 开关打开，正确接线的 `useGridHost` 加 `NestedGrid`：拖动、改尺寸、`v-if` 摘掉再挂回、换网格实例、换 `contextKey`（等刷新之后再按下），`console.warn` 零次。 |
| 每个网格各报各的 | 两个都配错的网格，各警告一次。 |

每条判据做变异：去掉判据里的任一项会让对应用例变红。

## 验证

- 单元与 dom 测试（见切片）。
- 不跑 e2e：开关在 e2e 外壳里不打开，不改变任何 e2e 能看到的行为。
- 应用的开发服务里打开后，工作台与 Lab 是否有误报，没有自动化证据。本地起一次开发服务，在工作台与 Lab 的网格场景里拖一拖、看控制台，结果写进验证。
- 收口：`bun run test:affected --since master`。

## 不做与风险

- 不做通用的配置检查机制（提案原话“只做具体几条”）。
- 不检查自己接线、不经 `useGridHost` 的宿主的上下文与版本：库不知道它们此刻的值。
- 默认关：第三方不读文档就看不到警告（第 10 条）。
  - 另一种做法是像 Vue、React 那样在库里留 `process.env.NODE_ENV` 判断、交给使用者的打包器替换（审查者凭记忆，未核对）。
  - 开发者已定“库内开关”，这里照做；第二档发产物时连同 `import.meta.env` 的替换行为一起核实。

## 待确认

1. 开关做成模块级的 `setLayoutDevChecks(enabled)`，缺省关，状态放在全局符号上（推荐，和开发者已定的“库内开关”一致）。
2. 报到 `console.warn`，每个网格（或宿主）每种只报一次（推荐）。
