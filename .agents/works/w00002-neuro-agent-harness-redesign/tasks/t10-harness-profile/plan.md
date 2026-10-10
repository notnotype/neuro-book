# t10 实施计划：`profile` 模块

## Context

- **为什么做**：内核重做的第二个模块（Work 切片 2）。runtime 靠它把一份 TSX 变成这次请求的系统提示词与消息，靠它的注册接口让以后的插件贡献节点、数据源与字段；`session` 模块已经定好种子、提醒与 Profile 状态在会话里的形状，这里产生它们。
- **依据**：[`harness.profile`](../../../../../docs/specs/harness/profile.md)（`planned`，两轮设计审查后定稿）；[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“Profile”一节；[`harness.session`](../../../../../docs/specs/harness/session.md) 的保留类型表（`harness/seed` 的 `details.role`、`harness/reminder`、`harness/profile-state`）。
- **开发者已确认的决定**：节点、数据源与字段全部走注册，主机是独立实例；布局节点只有 `Prompt`、`System`、`History`、`Appending`、`Input`；`Appending` 只在 ReAct 循环之前产生要写进会话的消息；`History` 是回放出的 `Message[]`，可以多个或没有，子节点是种子（只能 `User`、`Developer`，`once` 只在新会话写）；提醒用 `<system-reminder>`；去掉 `If`、`Each`，消息节点按角色拆；系统提示词只有文字；Profile 文件全部信任。
- **工作方式**：同 t09：worktree `.worktree/w00002-neuro-agent-harness-redesign`、分支 `feat/w00002-harness-kernel`，逐片提交；主 Agent 编码，omp 计划审查与实现审查；测试用真实依赖（真实 `.profile.tsx` 文件经 Bun 加载），不用 mock、spy、假计时器、固定等待；每片做变异检查。`profile` 不依赖 `session`（计划里引用它的保留类型时只按 Spec 文字对齐，不导入）。

## 关键设计

### 1. 节点与 JSX 运行时（`src/profile/nodes.ts`、`jsx-runtime.ts`、`jsx-dev-runtime.ts`）

- `ProfileNode = {type: string; props; children: ProfileChild[]}`，`ProfileChild = ProfileNode | string | null`。JSX 工厂只接受函数类型（内置组件与注册方用 `nodeComponent(id)` 造出的组件），字符串元素名直接抛错：没有“内置 HTML 元素”这一层，所有节点都对应一个已登记或待登记的类型 id。
- 子节点归一化在工厂里做一次：数组拍平，`null`、`undefined`、`false`、`true` 丢掉，数字转字符串；之后所有代码只处理 `ProfileChild`。
- 内置节点的类型 id 固定为 `harness/prompt`、`harness/system`、`harness/history`、`harness/appending`、`harness/input`、`harness/user`、`harness/developer`、`harness/assistant`、`harness/reminder`、`harness/tag`、`harness/image`、`harness/fragment`（补进 Spec）。组件函数 `Prompt`、`System`…只是 `nodeComponent(id)` 的实例，带 props 类型。
- `JSX` 命名空间：`Element = ProfileNode`；`IntrinsicElements` 为空（禁止字符串元素）；`ElementChildrenAttribute.children`。包的 `tsconfig` 加 `jsx: "react-jsx"`、`jsxImportSource: "@notnotype/nb-harness/profile"`；旧原型文件自己带 `@jsxImportSource` 指向 `nb-profile`，不受影响。`package.json` 加 `./profile`、`./profile/jsx-runtime`、`./profile/jsx-dev-runtime`、`./profile/loader` 四个入口。

### 2. 主机与注册（`src/profile/host.ts`、`definitions.ts`）

- `createProfileHost()` 返回闭包式主机：三张 `Map`（节点类型、数据源、字段），`dispose` 从表里删；`prepare` 时拷一份快照放进 `PreparedProfile`，所以准备结果不随后续注册变化（输出 1）。
- 定义用 TypeBox 校验（`invalid-definition`）：id 符合 `<命名空间>/<名称>`；`props`、`schema` 是对象 schema（`Type.Object` 产物，检查 `type === "object"`）；`parents` 非空；`category` 三选一且各自的字段齐全。`reserved-node`：id 在内置布局节点与 `Fragment` 的集合里。`duplicate-registration`：表里已有。
- 内置的消息、内容、有状态节点在 `createProfileHost` 里经同一个 `registerNodeType` 登记（`builtin/*.ts`），布局节点不经注册表，由校验与渲染直接认识：这样注册接口被内置节点自己用过一遍，插件照着做就行。

### 3. 准备与校验（`src/profile/prepare.ts`）

- `prepare`：校验 Profile 字段（未注册 → `unknown-field` 警告，不合 schema → `invalid-field`）→ 调提示词函数（抛错或返回的根不是 `Prompt` → `invalid-prompt`，诊断 `prompt-threw`，路径 `Prompt`，detail 写异常信息；诊断码补进 Spec）→ 自上而下走树，带路径字符串（`Prompt>Appending>Reminder[0]`，同类型兄弟按出现序号）。每个节点查：类型已登记（布局节点与 `Fragment` 除外）、props 符合 schema、父子关系符合内置表与注册声明；全局规则：最多一个 `History` 带子节点、最多一个 `Appending`、`Appending` 里至多一个 `Input`、种子只是 `User`/`Developer`、`History as="text"` 只在请求消息里、有状态节点只在 `Appending` 子树里且 `id` 不重复、`Image` 只在 `User` 里、`System` 里只有文字。诊断逐条收集，不在第一条就停。
- 数据源：收集树里所有节点声明的数据源 id（去重），未登记 → `unknown-source`；并行取数，每个结果按 schema 校验，失败 → `source-failed`；`signal` 已中止 → `cancelled`。`refresh` 只重取 `model-call` 的，其余从旧结果复制。
- `PreparedProfile` 是冻结对象：`profile`、`context`、`tree`、按节点类型 id 建的快照表、`sources: ReadonlyMap`、布局索引（`System` 节点列表、`History` 节点列表、带子节点的那个、`Appending`、直接在 `Prompt` 下的消息节点）、`diagnostics`（警告）。调用方拿到的只是一个不透明对象（Spec 不列它的字段）。

### 4. 渲染（`src/profile/render.ts`、`text.ts`、`history-text.ts`）

- 文本拼接（输出 5）：先把子节点渲染成片段列表 `{kind: "inline" | "block", text}`（字符串与行内节点是 inline，`Tag` 与 `layout: "block"` 的内容节点是 block），再按规则连接：inline 直接相连，block 前后各空一行；整段 `trim`，三个以上换行折叠为两个。`Tag` 渲染为 `<name>\n内容\n</name>`。
- 消息渲染：消息节点的子节点渲染成 `TextContent`/`ImageContent` 序列：文字片段合并成一个 `TextContent`，`Image` 产生 `ImageContent`；只有文字时 `content` 用字符串。消息带 `timestamp: context.now.getTime()`（pi-ai 必填），不带 `attribution`（`session` 回放种子与提醒时自己加 `attribution: "agent"`，这里只产生要写进会话的 `custom_message` 内容）。
- `renderSystem`：各 `System` 的文本，空的不列（输出 6）。
- `renderSeeds`：带子节点的 `History` 的子节点逐条渲染，`once` 从 props 取；`after-compaction` 跳过 `once`（输出 8）。
- `renderAppending`：按 `Appending` 子节点顺序：`Input` → `{kind: "input"}`（内容就是 `UserInput.content`）；消息节点 → `{kind: "message"}`；`Reminder` → 触发判定（输出 10）后 `{kind: "reminder"}`，内容 `<system-reminder>\n…\n</system-reminder>`；其它有状态节点直接在 `Appending` 下 → 内容非空时 `{kind: "message"}` 的用户消息。没有 `Input` 时输入放最后；没有 `Appending` 时只有输入。状态：`state[id]` 传给 `render`，返回值写回同一键，没渲染到的键原样保留。
- `renderRequest`（输出 7）：按 `Prompt` 子节点顺序：`System` 跳过（进 `systemPrompt`）；`History` → `history` 全部或最后 `last` 轮（轮按“用户发出的消息”切，与 `session` 的分页同一规则）；直接的消息节点 → 请求消息；`Appending` 跳过。没有布局 `History` 时末尾接 `history.slice(invocationStart)`。`invocationStart` 越界 → 按 `history.length` 处理并给 `invalid-invocation-start` 警告。`History as="text"` 在请求消息内渲染 `history.slice(0, invocationStart)` 为文字（输出 11）。
- `cache-unfriendly`（输出 15）：`prepare` 时看 `Prompt` 子节点顺序，第一个布局 `History` 之前有消息节点就给警告。

### 5. 内置节点（`src/profile/builtin/`）

- `Tag`（内容、block）、`Image`（内容，只收 `{mimeType, data}`）。Spec 原来写 `Image` 也可以“读取图片的数据源”，但 `NodeTypeDefinition.sources` 是静态列表，数据源 id 写在 props 里就没法在准备时算进待取集合；改为由注册方的内容节点读数据源后返回 `Image`（Spec 已改）。
- `Reminder`（有状态）：用公开的 `NodeTypeDefinition` 写，`render` 收 `state`（`{lastTurn, watch}`）与 `context.prompt.turn`，按输出 10 判定，返回 `{content, state}`。这样第 2 节的注册接口被内置实现验证过。
- `User`、`Developer`、`Assistant`（消息）按 `category: "message"` 注册。

### 6. 加载与目录（`src/profile/loader/loader.ts`、`catalog.ts`）

- `defineProfile` 校验字段（TypeBox：id 格式、非空 `name`/`description`、正整数 `version`、`fields` 对象、`prompt` 函数）并给结果打一个模块内的 `Symbol` 标记；`profileFromModule` 认 `default` 导出上的标记（同一进程里两份 `nb-harness` 副本的情况不考虑）。
- `loadProfile(path)`：`import(pathToFileURL(path).href)`，异常 → `module-load-failed`；再 `profileFromModule`。只在 `loader/` 目录动态导入（模块表已登记）。Profile 文件在仓库外时解析不到 `@notnotype/nb-harness/profile`（实现时从真实临时目录加载就失败了），所以加载器首次调用时给 Bun 装一个解析钩子（`Bun.plugin` 的 `onResolve`），只把 `@notnotype/nb-harness/profile` 及其三个子路径指回本包源文件；进程内装一次，是本模块唯一的进程级状态（写进 Spec 输出 12）。
- `createProfileCatalog`：按组顺序合并，后组覆盖前组；同组内 id 重复两者都不收录并在 `issues` 里报 `duplicate-profile`（诊断码补进 Spec）。

### 7. 边界测试与包配置

- 模块表 `profile` 已登记：`typebox` 运行时、`@oh-my-pi/pi-ai` 只 `import type`、`loader` 目录可用 Node 内置模块与动态导入。`loader` 用 `node:url` 的 `pathToFileURL`。
- 测试用的 `.profile.tsx` 放在 `src/profile/testing/fixtures/`，由 `loader.test.ts` 真实加载。

## Spec 与文档改动

| 文档 | 改什么 | 片 |
|---|---|---|
| `docs/specs/harness/profile.md` | 补 `UserInput`、`Profile`、`PreparedProfile`（不透明）、`defineProfile` 的类型；内置节点的 id；`Image` 只收 `{mimeType, data}`；目录的诊断码 `duplicate-profile`；收口时加“实现合同”与证据行 | 计划时、S5 |
| `docs/specs/README.md` | 注册表“说明”列加“待晋升” | S5 |
| `packages/nb-harness/package.json`、`tsconfig.json` | 四个入口；`jsx`、`jsxImportSource` | S1 |
| 本 Task README | 每片完成后更新 | 各片 |

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | 节点、JSX 运行时、主机与注册、定义校验、内置节点的登记 | 1、2、5 的登记部分、7 | `bun test src/profile`、`bun run typecheck`、`bun test src/architecture.test.ts` |
| S2 | `prepare`、树校验与诊断路径、字段、数据源与 `refresh` | 3 | 同上 |
| S3 | 文本拼接、消息渲染、`renderSystem`、`renderSeeds`、`renderAppending`、`Reminder` | 4、5 | 同上 |
| S4 | `renderRequest`：历史、`last`、`as="text"`、`invocationStart`、缓存警告 | 4 | 同上 |
| S5 | `defineProfile`、`loadProfile`、目录；Spec 证据；注册表；omp 实现审查 | 6 | `bun test`、`bun run typecheck`、仓库根 `bun run governance:check` 与 `bun run docs:check` |

## 验收映射

| `harness.profile` | 测试 |
|---|---|
| 输出 1；场景 5（注册、dispose、reserved）、6（字段） | `src/profile/host.test.ts` |
| 输出 2、3、4、15；场景 3、5（`source-failed`、`unknown-node`）、13 | `src/profile/prepare.test.ts` |
| 输出 5、6、8、9、10；场景 1、4、7、11、14 | `src/profile/render.test.ts` |
| 输出 7、11；场景 2、10、12 | `src/profile/request.test.ts` |
| 输出 12、13；场景 8、9 | `src/profile/loader/loader.test.ts`（真实 `.profile.tsx`）、`src/profile/catalog.test.ts` |
| 输出 14 | 每个渲染测试里对同一输入调用两次比较，并断言取数函数的调用次数不变 |
| 失败码与诊断码表 | 各测试按码断言；每个码至少一处 |

## 验证

- 包内 `bun test src/profile`、`bun run typecheck`；`loader.test.ts` 从真实临时目录加载 `.profile.tsx`（`createTestTmpRoot`，文件由测试写入）。
- 变异检查：块级空行规则、`once` 跳过、`every` 的轮数判定、`last` 的轮切分、`invocationStart` 尾接、`refresh` 只重取 `model-call`、`dispose` 后不再可用。
- 未验证边界：runtime 的调用时序（以后在 `harness.runtime` 的测试里跑整条链）；真实模型。

## 不做与风险

- 不做：插件贡献点；Profile 设置界面；预览；旧原型 `nb-profile` 的兼容。
- 风险：JSX 对注册节点的 props 类型只能是 `Record<string, unknown>`（`IntrinsicElements` 为空，组件函数各自带类型），插件作者要导出自己的组件函数；接受。
- 风险：`defineProfile` 的标记在多份 `nb-harness` 副本之间不互认；工作区只装一份，接受。
