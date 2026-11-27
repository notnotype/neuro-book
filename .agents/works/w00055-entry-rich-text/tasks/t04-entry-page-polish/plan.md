# t04 实施计划：条目页的页头、文字空态与新建对话框

## Context

开发者 2026-11-27 说新建条目对话框不够友好、空白条目的页头中间和右边很空。请 Gemini 当顾问看过（[对话框](evidences/designer-dialog.txt)、[页头](evidences/designer-head.txt)），出了两轮静态稿（Lab 草稿区 `drafts/w00055-t04/`），[评审板](artifacts/review/index.html)两轮的决定见 [Task README 的决定](README.md#决定)：页头两栏、人物有立绘时放小头像（底齐别名一行）、文字分页空态是一行淡的占位、新建对话框横版（不要太宽、右下不留空白）、字段改名表。

依据：[`canon/author-ui`](../../../../../docs/specs/canon/author-ui.md) 输出 4（新建条目）、6（页头与面包屑）、38（页头的就地改与别名）、39（主文字整篇编辑的入口）。

工作方式：在 Work 分支 `feat/w00055-entry-rich-text`（worktree `.worktree/w00055-entry-rich-text`）上先并入 master，主会话自己写（改动集中在几个组件，不派子代理），每片提交，收口派 Sonnet 做前端实现审查，合入 master。

## 技术选型

无新依赖。条目的候选改用已有的 `EntryPicker`（`components/entries/EntryPicker.vue`，按名字与别名在整个世界里找，`MoveDialog` 已经这样用）；分组、出场用 nb-ui 的 `SearchSelect`；可展开的一段用 nb-ui 的 `Collapsible`（高度与透明度过渡已在里面）。

## 关键设计

### 1. 新建对话框 `components/entries/NewEntryDialog.vue`（与 `.md`、`new-entry.ts`、`entries-view.ts`）

- `Dialog` 取 `size="lg"`、宽 720；正文两栏（各约 330，栏距 32），640 以下上下排。
- 左栏：名字（必填，名字框里回车即新建，名字为空时不新建）；种类（输入框加一排常用种类的按钮，选中的用强调色浅底、`aria-pressed`）；“位置与出场”一段（`Collapsible`，缺省收起；段头写“位置与出场”，右边单行截断写现在的值，例如“人物 · 星瑕的马甲 · 第 3 章出场”）。段里依次：分组（`SearchSelect`，候选是已有分组，也能新写）、是谁的马甲（`EntryPicker`，缺省“不是马甲”）、上级条目（`EntryPicker`，缺省“无”；选了本体以后这一项换成一行“某某（跟着本体）”，不给框）、出场（`SearchSelect`，“一开始就在”与各章开头）。
- 右栏：标题“设定组”，下面是现有的 `ComponentChecklist`；列表高度跟左栏走（`maxHeight` 取左栏收起时的高度，展开“位置与出场”时跟着变高），右下不留大块空白。勾选动过、且与选定种类的默认不同时，“恢复某某的默认”出现在“设定组”标题那一行的右端（绝对定位，不推动列表）；点了把勾选换回默认并清掉 `typesTouched`。
- 标题：从“新建人物”打开（草稿的种类预选为人物）时写“新建人物”，否则“新建条目”。
- 改名：启用哪些数据 → 设定组；放在谁下面／最上面一层 → 上级条目／无；它是谁的另一个身份／不是 → 是谁的马甲／不是马甲；从哪里出场 → 出场。改 zh、en 两份文案目录，旧键删掉。
- 宿主（`entries-view.ts`）：条目候选不再只来自树里读到的条目，`EntryPicker` 自己找；标题栏“新建条目”在设定树选中了某一项时，分组预填为它所在的分组、上级预填为它的上级（新建成它的同层，右键“在它下面新建”照旧是它的下层）；选中的是分组时只预填分组。
- `ComponentChecklist`：与当前勾选一致的预设现在看起来像不可用（灰字），改成选中的样子（强调色浅底、`aria-pressed`）；“添加一组设定”对话框同样受益。

### 2. 页头 `components/entry-page/EntryPage.vue`（与 `.md`、`EntryPageHost.vue`）

- 页头分两栏：左栏（弹性）依次名字（后面“是谁：某某”）、简介、别名；右栏定宽 240、左边一条发丝线，上面是“种类”“出场”两行事实，名字那一行右端是“更多”，下端是“在看”（仍贴着内容的那一行，w00039 t42 定的位置）。编辑区窄到放不下两栏（容器宽 600 以下）时右栏折到左栏下面成一行，没有竖线。
- 事实：种类写种类，没有时写“未定”（淡色）；出场写“一开始就在”或“第 N 章开头”。两项都是按钮，点了打开已有的“移动到……”对话框（输出 41，那里能改种类与出场）；不能写时不可点。分组与上级不写（面包屑里有）。
- 头像：条目有“形象”这组设定、在看的位置上立绘有图时，左栏最前面放 88 见方的头像（`CanonImage`，圆角取面板档，`object-position: top`），顶齐名字、底齐别名；这时简介单行截断（悬停看全文），三行高度固定。点头像切到“形象”分页。没有图、没有形象这一组时这一格不画。立绘由宿主从读到的条目里取（同 `CharacterView` 的 `portrait`：`LOOK_COMPONENT` 命名空间的 `立绘.图片`）。
- “添加别名”的加号与名字左对齐（按钮的内边距用负外边距抵掉）。
- 新增属性：`kind?: string`、`appears?: string`（已写成“一开始就在”或“第 N 章开头”的文字，宿主按章表写）、`portrait?: {path: string; alt: string} | null`；事件 `edit-place`（点种类或出场）、`open-look`（点头像）。宿主接上已有的移动对话框与切分页。

### 3. 文字分页的空态 `components/text/EntryText.vue`

- 没有主文字、能写时：不再是“还没有主文字”加主按钮“开始写”，换成整行可点的一行淡字“写点什么…”（铅笔图标，指着时浮出浅底），点了与“开始写”一样进编辑；不能写时同一行不可点、悬停写原因。不能写也不可编辑的读者（`editable` 为假）只看到一行淡字“还没有主文字”。
- `data-text-edit` 留在这一行上，e2e 的定位照旧；读屏名“开始写”。

## Spec 与文档改动

- `docs/specs/canon/author-ui.md`：输出 4 按横版与改名重写（候选改成按名字与别名在整个世界里找，去掉“只来自树里读到的条目”）；输出 6 写两栏页头、事实、头像；输出 38 补“添加别名”对齐不必写（实现细节），只写头像与事实的点击；输出 39 的“开始写”改成空态那一行。先在 master 上把这些句子写好、标（planned），实施合入后去掉标记。
- 组件同名 `.md`：`NewEntryDialog`、`EntryPage`、`EntryText`、`ComponentChecklist`。
- Lab：`entries.scenes.ts` 的 NewEntryDialog 场景补“展开位置与出场”“选了本体”“动过勾选”“英文界面”；`entry-page.scenes.ts` 补“空条目”“有头像”“窄（右栏折下）”。草稿目录 `drafts/w00055-t04/` 在实施合入时删掉（评审板上的截图还在）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | Work 分支并入 master | `bun run typecheck` |
| S1 | 新建对话框（关键设计 1）与 `ComponentChecklist` 的预设样子 | `NewEntryDialog.dom.test.ts`、`ComponentChecklist.dom.test.ts`、`entries-view.dom.test.ts`；Lab 截图 |
| S2 | 页头（关键设计 2） | `EntryPage.dom.test.ts`、`entry-page.dom.test.ts`；Lab 截图 1440、760、390 |
| S3 | 文字分页空态（关键设计 3） | `EntryText.dom.test.ts` |
| S4 | 收口：Spec 去标记、草稿删掉、前端实现审查、变异检查、e2e、开发服务真实页面走一遍 | 见“验证” |

## 验收映射

- author-ui 输出 4：`NewEntryDialog.dom.test.ts`（横版两栏、收起时段头的值、选了本体上级跟着、恢复默认、名字框回车新建、名字为空不新建、标题“新建人物”）；`entries-view.dom.test.ts`（选中某项时预填同层的分组与上级）。
- 输出 6：`EntryPage.dom.test.ts`（右栏的种类与出场、点了发 `edit-place`、头像有图才画、点头像发 `open-look`）；`entry-page.dom.test.ts`（宿主给的种类、出场文字、立绘取自形象这一组）。
- 输出 39：`EntryText.dom.test.ts`（空态一行可点进编辑、不能写时不可点带原因）；e2e `canon-write.e2e.ts` 的“开始写”一步。
- 新建人物的整条路：e2e `canon-character.e2e.ts`、`canon-write.e2e.ts`。

## 验证

- 每片：受影响的 dom 测试、`bun run typecheck`；改了的组件在 Lab 里逐个状态点一遍（展开收起有过渡、换种类勾选跟着换），截 1440、760、390 与英文场景。
- 合入前跑一次的 e2e（3 个文件）：`canon-character.e2e.ts`、`canon-write.e2e.ts`、`canon-author.e2e.ts`。改动后只重跑失败项与覆盖改动的文件。开工前先在起点上跑这三份记基线（master 上 canon-character 有两条原有失败）。
- 变异检查：先提交再做，挑“恢复默认只在不同于默认时出”“选了本体上级跟着”“头像只在有图时画”“空态点了进编辑”几处。
- 前端实现审查：Sonnet，说明里贴 UI Skill 第 9 条的固定检查。
- 交付前在开发服务的真实页面把新建人物、新建普通条目、空条目页头与文字空态点一遍。

## 不做与风险

- 不做 Gemini 提的“连续新建”、勾选列表排两列、页头右栏写分组与上级、人物卡空值换横线（理由见评审板“不采纳”）。
- 页头的事实点了打开整个移动对话框，不就地改种类、出场：移动对话框已有这两项和它们的校验，另做一套就地改的价值小。
- 头像在“人物”分页上和卡片里的立绘同时出现，重复一张图；开发者选了放，接受。
- `EntryPicker` 按名字与别名在整个世界里找，与“在看”的位置无关；新建时的候选本来就不按位置筛，不变。
