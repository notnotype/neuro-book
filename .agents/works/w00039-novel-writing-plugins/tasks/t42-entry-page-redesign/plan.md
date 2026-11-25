# t42 计划：条目页的页头、分页与保存提示

## Context

开发者 2026-11-25 试用人物卡（t41）后提出：保存后的提示把页面推下去、分页条丑、不知道从哪加一组设定、名字旁的“改”不对、“初值”看不懂、设定组与编辑器标签没有图标；要求按八条交互原则（设计语言“交互：复杂留给系统”）重出这一页。静态稿与评审见 [README](README.md)，Gemini 顾问意见见 [designer-r1.txt](evidences/designer-r1.txt)。

评审板第 1 轮定的：

1. 分页：编辑区够宽（约 960 像素以上）时在内容左边竖排，窄了换回横排（开发者选 B，会话里确认）。
2. 保存后的提示：浮在页面下方，6 秒后自己收起，指着或焦点在里面时不收；Agent 改了设定的那条不自己收。
3. “初值”改叫“故事开始前”。
4. “直接修”表里的十三项开发者没有异议，照做（见下文各节）。

工作方式：主会话写代码，在 w00039 的 worktree 新开分支 `feat/w00039-t42-entry-page`（从 master）；前端实现审查派 Sonnet，Gemini（`prox omp --model @designer`）看实现截图给交互与文案意见，最后不另请 GPT 审查；交付前在开发服务的真实页面上把主路径点一遍。

## 技术选型

无新依赖。浮层、下拉、分页、竖排导航都用 nb-ui 现有的 `Popover`、`DropdownMenu`、`ContextMenu`、`Tabs`；竖排导航是 canon 自己的一个小组件（nb-ui 的 `Tabs` 不支持竖排，`Tabs.md` 写明）。

## 关键设计

### packages/neuro-book/src/plugins/canon/web/components/（页面骨架）

- `EntryPage.vue`
  - **内容列**：页头、分页、内容同一个上限，内容净宽 760（现在扣掉内边距只有 696，人物分页的短资料两列在 `34rem` 断点下永远排不开），三者左边对齐。
  - **页头**：名字与简介本身是按钮，`edit-name`、`edit-summary` 事件改为带锚点元素（同 `CharacterCard` 的 `edit`）；悬停浅底与铅笔只换透明度、不挪字；没有简介时写“一句话简介”；“添加别名”的输入失焦时非空就加上。
  - **时间点**：位置选择、“按计划”开关合成新组件 `PositionPicker.vue`（`Popover` 加触发按钮），列出“故事开始前”与各章开头、末尾，“算上计划中的情节”开关只在作品里有计划时出现。没有章、也没有计划时整个不出；算上计划时按钮旁多一枚“算上计划 ×”。线的选择 `LineSelect` 留在它左边不动。
  - **其他状态**：“在某位置还没出场”变成时间点旁的一枚标记；`positionGone` 与 `actionError` 不再插行，分别走浮动提示与对应的浮层。
  - **更多菜单**：“···”分组加分隔，删除条目垫底；“添加一组设定”从这里拿走。
- `EntryPageNav.vue`（新）：竖排导航，三段（设定组与文字、末尾“添加一组设定”│ 不对应设定组的看法）。`EntryPage` 用容器查询，编辑区不窄于约 960 时显示它，窄了显示横排 `Tabs`（`overflow="adapt"`、带图标）加行尾“＋”。两种排法读同一份分页列表，切换只换外形、不改选中。
- `PageNotices.vue`（新）：浮在页面滚动区下方居中，盖在内容上、不占文档流，作者的提示与 Agent 的提示上下叠放。`NoticeBar`、`AgentNotice` 改成它里面的两行，文案“看回执”改为“查看详情”；条目页、回执页、变更详情页三个宿主都换用它。
  - **自己收起**：作者的提示 6 秒后淡出，指着或焦点在里面时暂停；撤销的确认框开着时也暂停。新提示顶掉旧的时外框不动、原地换字并重新计时。Agent 的提示不自己收。
  - **动效**：从下面滑上来（`--motion-enter`），退场淡出（`--motion-fast`、`--ease-dialog-leave`）。

### packages/neuro-book/src/plugins/canon/web/components/EntryPageHost.vue（编排）

- **名字、简介**：改用人物分页同一套就地改（`in-place-edit.ts` 的锚定浮层、`ConfirmBar variant="inline"`），不再开页顶确认条。
- **作品里有没有计划**：读 `changes` 的 `filter.kind: "plan"`、`limit: 1` 的 `total`，世界变了跟着重读，不改内核。
- **分页列表**：每项带图标与分段，次序同输出 9 的规则；看法一段是附加分页与“情节”。“情节”条数为 0 时不写数，作品还没有剧情变更时不出；声明了 `needsChanges` 的附加分页（剧情插件的“经历”）同样不出。
- **添加一组设定**：“＋”打开 `DropdownMenu`，列出能加的组（适用的在前，去掉过的写“恢复‘某某’”），点一项就写入并切到新分页；没有能加的组时不出“＋”。原来的对话框删掉，保留版本冲突的处理（输出 43）。
- **去掉这组设定**：在“···”里与分页的右键菜单里（`ContextMenu`），确认时写“填的内容会保留，可以再加回来”。

### canon 的贡献点声明（`shared/components.ts`、`shared/entry-tabs.ts`、`shared/entry-kinds.ts`）

- 三个声明各加可选的 `icon`（lucide 类名）。
- canon 内置：人物 `i-lucide-user-round`，形象 `i-lucide-shirt`，面板 `i-lucide-gauge`；条目种类人物、组织、地点、物品、知识点各一个。
- 剧情插件：知情、态度、知识点、经历各一个，经历另声明 `needsChanges: true`。
- 没声明图标的设定组用 `i-lucide-layers`；窄了只剩图标时，没有专属图标的保留截短的名字（Gemini 意见第 3 节的“防撞车”）。

### packages/neuro-book/src/plugins/editor/（编辑器标签的图标）

- `EditorGroupHead.vue` 现在对页面给 `icon: null`。改成页面标签画图标：`EditorTabBar` 的 `icon` 扩成文件图标或 lucide 类名两种，宽度同文件图标。
- 页面实现加可选的 `icon(arg)`，与 `title(arg)` 同构，缺省用声明的 `icon`。
- canon 的条目页按条目种类给图标，没读到时用书。

### canon 的其余几处

- **加立绘一次到位**：`CharacterView.vue` 的 `onPortrait` 加上形象以后切到形象分页，并让形象分页打开立绘选图。`context.showTab(type, {then: "pick-portrait"})` 由 `LookView` 接住。
- **回车不被吞**：`in-place-edit.ts` 的预览在等 300 毫秒时按回车，立刻发预览，回来没被拒就保存；`ConfirmBar` 的回车不再只看 `canSave`。
- **人物分页在 390 宽**：`CharacterCard.vue` 窄了立绘在上、短资料一行一项，值不再被挤成一字宽。
- **文案**：“撤销”统一提示、确认框、回执页、改动记录里的“还原”；“初值”改为“故事开始前”（`locales/zh-CN.json` 5 处与英文对应项）。

## Spec 与文档改动

- `docs/specs/canon/author-ui.md`
  - 输出 6（页头）、7（位置写法）、9（分页、排法、图标、看法一段、空作品不出）、16（名字简介不用确认条）、18（浮动提示、自己收起）、32（宽度与内容净宽）、36（附加分页的 `icon`、`needsChanges`）、38（页头与“＋”）、50 与 51（加立绘一次到位、回车）。
  - 输入一节的 entry-kinds 加 `icon`，术语一节的“位置”写法改为“故事开始前”。
  - 验收 2、3、14、17 里涉及的说法同步改。
- `docs/specs/canon/components.md`：类型声明加 `icon`。
- `docs/specs/canon/revisions.md` 与 `project.md`：界面文案“还原”改“撤销”的地方（只改界面说法，不改操作名）。
- `docs/specs/workbench/editor.md`：输出 33 页面实现加 `icon(arg)`，输出 53 页面标签画图标。
- 新写的条目先标“（planned）”，实现与测试到位后按晋升规则逐句核对再去标记（这次一起做）。

## 切片

1. **S1 浮动提示**：`PageNotices` 与三处宿主、自己收起、动效、文案“查看详情”。dom 测试加 e2e canon-author 验收 3 的改动。单独提交。
2. **S2 页头与时间点**：`EntryPage` 的列宽与页头、`PositionPicker`、名字简介就地改、别名失焦、更多菜单、还没出场的标记、`positionGone` 与 `actionError` 的去处。
3. **S3 分页**：声明的 `icon` 与 `needsChanges`、分页列表与分段、横排加“＋”、`EntryPageNav` 竖排与容器查询切换、添加与去掉一组设定的新入口。
4. **S4 编辑器标签的图标**（editor 插件）。
5. **S5 其余几处**：加立绘、回车、390 宽、“撤销”“故事开始前”的文案。
6. **S6 收口**：Spec 定稿、e2e 定位点、Sonnet 前端审查、Gemini 看截图、开发服务上走一遍主路径、晋升核对、合入。

每片自跑：`bun run typecheck`；canon、editor 受影响的 vitest（`bunx vitest run src/plugins/canon/web src/plugins/editor/web`）；动到的 e2e 文件。改定位点前先 grep e2e 辅助函数，一起改（“初值”3 个文件 10 处、“看回执”2 处、“还原”在 canon-author 与 canon-write 里）。

## 验收映射

- **author-ui 输出 18**：`page-notices.dom.test.ts`（新）。不推开内容，量提示出现前后正文第一行的位置；6 秒后收起用注入的时钟；指着时不收；Agent 的不收。另有 e2e canon-author 验收 3。
- **输出 6、38**：`entry-page.dom.test.ts`。名字是按钮、点了出锚定浮层、别名失焦加上、没有“改”按钮。
- **输出 7 与时间点**：`position-picker.dom.test.ts`（新）。没有章没有计划时不出、没有计划时不出开关、算上计划的标记点 × 回到实际。
- **输出 9**：`entries-view` 之外的 `entry-page.dom.test.ts`。图标、分段、零条不写数、没有剧情不出看法、宽窄两种排法。宽窄切换另由 e2e canon-author 验收 14 在 390 宽与 1920 宽量。
- **输出 51**：`character-view` 的 dom 测试。加立绘一次到位（形象分页的选图浮层开着）、回车在预览等待中也保存。
- **workbench/editor 输出 53**：`EditorTabBar.dom.test.ts`、`EditorGroupHead.dom.test.ts`。页面标签画声明的图标与 `icon(arg)`。
- **验收 17**：e2e canon-character 按新文案与入口改写。

## 验证

- 宽窄：e2e canon-author、canon-character 在 1440 与 1920 两种宽度、390 宽各跑一遍（作者界面 e2e 要 1440 视口，竖排要编辑区够宽，1920 时量）。
- 明暗与英文：Lab 里 `EntryPage`、`PageNotices`、`PositionPicker` 各登记英文场景，390 宽截图。
- 真实页面：交付前在开发服务上把主路径点一遍（新建人物、改名、加一组设定、换时间点、撤销）。看过渡是否卡住；e2e 是减弱动效的生产构建，看不出这一条。
- 不跑全量；动到的 e2e 文件不超过 8 个。

## 不做与风险

- **不做**：
  - “改设定／剧情里变了”的改名、“设定组”叫法与空值写“—”，留给文案那一轮。
  - 全项目的动效与交互原则整体审查，另开 Work。
- **风险与对策**：
  - **分页条的宽度切换**：在容器宽度临界附近来回切会抖动。放宽多留 16 像素余量，同 `Tabs` 的 `adapt`；由 e2e 在两种宽度下量。
  - **浮动提示挡住最后几行**：滚动区底部加与提示等高的留白，只在提示出现时加，用滚动区的 `scroll-padding`，不改版面。
  - **别处订阅 `NoticeBar`**：改动影响回执页与变更详情页。两页的 dom 测试与 e2e canon-author 验收 3、5 覆盖。
  - **页面标签的图标**：影响所有页面，例如欢迎页、模型请求。EditorTabBar 的 dom 测试与 e2e editor-area 里页面标签的用例覆盖，跑 `editor-area.e2e.ts`。
