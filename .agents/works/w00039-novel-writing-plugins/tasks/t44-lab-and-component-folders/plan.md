# t44 计划：Lab 与组件目录的整理

## Context

开发者 2026-11-26 试用设定页时说 Lab 乱（t43 第 3 条），同意的做法（t43 README“开发者定的”第 3 条）：canon 的组件按区域分子目录、Lab 左栏跟着目录分组；场景一个状态一个，只是文字不同的不另开（`ConfirmBar` 砍到 4 个左右）；场景登记按插件拆开、放进各插件自己的目录；规则写进 Lab 的场景说明与组件规范。2026-11-27 开发者定 t45 之后先做本 Task。

现状（2026-11-27 master）：

- canon 的界面组件 49 个，连同文档、测试与辅助的 `.ts` 平铺在 `canon/web/components/`；canon 与 Lab 里有 80 个文件引用它们。
- Lab 的场景全登记在 `lab/web/fixtures/index.ts`（2876 行，269 个组件、约 1336 个场景），夹具 `.vue` 与样本平铺在 `fixtures/`（108 项）；只有 nb-ui、nb-layout、nb-agent-ui 与几个插件的 `*-scene/` 分了子目录。按插件数登记：canon 37、ui 26、models 26、workbench 24、agent 23、projects 22、stickers 18、plot 10，其余十来个插件各一到七个。
- Lab 的组件索引已经按目录递归扫描（`component-index.ts` 的 `web/components/**`），分组取“最近的、不叫 components 的那层”（`component-index-model.ts`）：组件挪进子目录，左栏就按子目录分组，不用改 Lab。
- 草稿区已经是“每个目录自己导出 `fixtures`、Lab 用 `import.meta.glob` 收集”（`lab/web/drafts/index.ts`），本计划照这个做法。

依据：[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)、[`fixtures/README.md`](../../../../../packages/neuro-book/src/plugins/lab/web/fixtures/README.md)、[组件规范](../../../../../docs/standards/code/components.md)、`src/architecture.test.ts` 的 Lab 引用规则。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 场景收集 | Vite 的 `import.meta.glob`（已在用） | 草稿区同样做法；否决手写总表（就是现在 2876 行的来源） |
| 挪文件与改引用 | `git mv` 加一次性脚本：按“旧路径 → 新路径”表改 `import` 与 Markdown 相对链接，类型检查、`docs:check` 兜底 | 规则窄、全部能被检查抓到；否决引入 ts-morph（只用一次，不值得加依赖） |

## 关键设计

### 场景放在插件自己的目录：`src/plugins/<插件>/web/lab/`

- 每个应用插件一个 `web/lab/`：`fixtures.ts` 导出 `fixtures: LabFixture[]`，同目录放这个插件的夹具 `.vue`、样本与场景用的文本端口（例如 `canon-text.ts`、`canon-images.ts` 挪到 `canon/web/lab/`）。
- Lab 收集：`lab/web/fixtures/index.ts` 只剩收集与查找，`import.meta.glob("../../*/web/lab/fixtures.ts", {eager: true})` 加上留在 Lab 里的几组，再加草稿区；“同一个组件只登记一次”的门禁（`fixtures/index.dom.test.ts`）不变。
- 场景接口：插件的 `web/lab/` 只能引 Lab 的一个入口 `lab/web/scene-kit.ts`（再导出 `defineLabFixture`、`defineSubjectFixture`、`useLabSubject`、`LabFixtureControls`、`useLabDataSink`、`useLabEventSink` 与 `LabFixture`、`LabFixtureProps` 等类型），加自己插件的代码；`LabScene`、`LabFixture` 的类型从 `fixtures/index.ts` 挪到 `fixtures/define.ts`，免得插件的场景文件与收集它们的总表互相引用。
- 架构测试（`src/architecture.test.ts`）：放行 `plugins/<p>/web/lab/**` 引 `plugins/lab/web/scene-kit` 与同插件的代码；拦下除 Lab 以外的任何文件引 `*/web/lab/`（产品代码不碰场景）。生产构建只经 Lab 的 glob 到达这些文件，`check:dist` 已查产物不含开发插件，照跑。
- 留在 Lab 里的：`src/ui/` 共用组件的场景（`fixtures/ui/`）、nb-ui 等包的场景（已有 `fixtures/nb-ui/` 等，包不能引应用）、Lab 自己的组件，各一个子目录、各自的 `fixtures.ts`，总表照同样的 glob 收（`./*/fixtures.ts`）。

### canon 的组件分子目录：`canon/web/components/<区域>/`

按作者看到的界面区域分六组（49 个组件，辅助 `.ts`、同名 `.md` 与 dom 测试跟着组件走；`web/` 根上不是组件的 `.ts` 不动）：

| 子目录 | 组件 |
|---|---|
| `entries/` 设定视图 | EntryTree、EntryPicker、NewEntryDialog |
| `entry-page/` 条目页的外壳 | EntryPage、EntryPageHost、EntryPageNav、PageHead、PageNotices、ViewPointPicker、WorldBanners、AddComponentDialog、ComponentChecklist、MoveDialog |
| `groups/` 设定组的界面与看法 | CharacterCard、CharacterView、LookCard、LookView、PanelView、PanelDataView、FieldsDataView、FieldTable、FieldDetail、ComponentAgentView、ComponentRawView、CanonImage、OriginList、PlotList |
| `editing/` 改值 | ConfirmBar、FieldInput、SuggestInput、ImageInput、RecordForm、ElementDialog |
| `text/` 主文字 | EntryText、EntryTextEditor、PlainSourceInput、TextConflictDialog |
| `revisions/` 修订、待处理与回执 | ChangePage、ChangePageHost、PendingView、PendingViewHost、PendingDetail、ReceiptPage、ReceiptPageHost、RevisionsView、RevisionsViewHost、RevertDialog、RevertHost、BreakExclusiveDialog |

- 组件的 `.md` 里指向 `docs/` 的相对链接深一层，脚本一并改；`docs:check` 查链接。
- canon 的 Lab 场景在 `canon/web/lab/` 里也按同样的六组分文件（`fixtures.ts` 合并），夹具 `.vue` 放平：一个插件的夹具几十个，不再细分。
- 别的插件这次不分子目录；规则写成“一个插件的界面组件超过 30 个时按界面区域分子目录”，到时照做。

### 场景一个状态一个

规则（写进 `fixtures/README.md`）：一个场景对应组件的一种可观察状态（结构、可用与否、反馈不同）；只是文字或数据不同、版式与交互一样的不另开。每个组件另外至多留一个英文场景（ui-development 的第 7 条：固定尺寸里放文字的组件要有）与一个长文字场景（看截断）；手机宽度用 Lab 的视口预设，不另开场景。

本 Task 精简 canon 的场景（37 个组件，场景最多的 ChangePage 35、CharacterCard 27、EntryTextEditor 21、ViewPointPicker 17、EntryPage 17、TextConflictDialog 15、ConfirmBar 14）。以 `ConfirmBar` 为样例，从 14 个留 5 个：

| 留 | 理由 |
|---|---|
| `number` 改一个数：预览写回哪里与带来的变化 | 确认条完整的一套（预览、变化、意图二选一） |
| `inline-note` 就地改：选剧情里变了，多一行“发生了什么” | 就地改的编辑卡，带选填行 |
| `inline-passage` 就地改：成段的文字 | 多行输入与 Ctrl+回车 |
| `inline-conflict` 就地改：这个值刚刚变了 | 出错的样子 |
| `inline-english` 英文界面 | 第 7 条 |

拿掉的 9 个（`accumulated`、`text`、`conflict`、`unknown`、`number-english`、`inline-since`、`inline-same-chapter`、`inline-impact`、`inline-unknown`）由 dom 测试与 e2e 覆盖的行为不变。别的 canon 组件照同一规则，每个组件“留哪几个、为什么”列成一张表（证据入库），交付时给开发者看。别的插件的场景这次不动，以后改到哪个组件照规则收。

## Spec 与文档改动

- `docs/specs/ui/component-lab.md` 输入边界那一句：登记入口从“`fixtures/index.ts` 的 `defineLabFixture`”改成“各插件 `web/lab/fixtures.ts` 经 `scene-kit` 的 `defineLabFixture` 登记、Lab 收集”。
- `packages/neuro-book/src/plugins/lab/web/fixtures/README.md`：场景放在哪、`scene-kit`、“一个状态一个场景”的规则与英文、长文字场景的例外；示例代码的路径。
- `docs/standards/code/components.md`：插件组件超过 30 个按界面区域分子目录。
- `packages/neuro-book/AGENTS.md` 的 Component Lab 一条、`.agents/skills/design-review/SKILL.md` 里过时的“`fixtures/drafts/`、在 `fixtures/index.ts` 里登记”（草稿区早已是 `lab/web/drafts/<Task>/fixtures.ts`）。

## 切片

| 片 | 内容 | 验证 |
|---|---|---|
| S1 | 场景接口与收集：`define.ts` 收类型、`scene-kit.ts`、总表改成 glob 收集、架构测试的规则；先把 Lab 自己、`src/ui/`、nb-* 包的场景归进 `fixtures/<来源>/fixtures.ts` | `fixtures/index.dom.test.ts`、`bun test src/architecture.test.ts`、typecheck；场景清单（组件 → 场景 id）改前改后逐项相同 |
| S2 | canon 组件分六个子目录：`git mv` 加改引用的脚本 | typecheck、canon 与 Lab 的 vitest、`docs:check`、`governance:check` |
| S3 | 各插件的场景搬进 `web/lab/`（脚本按组件所属插件拆分总表，夹具与只给它用的样本跟着走）；canon 按六组分文件 | 同 S1 的场景清单逐项相同、门禁、架构测试、typecheck；Lab 里点开几个插件的场景看挂得上 |
| S4 | canon 场景精简（ConfirmBar 照上表，其余照规则并列表） | 门禁；`nbdev shot` 量 canon 的全部场景（溢出、页面错误） |
| S5 | 规则与文档；收口：e2e `lab-scenes`、`lab`、`lab-nb-ui`，Sonnet 前端审查，合入 | 见“验证” |

S3 是机械搬家，规则写死、有门禁与清单对照兜底，可以派 coder（Sonnet）在自己的 worktree 里做，主会话审 diff、自己跑验证。

## 验收映射

- `ui/component-lab.md` 输入边界：`fixtures/index.dom.test.ts`（登记门禁、JSON 往返）、`architecture.test.ts`（场景只引 `scene-kit`、产品代码不引 `web/lab/`）。
- 搬家不丢场景：S1、S3 前后各导出一份“组件 → 场景 id”清单，逐项相同（S4 的精简另列）。
- 左栏按目录分组：`component-index-model` 的现有测试；Lab 里看 canon 的六组。

## 验证

- 每片：typecheck、受影响的 vitest 与 `bun test`、`docs:check`、`governance:check`。
- 收口：`bun run build`（含 `check:dist`：产物不含 `web/lab/`）、e2e `lab-scenes`（原有的 ThemeEditor 404 挡在版面比对之前时，canon 的场景用 `nbdev shot` 量）、`lab`、`lab-nb-ui`；开发服务上点开 Lab，看左栏 canon 的分组与几个插件的场景。
- 不跑产品页面的 e2e：组件只换目录，行为不变；typecheck 与 canon 的 dom 测试覆盖引用。

## 不做与风险

- 别的插件的组件这次不分子目录、场景不精简。
- 风险：canon 组件挪目录后，别的 worktree（w00055、w00056）改着同一批文件，合入时冲突。缓解：S2 单独一个提交、只挪不改内容，冲突时 Git 能认出改名；合入前先看 master 上这几个 Work 的进度。
- 风险：插件目录里多了只在开发版用的代码。缓解：架构测试拦产品代码引用、`check:dist` 查产物。

## 要开发者定的

1. 场景放各插件自己的 `web/lab/`（推荐，组件与场景在一处、改组件时顺手改场景；代价是架构测试开一个口子，插件目录里多一个开发用的子目录），还是留在 Lab 里、按插件分子目录（不开口子，但场景离组件远）。
2. canon 的六组分法（上表）。
3. `ConfirmBar` 留那 5 个；场景精简这次只做 canon。
