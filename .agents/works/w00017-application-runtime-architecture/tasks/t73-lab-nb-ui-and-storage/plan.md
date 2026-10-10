# t73 实施计划：nb-ui 进 Lab、Lab 偏好改存 Storage

## Context

- **为什么做**：开发者 2026-10-10 决定第 6 步之后先做 workbench 与 Lab，Lab 在前。现状有三个缺口：
  - 新 Lab 只扫描新应用自己的组件（`src/ui/`、`src/plugins/*/web/components/`），约 15 个场景；
  - nb-ui 的 81 个组件（79 份同名文档）看不到。它们的场景（52 个 fixture）在 nb-ui 自己的 Nuxt playground Lab 里，登记与检视方式和新 Lab 不同；
  - Lab 的界面偏好写 localStorage、会话状态写 sessionStorage。浏览器存储按来源隔离：开发页 3000、正式 4217、端口顺延后的 4317 各是一份，换个端口偏好就丢；这也不符合新应用“程序替用户记住的东西归 `nbook.storage`”的分工（[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)）。
- **期望结果**：
  - Lab 的组件树多出 `nb-ui/` 一组，每个可挂载组件至少一个场景，覆盖门禁照常拦截缺档；
  - Lab 偏好存在 user 分区的 `shared` 记录里，换端口、换窗口、换浏览器都是同一份；
  - 标签页内的状态（组件、场景、画布、缩放、检视页签）全部在地址栏，刷新与分享链接得到同一画面；
  - 整个 Lab 不再写 localStorage 与 sessionStorage。宿主自己的客户端身份 `nbook.client-identity` 不属于 Lab，不动。
- **依据**：[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)、[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)（没有 session 作用域，“刷新后要保留的状态放进 URL”）、[`state/store.md`](../../../../../docs/specs/state/store.md)、[组件规范](../../../../../docs/standards/code/components.md)、nb-ui 的 [`ui-development-spec.md`](../../../../../packages/nb-ui/docs/ui-development-spec.md)。
- **开发者已定**（2026-10-10）：
  - 先完善新 Lab，nb-ui 进 Lab；
  - Lab 的 localStorage 改掉；
  - 迁移中可以适当排错、优化、调整样式。
- **工作方式**：
  - 在 worktree `.worktree/w00017-runtime-foundation` 逐片提交，只暂存本片文件；
  - 测试用真实 Storage、真实浏览器，不用 mock、spy、假计时器与固定等待；
  - 默认一个 omp 会话做实现审查。

## 关键设计

### 1. nb-ui 的文档与组件来源（`packages/nb-ui/src/lab/`）

- **新增公开入口** `@notnotype/nb-ui/lab-sources`（文件 `src/lab/sources.ts`，`package.json` 的 `exports` 加一行）。它导出两样东西：
  - `nbUiComponentDocs`：组件文档原文，用 `import.meta.glob("../components/**/*.md", {query: "?raw", import: "default", eager: true})` 取得；
  - `nbUiComponentModules`：组件模块的懒加载表，取自 `../components/**/*.vue`。
  - 文件头写 `/// <reference types="vite/client" />`，并注明只供 Vite 消费方使用：Bun 测试不导入它，新应用 Lab 的 `component-index.ts` 本来就只在 Vite 里运行。
- **为什么不在 Lab 里直接 glob nb-ui 的源码目录**：那是跨包深导入，违反“跨包只经包名与公开入口”。由 nb-ui 自己导出，目录结构就仍是 nb-ui 的内部事务。

### 2. 组件索引并入第三个来源（`packages/neuro-book/src/plugins/lab/web/`）

- **`component-index.ts`**：
  - 合并 nb-ui 的两张表，逻辑路径为 `nb-ui/<分类>/<组件>.md`，分类就是 nb-ui 的 `controls`、`display`、`feedback`、`form`、`layout`、`navigation`；
  - 组件树因此多一个顶层组 `nb-ui`，下分六类。
- **`component-index-model.ts`**：
  - 规定组件名在全部来源中唯一。重名时第二个条目不进索引，并给开发诊断。现在没有重名；以后迁移旧组件时可能出现，比如旧应用也有 `ContextMenu`；
  - `component-index-model.test.ts` 补重名用例。
- **挂载规则不变**：由文档标签推导。nb-ui 文档已有 `标签:` frontmatter，格式与新应用一致。
  - `NotificationViewport` 带 `state:shared-write`，会显示为“只能在正式界面验证”；
  - 只在宿主里成立的零件补 `验证入口:`。实施时核实：`MenuNodes`、`ContextMenuPanel`、`GridBranchRenderer` 没有同名文档、不进索引；`DropIndicatorLabel`、`TimePickerDefault` 能独立挂载；只有 `GridRenderer`（布局由宿主算出）标 `验证入口: WorkbenchShellLayout`。

### 3. nb-ui 场景迁移（`src/plugins/lab/web/fixtures/nb-ui/`）

- **来源**：把 nb-ui playground 的 52 个 fixture（`packages/nb-ui/playground/app/component-lab/fixtures/`）改写成新 Lab 的登记方式。
  - 只需绑定输入、记录事件的，用 `defineSubjectFixture`，不写 `.vue`；
  - 需要组合演示的，写 `.vue` 并用 `defineLabFixture<typeof C>`。
- **场景与输入怎么换**（审查 P04：不是机械搬运，按新 Lab 的规则重写）：
  - playground `registry.ts` 每个组件的 `scenes` 换成新 Lab 的场景，`controls`（布尔、文本、选择）换成场景的 `input.props`，在数据页签里编辑；受控值进 `model` 层，组件自己回写；
  - `events` 名单换成事件声明；`targetSelector` 换成 `data-lab-subject`；根是片段或传送门的组件（抽屉等）不加标记；
  - playground 里在一个场景平铺多套方案、切设计稿（例如 Button 的 BH1-A 到 D）的部分不迁：新 Lab 规定一个场景一个组件，设计实验不是组件合同；
  - 每个旧 fixture 的去向（新场景、删去的内容与原因）写进证据 `evidences/s2-migration.md`（审查 F03）。
- **透传登记的两处扩展**（`fixtures/subject-fixture.ts`）：`slotPresets` 给按钮文字、触发器这类固定插槽内容，登记的插槽就是它的键；`rootless` 声明根是片段或传送门、不加 `data-lab-subject`。
- **值不是 JSON 的组件**：日期与时间组件的值是 `@internationalized/date` 对象，进不了场景输入；场景从空值开始，当非受控组件用，选出的值记进事件页签。泛型组件 `Table` 用实例化表达式按具体行类型检查场景输入。
- **补齐与登记**：
  - 没有 fixture 的约 30 个组件补场景，例如 `Dialog`、`ContextMenu`、`Tooltip`、`Table`、`TagInput`、`Combobox`、`FileTree`；
  - 登记放在 `fixtures/nb-ui/index.ts`，由 `fixtures/index.ts` 合并，不让一个登记文件涨到几千行。
- **覆盖门禁**：`fixtures/index.dom.test.ts` 照常要求每个可挂载组件至少一个非空场景，nb-ui 组件同样适用。它只证明登记合法；场景真的挂得上、没有页面错误，由新增的 e2e 遍历全部登记场景守住（审查 P04）。
- **排错与样式**：迁移时用 `lab:shot` 扫全部 nb-ui 组件。
  - 组合：手机与 1400×900 两种画布，深色与浅色两种配色；
  - 横向溢出、控制台错误、焦点与键盘问题，在 nb-ui 里修，同时补该组件的 Vitest 合同或场景；
  - 每处修正记进 Task README，不在原 fixture 里绕过问题；
  - 测量本身的误报在 Lab 里修：`window.__nbLab.measure()` 跳过看不见的元素（透明、隐藏、视觉隐藏的读屏元素）。

### 4. 偏好改存 Storage（`lab-preferences-store.ts`、`use-lab-preferences.ts`、`plugin.ts`）

- **记录**：`defineRecord({key: "lab.preferences", scope: "user", locality: "shared", version: 1, schema})`。
  - schema 用 TypeBox 写出现有的字段白名单与类型：主题、配色、桌面背景、画布背景、侧栏开合与宽度；
  - 写法参照 `src/plugins/explorer/web/preferences.ts`；
  - 用 `shared` 而不是 `local`：`local` 记录按客户端身份分开，而客户端身份写在各来源自己的 localStorage 里，换端口就是另一个身份、另一份记录，正好重演现在的问题。Lab 是开发工具，同一状态根下共用一份偏好就够。
- **store**：`defineStore("lab", ({persist}) => …)`。
  - action 有 `update(patch)`、`resetDefaults()`、`retry()`、`discard()`。`update` 按字段合并后 `commit`；`resetDefaults` 用字段的 `reset({})` 写入空对象（审查 P01：store 的字段没有删除操作，记录里没有的字段就是默认值；`reset` 对受保护的记录同样可用，原件由 Storage 存进原件区）；
  - 保存暂停（确定失败、结果未知）期间新的修改只改显示，记下最后一份，恢复后再提交，沿用资源管理器偏好的 `commitLatest`；
  - 拖动侧栏宽度或画布尺寸时，拖动中只用 `show` 改显示，松手才 `commit`，不在拖动中连写；
  - 主题、配色、背景这类离散选择立即提交。
- **装配**：
  - Lab 插件的浏览器入口加依赖 `storageKey` 与 `diagnosticsKey`，激活时 `create` store；
  - 页面贡献的 `load()` 返回一个带着 store 的页面组件，用渲染函数包一层把 store 作为 prop 交给 `LabPage`，与工作台 `home-page.ts` 的做法相同。
- **界面状态**（审查 P03、F01）：偏好只有一条记录，由字段状态推出唯一一种呈现，复用资源管理器的 `fieldProblem` 分类：

  | 字段状态 | 呈现 | 操作 |
  |---|---|---|
  | `ready` 为假 | 外壳只显示占位，不先用默认主题画一帧 | 无 |
  | `failure` 不为空（打开或读取失败） | 用默认值运行；工具条提示“偏好没能读取（失败码）” | 重试：`reopen` |
  | 快照为 `corrupt`、`unsupported-version` | 用默认值运行；提示“偏好记录损坏或版本不认识，不会覆盖” | 恢复默认：`reset({})` |
  | `save` 为 `failed`、`unknown` | 显示仍是修改后的值；提示“偏好没保存上（失败码）” | 重试 `retry`、放弃 `discardAll` |
  | 其余 | 不提示；保存成功也不弹通知 | 无 |

  `ready` 在读取失败时同样会变真（`state.store` 输出），所以不会永远停在占位。
- **校验**：
  - 记录的 schema 只管结构；
  - 主题、配色、背景是否在当前目录里，仍按现有的逐字段规则在读取后核对，不认识的字段回到默认值，其它字段照常生效；
  - 目录随已安装的主题包变化，不写进 schema。
- **删除的部分**：
  - `KeyValueStorage` 接口、localStorage 与 sessionStorage 的全部路径；
  - “sessionStorage 不可用时回写 localStorage”的兜底；
  - `use-lab-preferences.test.ts` 与 `lab-preferences-store.test.ts` 改为在真实 Storage 上测，测试场地复用 `src/plugins/storage/testing/world.ts`。

### 5. 标签页内的状态进地址栏（`lab-url.ts`、`LabShell.vue`）

- **参数**：
  - 现有参数 `c`、`s`、`vp`、`cw`、`theme` 保留；
  - 新增 `zoom`（缩放档位）与 `tab`（检视页签：`docs`、`element`、`events`、`data`）；
  - 不认识或越界的值照旧忽略。
- **同步方式**（审查 P02）：经宿主的 Vue Router 改地址，不直接调 History API，否则 Router 记录的当前路由与地址栏不一致，离开 `reloadOnLeave` 页面时会按旧地址整页加载：
  - 切组件用 `router.push({query})`，浏览器的后退回到上一个组件；
  - 选场景、改画布、改缩放、切页签用 `router.replace({query})`；
  - 后退前进由 Router 的当前路由驱动 Lab 的状态，不再单独监听 `popstate`；
  - 保留不认识的查询参数，旧别名 `component`、`scene` 读到后换成 `c`、`s`；
  - `cw` 与 `theme` 仍是“地址栏指定、随之写入偏好”。
- **复制场景链接**（审查 F02）：工具条加一个按钮，复制只含有效参数的规范地址；请求的场景不存在而回落到第一个时，给一条可见提示。
- **为什么不再需要 sessionStorage**：
  - 刷新：地址栏里就是当前状态；
  - 新标签页：不带参数时打开第一个组件，偏好里的主题照常生效；
  - 两个标签页各自的地址互不影响，正是原来 sessionStorage 想要的隔离。

### 6. 拆分 `LabShell.vue`（2008 行）

这次要改它的偏好、地址栏与布局接线，顺带拆开（Spec 里写着“拆分已延期”，这次完成）：

| 新文件 | 内容 |
|---|---|
| `LabToolbar.vue` | 画布工具条：场景、画布预设、缩放、主题、配色、背景 |
| `LabNavPanel.vue` | 左栏组件树与检索 |
| `LabInspectPanel.vue` | 右栏四个页签 |
| `use-lab-session.ts` | 地址栏状态的读写 |
| `use-lab-layout.ts` | 侧栏宽度、窄屏收起 |

- `LabShell.vue` 只留装配与舞台；
- 行为不变，以现有 Lab e2e 守住；
- 组件拆出后各自带同名 `.md`。它们是 Lab 自己的零件，按组件规范登记。

### 7. 不变量

- **请求**：加载 `/lab` 时，`/api/` 请求仍只有浏览器引导接口一个。读写偏好走 RPC 到 `nbook.storage`，这是 Lab 自己的记录，不是产品数据；
- **fixture**：fixture 仍不碰 Storage、不发请求，只有外壳读写偏好；
- **主题**：Lab 的主题与配色仍不读写产品的 `nbook.workbench/theme`，离开 Lab 整页加载；
- **产物**：`check:dist` 照旧通过，生产产物里没有 Lab 与 fixture，也没有 `@notnotype/nb-ui/lab-sources`；它只被 Lab 引用。`check:dist` 的开发标记加上组件文档的 frontmatter 特征 `标签: [`：产品代码误引 `lab-sources` 时文档原文会进包、被拦下（审查 P06，以一次故意误引的变异检查证明）。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/component-lab.md` | 偏好存 `nbook.storage` 的 `lab.preferences`（user、shared）；会话状态改为地址栏，参数补 `zoom`、`tab`；删去 localStorage、sessionStorage 的字段表与失败条目，改写为 Storage 读不到与保存失败时的行为；组件索引的来源加 nb-ui 的公开入口，组件名全局唯一；验收 1、8、9、13 改写，新增“换端口或第二个窗口读到同一份偏好”“nb-ui 组件出现在 `nb-ui` 组并能挂载”；“t09 拆分已延期”一句删去 |
| `packages/nb-ui/AGENTS.md`、`packages/nb-ui/docs/ui-development-spec.md` | “组件实验在 playground `/lab` 登记”改为在新应用 Lab 登记（playground Lab 退役） |
| `packages/nb-ui/package.json` | `exports` 加 `./lab-sources` |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | `component-lab.md` 与 nb-ui 文档 | `bun run docs:check`、`bun run governance:check` |
| S1+S2 | 1、2、3 | nb-ui 公开入口、索引并入、重名规则、75 个组件的场景（同一提交，覆盖门禁才是绿的）；已完成 `5c4a5f19` | 索引模型 Bun 测试；nb-ui 与 neuro-book `typecheck`；`build` 与 `check:dist`；`fixtures/index.dom.test.ts`；`lab:shot` 全部 nb-ui 组件 × 2 画布 × 2 配色 |
| S2b | 3、7 | 迁移对照表、遍历全部登记场景的 e2e、`check:dist` 的 `lab-sources` 标记 | 新 e2e；`check:dist` 的变异检查 |
| S3 | 4、5 | 偏好改存 Storage、界面状态、Router 维护地址栏、复制场景链接、删去浏览器存储 | 偏好 store 在真实 Storage 上的 Bun 测试；`e2e/lab.e2e.ts` |
| S4 | 6 | 拆分 `LabShell.vue` | 全部 Lab e2e（`lab*.e2e.ts`）、`lab:shot` 抽查 |
| S5 | 开发者已定的 2、3 | 变量页签与元素页签的结构检查迁入；playground Lab 退役 | 变量与检查的 DOM 测试；Lab e2e；nb-ui `typecheck` |
| S6 | 收口 | 证据、omp 审查与修正 | `bun run test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check` |

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| component-lab 验收 1（只有引导接口一个 `/api/` 请求，不写 Lab 的浏览器存储键） | `e2e/lab.e2e.ts`：加载后 localStorage 只有 `nbook.client-identity`，sessionStorage 为空 |
| 验收 2、3（场景切换、不可挂载条目） | 现有 e2e；nb-ui 的 `NotificationViewport` 与带 `验证入口` 的零件各点一个 |
| 验收 8（偏好恢复、恢复默认） | e2e：改主题、侧栏与画布后刷新恢复；另开第二个窗口读到同一份；“恢复 Lab 默认配置”后记录是空对象、界面回默认 |
| 验收 9（坏记录与失败） | Bun（`storage/testing/world.ts` 的真实 Storage）：写入不认识的主题 id 与越界宽度，读取后只丢这两项；记录损坏、版本不认识时呈现“受保护”，恢复默认后可写；打开失败呈现“没能读取”，重试后恢复；保存失败与结果未知时呈现“没保存上”，暂停期间的多次修改恢复后只提交最后一份 |
| 新增：两个窗口同时改不同字段 | e2e（审查 P05）：两个 `/lab` 窗口分别改主题与侧栏宽度，制造一次条件冲突，两项都落盘，刷新后两个窗口一致 |
| 新增：全部场景挂得上 | e2e：按 `window.__nbLab.scenes` 遍历全部登记场景，每个都就绪、没有页面错误与控制台错误 |
| 新增：地址栏与 Router 一致 | e2e：切组件 A、B，后退，再离开 `/lab`，地址栏、Router 当前路由与整页加载的目标一致 |
| 验收 12（分层输入） | 每个迁移的 nb-ui 场景经类型化登记，`bun run typecheck` 与覆盖门禁 |
| 验收 13（地址栏） | e2e：`/lab?c=Button&s=…&vp=phone&zoom=…&tab=data` 直接打开该画面；切场景后刷新仍在原处 |
| 新增：换端口读到同一份偏好 | e2e：同一状态根先后用两个端口启动开发后端，偏好相同 |

## 验证

- **端到端**：开发模式 `bun run dev`，用 Playwright 的本机 Chrome 跑 Lab 的 e2e。另用 `lab:shot` 对全部 nb-ui 组件出截图与溢出报告，存进 Task 证据。
- **人工观察**：在 `/lab` 检查 nb-ui 组的导航、文档页签与数据页签；四种主题与配色组合各看一遍代表组件。
- **审查**：计划审查报告见 `evidences/design-review.txt`（omp 一个会话，14 条问题、7 条补充；t73 的 P01–P06、F01–F03 已并入本计划，t74、t75 的条目写进各自的 Task 与提案）。
- **未验证的边界**：
  - 壁纸保留 IndexedDB，仍按浏览器来源各存一份；
  - Windows、macOS 未实测。

## 不做

- 迁移旧应用的业务组件与它们的场景，比如 Agent、设置、书架：随各自的 Task 进来。标题栏随 t74，书架页随 t75；
- 产品主题的改动；
- nb-ui 的 Nuxt 入口（`./nuxt`）与旧应用对它的使用。

## 开发者已定的三项（2026-10-10）

1. **自定义壁纸保留 IndexedDB**：图片有几 MB，Storage 单条记录最多 1 MiB，Files 只收文本。壁纸是 Lab 专属的开发便利，换端口后要重新选一次。
2. **nb-ui playground 的 Lab 退役**：场景迁完后删除 playground 的 `/lab` 与 `component-lab/`，nb-ui 的组件实验统一在新应用 Lab 登记；playground 其余页面（`/components` 组合验收等）与 Nuxt 一起留到以后。
3. **迁入 playground Lab 独有的两项功能**：设计变量编辑器（覆盖 token、导入导出）作为检视栏第五个页签“变量”；结构检查（aria 与计算样式读数）并进“元素”页签。

## 风险

- **迁移量**：约 80 个组件的场景是这个 Task 的主体。先迁已有的 52 个，覆盖门禁会逐步收紧；中途提交时门禁必须是绿的，未迁的组件暂时在文档里标注阻断原因，迁完再去掉。
- **首帧等待 Storage**：Storage 读取经 RPC，正常几十毫秒。服务端不可达时 Lab 本来也打不开，因为窗口启动就失败。
- **拆分 `LabShell.vue` 可能碰坏细节交互**：现有 e2e 先跑一遍定基线，拆分前后逐项对照。
