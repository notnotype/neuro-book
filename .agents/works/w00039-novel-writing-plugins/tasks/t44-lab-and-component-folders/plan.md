# t44 计划：Lab 与组件目录的整理

第 2 稿（2026-11-27）：按[设计审查](evidences/design-review.txt)的 15 条修订，处理见[处理记录](evidences/design-review-resolution.txt)。

## Context

开发者 2026-11-26 试用设定页时说 Lab 乱（t43 第 3 条）。同意的做法写在 t43 README“开发者定的”第 3 条：

- canon 的组件按区域分子目录，Lab 左栏跟着目录分组。
- 一个状态一个场景，只是文字不同的不另开（`ConfirmBar` 砍到 4 个左右）。
- 场景登记按插件拆开，放进各插件自己的目录。
- 规则写进 Lab 的场景说明与组件规范。

2026-11-27 开发者定 t45 之后先做本 Task，并定了三条（见 README）。

现状（2026-11-27 master）：

- **canon 的组件**：49 个界面组件，加 12 个辅助 `.ts`、29 个 dom 测试和同名文档，平铺在 `canon/web/components/`。
- **Lab 的总表**：场景全登记在 `lab/web/fixtures/index.ts`（2876 行，269 个组件、约 1336 个场景）。按插件数：canon 37、ui 26、models 26、workbench 24、agent 23、projects 22、stickers 18、plot 10，其余十来个插件各一到七个。
  - 总表里还有按领域拆出的内部函数：`shelfFixtures`、`settingsFixtures`、`canonEntryPageFixtures`、`firstRunScenes`、`plotFixtures`。
  - 还有跨场景共用的常量，例如 `PROPERTY_DECLARATIONS`、`DISPLAY_REPLY`。
- **夹具与样本**：夹具 `.vue` 与样本平铺在 `fixtures/`。另有 20 个 `*-scene/` 与 `nb-ui/`、`nb-layout/`、`nb-agent-ui/` 子目录，其中一部分被几个插件的场景共用，例如 `settings-scene/settings-host.ts`、`lab-stickers.ts`。
- **Lab 左栏**：组件索引按目录递归扫描（`component-index.ts` 的 `web/components/**`）。分组取“最近的、不叫 components 的那层”（`component-index-model.ts`），所以组件挪进子目录后左栏自动按子目录分组，不用改 Lab。

依据：

- [`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)
- [`fixtures/README.md`](../../../../../packages/neuro-book/src/plugins/lab/web/fixtures/README.md)
- [组件规范](../../../../../docs/standards/code/components.md)
- `src/architecture.test.ts` 的 Lab 引用规则

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 场景收集 | Vite 的 `import.meta.glob`（Lab 的组件索引与草稿区已在用） | 新增插件不用改总表；否决手写总表（2876 行就是这么来的） |
| 挪文件、改引用 | 自写一次性脚本 `move-files`：按“旧路径 → 新路径”表 `git mv`，改所有文件里指向被挪文件的相对引用、`nbook/plugins/…` 别名引用与 Markdown 相对链接 | 规则窄，类型检查与 `docs:check` 兜底；脚本可以重跑（见“不做与风险”）；否决 ts-morph（只用一次，不加依赖） |
| 拆总表 | 一次性脚本 `split-fixtures`，用仓库已有的 `typescript` 编译器 API 解析总表：按每条登记的组件类型导入判断它属于哪个插件，带上它用到的导入与顶层声明，输出各插件的 `fixtures.ts` | 按语法树取，不按行号切；一个顶层声明被两个插件用到时报出来、不猜；重跑得到同样结果 |

两个脚本放在本 Task 的本地目录，不进 Git。改完的结果入库。

## 关键设计

### 开发代码进入产品插件目录的边界

Lab 的场景现在全在开发插件 `plugins/lab/` 里。按目录前缀认开发代码的机制有四处，场景搬进产品插件的 `web/lab/` 后每处都要补：

| 机制 | 现状 | 本 Task 补的 |
|---|---|---|
| 架构测试 `src/architecture.test.ts` | `labSceneMayImport` 只认 `plugins/lab/web/fixtures/` 与 `drafts/`；`isDevelopmentPlugin` 按 `plugins/lab/` 认开发插件 | 见下一条 |
| 生产样式入口 `src/web/tailwind.product.css` | `@source not "../plugins/lab"`、`"./testing"` | 加 `@source not "../plugins/*/web/lab"`。先实测 Tailwind v4 认不认通配；不认就按插件逐个列，并加一条测试，见下 |
| 产物门禁 `scripts/check-dist.ts` | 按八个只在 Lab 出现的字符串查 | 场景入口 `defineLabFixture` 在登记形状不对时报错，错误文案以 `nb-lab:` 开头。这个前缀本来就在 `DEVELOPMENT_MARKERS` 里，所以任何场景文件进了产物都带着它 |
| Spec 与规则文字 | “Lab 的场景在 `web/fixtures/`” | 见“Spec 与文档改动” |

架构测试的三条规则：

1. 新增 `isLabScene(file)`：`plugins/<p>/web/lab/**`。它并入 `labSceneMayImport` 的文件判定，和现有场景一样可以引任何插件的 `web/`、`shared/`，也包括别的插件的 `web/lab/`。现有场景普遍一次引两三个插件，例如网络设置页的夹具引 models、network、settings。
2. `isLabScene` 文件引 `plugins/lab/web/scene-kit` 不算“引开发插件”。Lab 的其它模块对它们仍然不放行。
3. 新增：Lab 与 `web/lab/` 之外的文件，包括同一插件的产品代码，不得引 `*/web/lab/`。类型引用也拦，免得产品代码从场景里取类型。

“每条规则都能拦下对应的违规”那张用例表补正反例：

- 插件场景引 scene-kit：通过。
- 插件场景引 Lab 的其它模块：拦下。
- 插件场景引别的插件的 `web/`：通过。
- 产品代码引 `web/lab/`：拦下，类型引用同样拦下。

`web/testing/` 是先例：产品插件目录里放不进产品的代码。它的做法是整体跳过架构测试与 `tsconfig.web.json`。`web/lab/` 要被类型检查与架构测试扫到，所以只借命名，不借“整体跳过”。

### 场景放在插件自己的目录：`src/plugins/<插件>/web/lab/`

**目录内容**

- 每个有场景的插件一个 `web/lab/`。
- `fixtures.ts` 导出 `fixtures: LabFixture[]`。
- 同目录放这个插件的夹具 `.vue`、样本与场景用的文本端口，例如 canon 的 `canon-text.ts`、`canon-images.ts`。

**场景接口 `lab/web/scene-kit.ts`**

插件场景只经 scene-kit 用 Lab 的东西。导出清单以 grep 汇总的现有导入名为准：

- 登记：`defineLabFixture`、`defineSubjectFixture`、`createSubjectFixture`。
- 组合式函数：`useLabSubject`、`useLabEventSink`、`useLabDataSink`，以及 `LAB_EVENT_SINK`、`LAB_INPUT_SINK`、`LAB_LOCALE`。
- 组件：`LabFixtureControls`。
- 类型：`LabFixture`、`LabFixtureDefinition`、`LabScene`、`LabSceneInput`、`LabFixtureProps`、`LabSubjectProps`、`LabSlotOf`、`LabInputOf`、`LabEventOf`、`LabPropOf`、`LabJsonPropOf`。

S1 开头用 grep 再核一遍，多行导入也算进去。

`LabScene`、`LabFixture`、`LabFixtureDefinition` 三个类型从 `fixtures/index.ts` 挪到 `fixtures/define.ts`，让场景只依赖 `define.ts` 与 scene-kit，总表不再是类型的出处。总表对 `defineLabFixture` 与这几个类型的再导出保留，草稿与 `subject-fixture.ts` 还在用。

**总表与收集**

总表 `lab/web/fixtures/index.ts` 只剩三样：

- 收集：`import.meta.glob("../../../*/web/lab/fixtures.ts", {eager: true})`，排除 `lab` 自己。路径是从 `fixtures/` 起算的，比组件索引多一层。
- 留在 Lab 的几组。
- 草稿区。

收集时校验形状：模块有 `fixtures` 数组，每项有 `component` 与 `scenes`。不对就抛错，错误里带文件路径与 `nb-lab:` 前缀。glob 一个都没匹配到也抛错。

**留在 Lab 里的**

- `src/ui/` 共用组件的场景（`fixtures/ui/`）。
- nb-ui 等包的场景（已有 `fixtures/nb-ui/` 等；包不能引应用）。
- Lab 自己组件的场景。

各一个子目录、各自一个 `fixtures.ts`，总表用 `./*/fixtures.ts` 收。

**支持模块的归属**

- 只有一个插件的场景用的支持模块，跟着那个插件走。
- 被几个插件的场景共用的，放进它模拟的那个插件。例如 `settings-host.ts` 是设置页的宿主，network 与 web-tools 的场景也用它，放 `settings/web/lab/`；`lab-stickers.ts` 放 `stickers/web/lab/`。
- Lab 的包场景或草稿也用到的，同样放插件里。Lab 本来就可以引任何插件的 `web/`。
- 总表里的内部函数与共用常量照同一规则：`canonEntryPageFixtures` 进 canon，`plotFixtures` 进 plot。被两个插件用到的常量放进它描述的那个插件，从那里导出。
- `split-fixtures` 把每个跨插件使用的声明列出来，主会话逐个定归属，写进 `evidences/support-modules.txt`，脚本按这张表输出，不自己猜。

**草稿**

已入库的四个草稿目录（`lab/web/drafts/w00039-t41`、`w00039-t42`、`w00055-t01`、`w00056-t06`）用相对路径引要搬走的模块：`canon-text`、`canon-images`、`explorer-scene/memory-files`、`editor-scene/lab-editor-menus`、`lab-stickers`。

- `move-files` 的扫描范围包括 `lab/web/drafts/`，入库的草稿一起改。
- 别的草稿 worktree 里还在出稿（w00056 t06）。旧路径在 `fixtures/` 里各留一个再导出文件，头注释写明给哪些草稿 worktree 用、它们合了 master 并改完引用后删掉。删除记进 Work 的 followups。

### canon 的组件分子目录：`canon/web/components/<区域>/`

按作者看到的界面区域分六组，共 49 个组件：

| 子目录 | 组件 |
|---|---|
| `entries/` 设定视图 | EntryTree、EntryPicker、NewEntryDialog |
| `entry-page/` 条目页的外壳 | EntryPage、EntryPageHost、EntryPageNav、PageHead、PageNotices、ViewPointPicker、WorldBanners、AddComponentDialog、ComponentChecklist、MoveDialog |
| `groups/` 设定组的界面与看法 | CharacterCard、CharacterView、LookCard、LookView、PanelView、PanelDataView、FieldsDataView、FieldTable、FieldDetail、ComponentAgentView、ComponentRawView、CanonImage、OriginList、PlotList |
| `editing/` 改值 | ConfirmBar、FieldInput、SuggestInput、ImageInput、RecordForm、ElementDialog |
| `text/` 主文字 | EntryText、EntryTextEditor、PlainSourceInput、TextConflictDialog |
| `revisions/` 修订、待处理与回执 | ChangePage、ChangePageHost、PendingView、PendingViewHost、PendingDetail、ReceiptPage、ReceiptPageHost、RevisionsView、RevisionsViewHost、RevertDialog、RevertHost、BreakExclusiveDialog |

辅助件与测试的归属：

- **同名的跟组件走**：同名 `.md`、同名 dom 测试、以组件命名的辅助 `.ts`。例如 `confirm-bar.ts` 进 `editing/`，`entry-picker.ts` 进 `entries/`，`component-checklist.ts` 进 `entry-page/`。
- **没有同名组件的两个**：`entry-tabs.ts` 进 `entry-page/`（EntryPage、EntryPageNav、EntryPageHost 用它）；`ComponentViews.dom.test.ts` 进 `groups/`（测的两个组件都在那里）。
- **跨组引用照常写相对路径**：例如 `editing/FieldInput.vue` 引 `../entries/entry-picker`，`entry-page/EntryPageHost.vue` 引 `../editing/confirm-bar`。辅助件不另放一个“共用”目录：它属于以它命名的组件。

完整的“旧路径 → 新路径”表由脚本从上表生成，列全 49 个 `.vue`、12 个 `.ts`、29 个测试与同名 `.md`。生成后先人工过一遍再写入。

其它规则：

- `web/` 根上不是组件的 `.ts` 不动。
- 组件 `.md` 里指向 `docs/` 的相对链接深一层，脚本一并改；`docs:check` 查链接。
- canon 的场景在 `canon/web/lab/` 里也按六组分文件，由 `fixtures.ts` 合并。夹具 `.vue` 放平：一个插件的夹具几十个，不再细分。
- 别的插件这次不分子目录。规则写成“一个插件的界面组件超过 30 个时，下一次改到它时按界面区域分子目录”。workbench 现有 29 个。

### 场景一个状态一个

规则写进 `fixtures/README.md`：

- **分支覆盖**：组件模板里每个分支（`v-if`、`v-else`、`variant`、禁用条件）至少有一个场景走到。
- **合并**：只是文字或数据不同、走的分支一样的，合成一个。
- **英文与长文字**：每种版式（`variant` 或同类的模板分支）另外至多留一个英文场景、一个长文字场景。
  - 英文场景 id 以 `-english` 结尾，这个后缀也是夹具切换界面语言的开关（例如 `canon-text.ts` 的 `scene.endsWith("-english")`）。
  - 长文字场景以 `-long` 结尾。
  - 固定尺寸里放文字的版式要有英文场景（ui-development 第 7 条）。
- **手机宽度**：用 Lab 的视口预设，不另开场景。
- **覆盖分工**：版面由 `lab-scenes` 对保留的场景量，行为由 dom 测试覆盖。

本 Task 精简 canon 的场景：37 个组件，场景最多的几个是 ChangePage 35、CharacterCard 27、EntryTextEditor 21、ViewPointPicker 17、EntryPage 17、TextConflictDialog 15、ConfirmBar 14。

`ConfirmBar` 作样例。它的模板分两套：`bar`（第 162 行起）与 `inline`（第 181 行起）。两套里各有几处分支：

- 意图二选一（`intentOptions.length > 1`）；
- 预览与变化，以及 inline 的“还有 N 项”提示；
- 出错与“再查一次”；
- inline 的“发生了什么”一行留位或显示；
- 单行回车与成段 Ctrl+回车；
- 保存是否可用。

按规则从 14 个留 6 个：

| 留 | 走到的分支 |
|---|---|
| `number` | bar：二选一、预览带变化列表、保存可用 |
| `unknown` | bar：只有一个意图（不画二选一）、出错带“再查一次” |
| `inline-note` | inline：二选一、选剧情时显示“发生了什么”、单行回车 |
| `inline-passage` | inline：成段文字、Ctrl+回车；改成变化三条，同时走到“还有 N 项”与“发生了什么”留位但收起 |
| `inline-unknown` | inline：只有一个意图、出错带“再查一次”、没有预览所以保存不可用 |
| `inline-english` | inline 的英文：单行截断的提示与二选一的标签 |

拿掉的 8 个，各自走的分支已被上表覆盖：

- `accumulated`：被锁的保存按钮，与 `inline-unknown` 的不可用同一个分支；
- `text`：同 `unknown`；
- `conflict`：同 `unknown`，只是没有按钮；
- `number-english`：bar 不是固定尺寸，不留英文；
- `inline-since`、`inline-same-chapter`：只是文字不同；
- `inline-impact`：并入 `inline-passage`；
- `inline-conflict`：同 `inline-unknown`。

开发者批的是 5 个；照规则是 6 个，交付时说明。别的 canon 组件照同一规则做，每个组件写一张“分支 → 留下的场景”表，入库到 `evidences/scene-pruning.txt`，交付时给开发者看。别的插件的场景这次不动，以后改到哪个组件就按规则收哪个。

## Spec 与文档改动

- **`docs/specs/ui/component-lab.md`**：
  - 输入边界的登记入口改成“各插件 `web/lab/fixtures.ts` 经 scene-kit 的 `defineLabFixture` 登记，Lab 收集”。
  - 第 43 行的登记门禁文件名。
  - 第 84 行草稿区“与场景相同”。
  - 第 85 行与验收 10“产物中不含 Lab 模块、fixture”：加上 `web/lab/`。
  - 第 120、140 行。
  - 第 171 到 174 行的 owner、例外与索引边界：加 `plugins/<p>/web/lab/`。
- **`docs/specs/ui/component-lab-timeline.md`** 第 67、85 行的门禁文件名。
- **`packages/neuro-book/AGENTS.md`**：第 15 行的 Lab 例外句、Component Lab 一条。`src/architecture.test.ts` 的头注释同改。
- **`packages/neuro-book/src/plugins/lab/web/fixtures/README.md`**：
  - 场景放在哪、scene-kit 是什么、支持模块的归属。
  - “一个状态一个场景”的规则，以及 `-english`、`-long` 后缀。
  - 第 72、116、174 到 176 行的示例路径。
- **零散文字**：`fixtures/index.dom.test.ts` 的失败文案（“在 fixtures/index.ts 里登记”）、`FixtureExampleFixture.vue` 第 9 行注释、`e2e/lab-scenes.e2e.ts` 头注释。
- **`docs/standards/code/components.md`**：
  - 组件超过 30 个按界面区域分子目录。
  - 一句说明场景在插件的 `web/lab/`、经 scene-kit 登记。
- **`.agents/skills/design-review/SKILL.md`**：过时的“`fixtures/drafts/`、在 `fixtures/index.ts` 里登记”。草稿区早已是 `lab/web/drafts/<Task>/fixtures.ts`。

S5 的验收：在 `docs/`、`packages/neuro-book`（不含 legacy）、`.agents/skills` 里搜 `fixtures/index`、`web/fixtures/`，剩下的每一处都确认还对。

## 切片

S1→S2→S3→S4 严格串行，每片单独提交。

| 片 | 内容 | 验证 |
|---|---|---|
| S1 | 边界与收集：scene-kit、类型挪进 `define.ts`、总表改成 glob 收集并校验形状、架构测试三条规则与正反例、Tailwind 排除、`defineLabFixture` 校验；门禁扫描根扩到 `plugins/*/web/lab/`（见“验收映射”）；Lab 自己、`src/ui/`、nb-* 包的场景归进 `fixtures/<来源>/fixtures.ts` | 场景快照逐字相同；`fixtures/index.dom.test.ts`；`bun test src/architecture.test.ts`；typecheck；`bun run build` 前后对比产物 CSS 字节数 |
| S2 | canon 组件分六个子目录：`move-files` 按表挪、改引用，只挪不改内容 | typecheck；canon 与 Lab 的 vitest；`docs:check`；`governance:check`；场景快照逐字相同 |
| S3 | 各插件的场景搬进 `web/lab/`：`split-fixtures` 按归属表拆总表，`move-files` 挪夹具与支持模块；canon 按六组分文件；旧路径的再导出 | 场景快照逐字相同；门禁；架构测试；typecheck；S3 提交后马上跑 `lab-scenes` |
| S4 | canon 场景精简：ConfirmBar 照上表，其余照规则并列表 | 门禁；`lab-scenes` 中 canon 的部分，或 `nbdev shot` 量 canon 的全部场景（溢出、页面错误） |
| S5 | 规则与文档；收口：e2e `lab-scenes`、`lab`、`lab-nb-ui`，Sonnet 前端审查，合入 | 见“验证” |

S2、S3 由主会话自己做：归属要逐个定，脚本的输出要逐处审。

**场景快照**：一个临时的 Vitest 文件，放进 `fixtures/` 跑完就删，不入库。它把 `labFixtures` 写成排序后的 JSON：

- 每个组件的 `component`、`slots`、`noInput`；
- 每个场景的 `id`、`label`、`input`（全量）；
- `load()` 解析出的组件名。

S1 动手前存一份基线。S1、S2、S3 之后各导出一次，与基线逐字比对。S4 之后另存一份，对照精简表，只少了表里拿掉的场景。

## 验收映射

- **`ui/component-lab.md` 输入边界**：
  - `fixtures/index.dom.test.ts`：登记门禁、JSON 往返、扫描根扩展后的相对导入与“假盒子”检查。
  - 新的一条：每个 `plugins/*/web/lab/` 都有 `fixtures.ts`，并被总表收到。
  - `architecture.test.ts`：三条规则的正反例。
- **验收 10（产物门禁）**：
  - `bun run build` 里的 `check:dist`。
  - `defineLabFixture` 校验的单测：形状不对时抛 `nb-lab:` 开头的错。
  - Tailwind 排除不认通配、只能按插件逐个列时，补一条测试：`plugins/*/web/lab/` 都在排除列表里。
- **搬家不丢场景**：场景快照逐字相同（S1、S2、S3）；S4 对照精简表。
- **左栏按目录分组**：`component-index-model` 的现有测试；开发服务上看 canon 的六组。

## 验证

- **每片**：typecheck、受影响的 vitest 与 `bun test`、`docs:check`、`governance:check`。
- **收口**：
  - `bun run build`，含 `check:dist`。
  - e2e `lab-scenes`。原有的 ThemeEditor 404 挡在版面比对之前时，canon 的场景用 `nbdev shot` 量。
  - e2e `lab`、`lab-nb-ui`。
  - 开发服务上点开 Lab，看左栏 canon 的分组和几个插件的场景。
- **不跑产品页面的 e2e**：组件只换目录，行为不变；typecheck 与 canon 的 dom 测试覆盖引用。

## 不做与风险

- 别的插件的组件这次不分子目录，场景也不精简。
- **风险：与 w00055 冲突**。w00055 t02 在等真实 Agent 的评测，评测交回后合入。它改了 canon 的 `text/`、`editing/` 几个组件，以及总表里 `canonEntryPageFixtures` 一带的 6 处场景。
  - 缓解：S2、S3 全部由脚本完成，脚本和归属表留在本地，可以重跑。t44 合入前 w00055 先合了，就把 t44 变基到新 master，S2、S3 用脚本在新 master 上重做，不逐处解冲突；S4 的精简表按场景 id 列，重放即可。t44 先合，w00055 合 master 时它的 6 处场景改动重放到 `canon/web/lab/` 里对应的文件。
  - 合入前看一眼 w00055 的状态。
- **风险：草稿 worktree 合 master 后引用断掉**。缓解：旧路径的再导出文件，见“草稿”。
- **风险：插件目录里多了只在开发版用的代码**。缓解：见“开发代码进入产品插件目录的边界”。

## 开发者已定的

1. 场景放各插件自己的 `web/lab/`。
2. canon 按上表分六组。
3. `ConfirmBar` 留 5 个，场景精简这次只做 canon。第 2 稿照“每个分支至少一个场景”重选，结果是 6 个，见上表。
