# t42 计划：条目页的页头、分页与保存提示

## Context

开发者 2026-11-25 试用人物卡（t41）后提出：保存后的提示把页面推下去、分页条丑、不知道从哪加一组设定、名字旁的“改”不对、“初值”看不懂、设定组与编辑器标签没有图标；要求按八条交互原则（设计语言“交互：复杂留给系统”）重出这一页。静态稿与评审见 [README](README.md)，Gemini 顾问意见见 [designer-r1.txt](evidences/designer-r1.txt)，计划的设计审查（Sonnet，21 条）与处理见 [design-review.txt](evidences/design-review.txt)、[design-review-disposition.txt](evidences/design-review-disposition.txt)。

评审板第 1 轮定的：

1. 分页：编辑区够宽时在内容左边竖排，窄了换回横排（开发者选 B，会话里确认）。
2. 保存后的提示：浮在页面下方，6 秒后自己收起，指着或焦点在里面时不收；Agent 改了设定的那条不自己收。
3. “初值”改叫“故事开始前”。
4. “直接修”表里的十三项开发者没有异议，照做（见下文各节）。

工作方式：
- 主会话写代码，在 w00039 的 worktree 新开分支 `feat/w00039-t42-entry-page`（从 master）。
- 实现审查：前端派 Sonnet；Gemini（`prox omp --model @designer`）看实现截图，给交互与文案意见；最后不另请 GPT 审查。
- 交付前在开发服务的真实页面上把主路径点一遍。
- 静态稿在 Lab 的草稿区 `lab/web/drafts/w00039-t42/`（w00022 t24 起入库）。

## 技术选型

无新依赖。
- 提示的外观复用 nb-ui 的 `Notification`：与工作台通知同一种卡片，动作插槽里放两个按钮。不直接用 `NotificationStack`：它固定在窗口边缘，这里要浮在页面里。
- 时间点用 `DropdownMenu` 的单选项与勾选项（ui-development-spec 的“弹出列表的共同合同”），不手搭 `Popover`。
- 横排分页用 `Tabs`；竖排导航是 canon 自己的小组件，因为 `Tabs.md` 写明不支持竖排。

## 关键设计

### canon/web/notices.ts 与 components/PageNotices.vue（浮动提示）

**notices.ts**：自己收起的计时放在窗口里这一份（`notices.ts`），不放在宿主组件里。拆分以后两个条目页同时挂着，各自计时会互相清掉对方正指着的提示。
- 作者的提示出现后 6 秒收起。暂停有三个来源：任何一个宿主上指针停着、焦点在提示里、还原的确认框开着（`revert.target`）。各宿主报“暂停开始、暂停结束”，计数归零后至少再留 0.8 秒，与工作台通知相同。
- 宿主卸载不影响计时；提示收起以后不会因为回到页面再出现。
- 新的一条顶掉旧的时重新计时。
- Agent 的提示不自己收。
- 没有页面挂着时发的工作台通知，也改成 6 秒自己收起（`sticky: false`），同一次保存的提示不论走哪条路，寿命一样。

**PageNotices.vue**：条目页、回执页、变更详情页三处共用。
- **位置与留白**：页面内容末尾一个 `position: sticky; bottom` 的零高容器，提示从它往上叠，盖在内容上、不占文档流。页面底部常留一行提示高的留白，提示出没时什么都不动，最后几行也滚得到（`scroll-padding` 扩不了可滚动范围，滚动区又归编辑组，所以用页面自己的留白）。
- **外观**：作者的提示是 `success` 色调，Agent 的是 `info`，上下叠放；动作是“查看详情”“还原”。
- **页面自己的写入失败**：别名、恢复、移动前的读取、加一组设定、文字分页开始写，失败原因以 `danger` 色调一行放在同一处，不自己收，关掉或下一次写入时清掉，`role="alert"`。
- **读屏**：外层 `role="status"` 的容器常驻，空的时候也在，读屏才念得到新提示。
- **动效**：从下面滑上来（`--motion-enter`），收起淡出（`--motion-fast`、`--ease-dialog-leave`），顶掉旧的时外框不动、原地换字（`.nb-ui-switch-*`）。
- **遮挡**：成段的编辑层打开时“整个滚进可见范围”，要让开提示：它的 `scroll-margin-bottom` 取 `PageNotices` 给出的高度变量。

`NoticeBar.vue`、`AgentNotice.vue` 删掉，三个宿主改用 `PageNotices`。

### canon/web/components/EntryPage.vue（页面骨架）

- **内容列**：页头、分页、内容同一个上限，内容净宽 760（现在扣掉内边距只有 696，人物分页短资料的两列在 `34rem` 断点下永远排不开），三者左边对齐。放宽（主文字左右分屏）时的 `WIDE_MIN` 把竖排导航的宽度与间距算进去。
- **名字与简介**：本身是按钮，保留 `data-edit="entry.name"`、`data-edit="entry.summary"`，宿主保存或放弃后靠它把焦点还回来。悬停与键盘聚焦时浅底加铅笔，铅笔一直占位、只换透明度。没有简介时写“一句话简介”。
- **别名**：
  - 回车加上，失焦时非空也加上。
  - Escape 放弃，之后的失焦不再加。
  - 同一个值不连发两次：在途时不重复发，在途时点别的 × 排队、不吞掉。
- **时间点**：新组件 `PositionPicker.vue`，触发按钮写当前位置，菜单是 `DropdownMenu`。
  - 菜单内容：“故事开始前”与各章开头、末尾是单选项；“算上计划中的情节”是勾选项，只在作品里有计划时出现。
  - 什么时候出：没有章、也没有计划时整个不出。
  - 按钮旁的标记：在预留的一格里，出没只换透明度、不挤别的。“算上计划 ×”点 × 回到实际；“第 N 章起出场”或“到这里还没出场”；“原来选的那一章已经不在了”，换了位置就清掉。
  - 线的选择 `LineSelect` 留在它左边不动。
- **更多菜单**：“···”分组加分隔，“移动到……”在前，“去掉这组设定……”其次，“删除条目”垫底；“添加一组设定”从这里拿走。

### canon/web/components/EntryPageNav.vue（新）与分页

- **竖排导航**：`role="tablist"`、`aria-orientation="vertical"`，上下方向键移动，焦点模型与 `Tabs` 相同（roving tabindex）。三段：设定组与文字、末尾“添加一组设定”；不对应设定组的看法（附加分页与“情节”）。带同名 `.md` 与 Lab 场景。
- **宽窄切换**：容器查询，内容区不窄于 1040 时竖排，窄于 1024 时横排，两个阈值之间保持原样，免得在临界处来回切。
  - 横排是 `Tabs`（`overflow="adapt"`、带图标），分段处一条分隔，行尾“＋”。
  - 两种排法读同一份分页列表，切换只换外形、不改选中。页头高度变了由现有的尺寸观察重算吸顶高度。
- **图标**：每项有图标。没声明的设定组用 `i-lucide-layers`；窄到只剩图标时，这些组的图标相同，靠悬停的全名区分（已知限制）。
- **条数与不出的条件**：
  - “情节”条数为 0 时不写数。
  - 作品还没有任何剧情变更时，“情节”不出；声明了 `needsChanges` 的附加分页（剧情插件的“经历”）同样不出。

### canon/web/components/EntryPageHost.vue（编排）

- **名字、简介就地改**：
  - 先把现在 `fieldEditorOf(namespace)` 里的锚定浮层抽成通用的 `InPlaceEditor.vue`：路径、意图、预览、保存都由调用方给，人物与形象分页改用它，行为不变。
  - 名字与简介接上它，仍走 `editInPlace`（`entry-edits.ts`）。所选位置是故事开始前时只有“改设定”。
  - 页顶的确认条只留给通用字段表与变更详情页。
- **作品里有没有计划、有没有剧情变更**：各读一次 `changes`，分别带 `filter.kind: "plan"`、`limit: 1` 与 `limit: 1`，看 `total`；世界变了跟着重读。不改内核。
- **添加一组设定**：
  - “＋”打开 `DropdownMenu`，列出能加的组：适用的在前，去掉过的写“恢复‘某某’”。
  - 打开菜单时记下条目的版本（同原来对话框的 `dialogBase`，输出 43）。点一项就带这个版本写入，成功后等这个分页出现在读取结果里再切过去。
  - 失败原因进 `PageNotices` 的失败行；`id-taken` 写“这组设定已经加上了”。
  - 没有能加的组时不出“＋”。原来的对话框删掉。
- **去掉这组设定**：在“···”里与分页的右键菜单里（右键菜单先“添加一组设定……”、分隔、再“去掉‘某某’”）。确认框写“填的内容会保留，可以再加回来”。
- **加立绘一次到位**：canon 内部用 `provide/inject` 交一个“打开形象分页时先开选图”的标记，不扩公开的 `showTab`。人物分页点“添加立绘”时：
  - 没有形象就加上，等形象分页出现以后切过去，并立起这个标记。
  - 形象分页挂上时读到标记就打开选图，读完清掉。
  - 写入失败时停在人物分页，原因写在立绘那一格。

### 声明的图标（canon/shared/component-views.ts、entry-tabs.ts、entry-kinds.ts）

- 图标放在界面一侧的声明上，不进内核的类型声明（nb-canon 的 `ComponentDeclarationSchema` 不动，摘要也不受影响）：`canon.component-views`（设定组的专门界面）、`canon.entry-tabs`、`canon.entry-kinds` 各加可选的 `icon`（lucide 类名），`entry-tabs` 另加 `needsChanges?: true`。
- canon 内置：人物 `i-lucide-user-round`，形象 `i-lucide-shirt`，面板 `i-lucide-gauge`；条目种类人物、组织、地点、物品、知识点各一个。
- 剧情插件：知情、态度、知识点的专门界面，以及“经历”各声明一个。
- 文字、情节用条目页自带的。

### editor 插件（编辑器标签的图标）

- **图标的形状**：`contracts.ts` 的 `TabItem` 加 `icon`，是有判别的联合：`{kind: "file", icon}` 或 `{kind: "class", className}`。`EditorTabBar`、拖影（`tab-drag.ts` 现在对页面写死 `fileIcon: null`）、`EditorGroupHead` 都按它画，宽度同文件图标。
- **页面实现**：可选的 `icon(arg)`，与 `title(arg)` 同构，缺省用声明的 `icon`。
- **刷新后恢复**：编辑器记下的标签信息除了标题也记图标。不这样做的话，图标会先全是缺省、读到条目以后再跳变。
- **条目页的图标**：按种类给；没读到种类时用 `i-lucide-bookmark`，与欢迎页的书分开。

### canon 的其余几处

- **回车**：`in-place-edit.ts` 的预览在等 300 毫秒时按回车，立刻发预览。回来的预览除了这个值本身没有别的变化（没有新的待处理、没有跟着变的值）就保存；有的话把预览显示出来，再按一次回车才保存，不让作者没看见变化就写入。
- **人物分页在 390 宽**：`CharacterCard.vue` 窄了立绘在上、短资料一行一项，值不再被挤成一字宽。
- **文案**：
  - 提示条上的“撤销”改叫“还原”，与确认框、回执页、改动记录一致（实施时改的方向：“撤销”在领域里是剧情变更的状态“已撤销”，见 README 的 S5）。
  - “看回执”改“查看详情”，改动记录里的同一个键一起改。
  - “初值”改“故事开始前”，包括 canon `locales` 5 处、剧情插件 `locales` 与给 Agent 的文字里的界面说法。

## 动效

- **提示**：从下面滑上来，收起淡出，顶掉旧的原地换字。
- **时间点标记、页头里条件出现的零件**：在预留位置里淡入淡出（`--motion-fast`）。
- **宽窄切换**：竖排与横排之间直接换，不做过渡。容器宽度跟着拖动变化，跟手为先（设计语言“跟手、可打断”）。
- **加一组设定**：新分页出现时在导航里淡入；选中项的指示随切换移动（横排是 `Tabs` 自带的指示线，竖排是选中底色的 `--motion-move`）。
- **浮层里的预览与原因**：固定两行里换字，沿用 `InPlaceEditor` 现有的写法。

## Spec 与文档改动

- `docs/specs/canon/author-ui.md`
  - 输出 6（页头）、7（位置写法与标记）、9（分页、排法、图标、看法一段、不出的条件）、15（零条不写数）、16（名字简介不用确认条）、18（浮动提示、自己收起、工作台通知同寿命、失败行）、32（宽度与内容净宽）、36（附加分页的 `icon`、`needsChanges`）、38（页头、“＋”与右键菜单）、50 与 51（加立绘一次到位、回车先看变化）。
  - 输入一节 `canon.component-views`、`canon.entry-kinds` 加 `icon`；术语一节的“位置”写法改为“故事开始前”。
  - 验收 2、3、14、17 的说法同步改。
- `docs/specs/canon/author-ui.md` 输出 18、22、42：提示条上的按钮叫“还原”。
- `docs/specs/workbench/editor.md`：输出 33 页面实现加 `icon(arg)`、记下的标签信息带图标，输出 53 页面标签画图标。
- `docs/specs/workbench/notifications.md`：不改（canon 发通知时自己给 `sticky: false`）。
- 新写的条目先标“（planned）”，实现与测试到位后按晋升规则逐句核对再去标记（这次一起做）。

## 切片

1. **S1 浮动提示**：`notices.ts` 的窗口级计时与暂停、`PageNotices` 与三处宿主、失败行、工作台通知的寿命、文案“查看详情”。
2. **S2 页头与时间点**：
   - `InPlaceEditor` 抽出：人物与形象分页先改用它，跑原有 dom 测试与 e2e canon-character 确认行为不变，单独提交。
   - `EntryPage` 的列宽与页头、名字简介就地改、别名、`PositionPicker` 与标记、更多菜单。
3. **S3 分页**：声明的 `icon` 与 `needsChanges`、分页列表与分段、横排加“＋”、`EntryPageNav` 竖排与切换、添加与去掉一组设定的新入口。
4. **S4 编辑器标签的图标**（editor 插件）：`TabItem.icon`、拖影、`icon(arg)`、记下的标签信息带图标。
5. **S5 其余几处**：加立绘、回车、390 宽、“还原”“故事开始前”“查看详情”的文案。
6. **S6 收口**：Spec 定稿、e2e 定位点、Sonnet 前端审查、Gemini 看截图、开发服务上走一遍主路径、晋升核对、合入。

每片自跑：
- `bun run typecheck`。
- canon、editor 受影响的 vitest：`bunx vitest run src/plugins/canon/web src/plugins/editor/web`。
- 动到的 e2e 文件。

改定位点前先 grep e2e 与辅助函数，一起改。已知的有：
- “初值”3 个文件 10 处。
- “看回执”2 处。
- canon-author 与 canon-write 里的“还原”。
- `combobox` “位置”：canon-author 第 74 行、canon-character 第 76 行、canon-write 第 421 行。
- “＋别名”。
- 按 `getByRole("tab")` 比对整张分页表的用例：新作品没有剧情变更时不再有经历与情节。

## 验收映射

- **author-ui 输出 18**：`notices.test.ts`、`page-notices.dom.test.ts`（新），时钟用注入的。
  - 两个宿主同时挂着，只有一份计时；一个宿主上指着时另一个也不收。
  - 卸载再挂上不复活。
  - 还原的确认框开着时不收；Agent 的不收。
  - 失败行不自己收。
  - 提示出现前后正文第一行的位置不变。
  - e2e：canon-author 验收 3。
- **输出 6、38**：`entry-page.dom.test.ts`。名字是按钮、点了出锚定浮层、别名失焦加上、Escape 不加、没有“改”按钮、“＋”菜单直加。
- **输出 7**：`position-picker.dom.test.ts`（新）。没有章没有计划时不出、没有计划时不出勾选项、“算上计划 ×”回到实际、那一章不在了的标记换位置就清。
- **输出 9、15**：
  - `entry-page.dom.test.ts`：图标、分段、零条不写数、没有剧情变更时不出情节与经历。
  - `entry-page-nav.dom.test.ts`（新）：竖排的键盘与读屏。
  - 宽窄两种排法：e2e canon-author 验收 14 在 390、1440、1920 三种宽度量。
- **输出 51**：`character-view` 与 `look-view` 的 dom 测试，以及 `in-place-edit` 的测试。
  - 加立绘一次到位：形象分页的选图开着。
  - 回车：在预览等待中，没有别的变化就保存，有就先显示预览。
- **workbench/editor 输出 33、53**：`EditorTabBar.dom.test.ts`、`EditorGroupHead.dom.test.ts` 与拖影的测试。页面标签画声明的图标与 `icon(arg)`，刷新后恢复的标签先用记下的图标。
- **验收 17**：e2e canon-character 按新文案与入口改写。

## 验证

- **宽窄**：e2e canon-author、canon-character 在 1440、1920、390 三种宽度跑。作者界面 e2e 要 1440 视口；竖排要内容区不窄于 1040，1920 时量。
- **明暗与英文**：Lab 里 `EntryPage`、`PageNotices`、`PositionPicker`、`EntryPageNav` 各登记英文场景，390 宽截图。
- **真实页面**：交付前在开发服务上把主路径点一遍：新建人物、改名、加一组设定、换时间点、还原、拆分两组各开一个条目页看提示。还要看过渡有没有卡住，e2e 是减弱动效的生产构建，看不出这一条。
- **e2e 范围**：不跑全量；动到的 e2e 文件不超过 8 个（canon-author、canon-character、canon-write、editor-area、lab-scenes 等）。

## 不做与风险

- **不做**：
  - “改设定／剧情里变了”的改名、“设定组”的叫法与空值写“—”，留给文案那一轮。
  - 全项目的动效与交互原则整体审查，另开 Work。
- **风险与对策**：
  - **键盘到不了提示**：键盘用户在 6 秒里到不了浮动提示。还原另有改动记录这条路，读屏靠常驻的 `role="status"` 念到；记为已知限制，写进 Spec 输出 18。
  - **页面标签的图标影响所有页面**（欢迎页、模型请求等）：EditorTabBar、拖影的 dom 测试与 e2e editor-area 覆盖；跑 `editor-area.e2e.ts` 前先 grep 它对页面标签的断言。
  - **`InPlaceEditor` 抽出可能改坏人物与形象分页**：先单独抽、行为不变地提交，跑完原有测试再接页头。

---

# S8：页头“在看”与就地改卡（评审板第 2、3 轮）

## Context

开发者 2026-11-26 第二次试用：看不懂“跟着章（此刻：主线）”和“第 3 章末尾”两个控件，改值的控件不好看、不好用。评审板第 2、3 轮定了（Task README 两节答复）：页头合成一个“在看”（章表可搜、滚到当前章，两边往前往后一处，两段小标题带说明）；改值用紧凑浮层、玻璃的面，二选一写“从最初起 | 从第 3 章起”，选剧情里变了时选填一句“发生了什么”；长文字在原处展开、用同一张卡；第 2 轮“直接修”那张表照做。草稿：Lab 草稿区 `drafts/w00039-t42/` 的 `ViewPointDraft`、`InPlaceEditDraft`。

## 技术选型

无新依赖。“在看”的菜单要放搜索框、每章一行两个按钮与开关，`DropdownMenu` 放不下，用 nb-ui `Popover` 自己排内容（键盘按下面的约定）。nb-ui `Popover` 加一个可选的碰撞边界（reka 的 `collisionBoundary`），编辑浮层用它钳在编辑区里。

## 关键设计

### canon/web/components/ViewPointPicker.vue（新，替代 LineSelect 与 PositionPicker）

- 一个浅底按钮：“在看”（弱一档）加结论“第 3 章末尾 · 主线”；只有主线时不写线，算上计划时加“· 含计划”，固定看一条分支线时强调色浅底加分支图标。两边各一个 `IconButton` 往前、往后一处（位置表里的上一项、下一项；到头了不可用，悬停写要去哪）。标记（这时还没出场、原来选的那一章不在了、算上计划 ×）照旧在左边一格。锁着（`locked`）时整组不可用、悬停写原因。
- 菜单（`Popover`，宽 22rem）：“故事线”一段（有两条以上线时）：按章节自动（右边小字“当前：线名”）、主线、子线按树缩进加折线图标；“剧情进度”一段：多于 12 章时顶上一个搜索框（章号、“第 N 章”、标题里的字），“最初”（小字“起始设定”）固定在上，章表一章一行、行尾“开头”“末尾”两个按钮，多于 12 章时约 8 行高、在里面滚，打开时当前章滚到中间；最下面“算上计划中的情节”开关（只在 `canPlan` 时）。两段小标题旁各一个 `InfoTip`（文字照草稿的 `LINE_TIP`、`PROGRESS_TIP`，进 locales）。
- 键盘：打开时焦点进当前那一个按钮（多于 12 章时进搜索框）；位置是一组 `role="radio"`（`radiogroup` 的读屏名“剧情进度”），上下键换章、左右键换开头末尾，回车或空格选中并关上；搜索框里下键进章表；Escape 关上、焦点回按钮。
- 合同：`positions`（新的 `positionRows(chapters, text)`，见下）、`position`、`planned`、`canPlan`、`locked`、`notAppeared`、`positionGone`、`lineOptions`、`line`、`resolvedLine`；发 `update:position`、`update:planned`、`update:line`。条目页的页头（`EntryPage.vue`）与剧情页面的 `PageHead.vue` 都换成它；`LineSelect`、`PositionPicker` 两个组件连同测试、`.md` 与 Lab 场景删掉。
- `positions.ts`：加 `positionRows`，给出“最初”一项与每章一行（序号、标题、开头与末尾的值）；`positionOptions` 留给要扁平列表的地方（前后一步按它的顺序）。

### 状态栏与选线命令（canon/web/plugin.ts、commands.ts、locales）

- 状态栏条目 `nbook.canon.line` 改说法：“故事线：主线”“故事线：按章节自动”“故事线：线名”；快速选择第一项“按章节自动”。它是窗口一份，读不到各页自己的时间点，所以不写时间点（与评审板“直接修”里那一句的出入，交付时说明）。

### 就地改卡（ConfirmBar 的 inline、FieldInput、SuggestInput、EntryPageHost、in-place-edit.ts）

- 底栏一行：意图二选一用 `SegmentedControl` 的 `raised`（xs），右边取消、保存（保存是唯一主色，带回车提示；长文字写 Ctrl+回车）。去掉“这是”。
- 二选一的写法：改设定写“从<来源>起”，来源取这个值最近一次改动的安放（字段状态的 `changedAt`：剧情变更给的是“第 2 章”“前史”，没有就是“最初”）；剧情里变了写“从第 N 章起”（所选位置那一章）。来源与所选位置是同一章时，两项写“改第 3 章那一笔”“第 3 章里又变了”，免得两项同名。看“最初”时只有改设定，不出这一行。
- 预览：没有别的变化（`impactIsQuiet`）时不占行；有变化时一条警告色浅底的提示写变化（多于一条写“还有 N 项”，整句在悬停提示）；原因（失败、刚被别处改过）照旧写在那里。写回哪里不再单独写（落点已经在二选一里）。
- 选着剧情里变了时，输入框下面多一行选填的“发生了什么”：它就是这一次的修订标题与那一条剧情变更的文字（内核里两者本来是同一个 `title`，见 `nb-canon` 的 `editBatch` 与 `storyChange`）；不填时写“年龄变成 18 岁”（值的显示文字不超过 20 字），否则“性格变了”；改设定的标题照旧“改年龄”。草稿记在标签状态里（同填的值）。
- 建议值（`SuggestInput`）加一个内嵌的样子：在浮层里列在输入框下面，不再传送成第二层浮层；打开时列全部、当前值打勾，打了字才筛；键盘同现在。确认条（页顶那一种）与对话框里照旧用弹出的样子。
- 长文字：`layout: "block"` 的编辑层不再盖在原文上（`absolute`），改成在原处展开：同一张卡（浮层的面、同一条底栏），原文按钮在编辑时藏起来，下面的内容往下让；多行输入按内容长高（`autosize`），不露拉伸角。
- 浮层钳在编辑区里：`Popover` 的碰撞边界给条目页所在的编辑组（`EntryPage` 的根往上最近的编辑组元素），右边一栏的值浮层靠右对齐。

### nb-ui

- `Popover`：加可选的 `collisionBoundary`（元素或元素数组，传给 reka），缺省照旧；同名 `.md` 与组件测试。
- `Tabs` 的 `scroll`：放不下、某一头还有内容时，那一头渐隐（`mask-image`，左右各 24px），滚到头那一头不渐隐；跟着滚动与宽度变化更新。`tabs-scroll` 验收页加一条。

### 设计语言

- “交互：复杂留给系统”第 4 条：“改一个值……都是同一种浮层”改成“都是同一张编辑卡（短项浮在值旁边，成段的文字在原处展开）”。

## Spec 与文档改动

- `canon/author-ui.md`：输出 7（时间点并进“在看”、章表的搜索与前后一步）、34（页头不再单列线的选择，状态栏说法）、16 与 51（二选一的写法、预览只在有变化时写、发生了什么、长文字原处展开、建议值内嵌）、9（横排分页两头渐隐）；验收 1、3、17 里的说法。
- `plot/author-ui.md`：剧情页面的页头同一个“在看”。
- 组件 `.md`：新 `ViewPointPicker.md`；改 `ConfirmBar.md`、`FieldInput.md`、`SuggestInput.md`、`EntryPage.md`、`PageHead.md`、`EntryPageHost.md`、`CharacterView.md`；nb-ui `Popover.md`、`Tabs.md`。

## 切片

1. S8a 页头“在看”：`ViewPointPicker` 与 `positionRows`，条目页与剧情页面换上，删 `LineSelect`、`PositionPicker`，状态栏说法；dom 测试与 Lab 场景（含英文、60 章、手机）。
2. S8b 就地改卡：`ConfirmBar` inline、`FieldInput`、`SuggestInput` 内嵌、`in-place-edit.ts` 的标题与“发生了什么”、长文字原处展开、`Popover` 碰撞边界；dom 测试（二选一的写法与同章时的说法、预览只在有变化时、发生了什么进标题、不填时的缺省、建议值列全）。
3. S8c nb-ui `Tabs` 两头渐隐、设计语言一句、Spec 全部写进主工作区。
4. 收口：e2e 由 Sonnet 子代理在自己的 worktree 改（见“测试分工”），主会话合进来跑；前端实现审查（Sonnet）；开发服务上走一遍；合入。

## 测试分工

e2e 的定位与可观察状态（两边照这份写）：“在看”按钮 `[data-view-point]`，前后一步 `[data-view-point-prev]`、`[data-view-point-next]`，菜单 `[data-view-point-menu]`，搜索框 `[data-view-point-search]`，章行 `[data-chapter-row="<章 id>"]`，位置按钮 `role="radio"` 加 `data-position-value="<值>"`，线的项 `[data-line-option="<id 或空串>"]`，计划开关 `[data-view-point-plan]`；就地改的二选一 `[data-edit-intent]`（`SegmentedControl` 的项按名字取），“发生了什么” `[data-edit-note]`，变化提示 `[data-edit-impact]`。子代理改 canon-author、canon-character、canon-write、plot-author 里用到旧控件（`[data-position-trigger]`、菜单的 menuitemradio、“改设定”“剧情里变了”、“改最初的值”）的用例，并按 Spec 新句子补：60 章时搜到一章并选中、前后一步换了位置、剧情里变了写“发生了什么”以后情节里那一条是这句话、长文字编辑时下一节往下让而不被盖住。

## 验收映射

- author-ui 输出 7、34 → `ViewPointPicker.dom.test.ts`（结论文字、只有主线、含计划、固定分支线的样子、搜索、滚到当前、前后一步到头不可用、键盘）、`window-line` 的状态栏测试、e2e canon-author 验收 1。
- 输出 16、51 → `ConfirmBar.dom.test.ts`、`entry-page.dom.test.ts`（二选一写法、同章、看最初、预览、发生了什么、缺省标题）、`SuggestInput.dom.test.ts`、e2e canon-character 验收 17。
- 输出 9 渐隐 → nb-ui `tabs-scroll.spec.ts`。

## 验证

类型检查；canon、剧情、Lab、编辑器的 vitest 与 bun 测试（整个插件目录）；nb-ui 组件测试与 `tabs-scroll`；e2e canon-author、canon-character、canon-write、plot-author；Lab 场景检查（这次改的组件）；变异检查（二选一同章、预览只在有变化时、发生了什么进标题、建议值列全、前后一步到头）；开发服务真实页面走一遍（宽、1440、390）。

## 不做与风险

- 通用字段表（`FieldTable` 与页顶的确认条）不在这一片：它照旧是页顶确认条，二选一与预览的写法跟着同一份文字改，样子不改；要不要也换成编辑卡另问。
- 状态栏读不到各页的时间点，只写故事线。
- 二选一的“来源”取字段最近一次改动；值由核对点或连续几笔加减得出时，改设定实际改的是哪一笔仍以预览为准（累出来的数照旧拦下，输出 29）。
