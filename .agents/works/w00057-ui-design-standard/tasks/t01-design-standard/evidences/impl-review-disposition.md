# w00057 t01 实现审查的处理

审查对象：提交范围 `6d5a10551..64c4ad482`。前端一份 Claude Sonnet（报告 `impl-review-sonnet.txt`），重点列了减弱动效的层序与收尾事件、配色派生、焦点环、Button 缺省的迁移、加载停留的时序、`lab:shot` 新检查的误报漏报、文档依据与说明文字。16 条：阻断 0、重要 3、建议 13。修正在提交 `6eb51de84`。

| # | 发现 | 归类 | 处理 |
|---|---|---|---|
| 1 | 全局 `* { transition-property: … !important }` 只换属性列表，几项时长不同的过渡按下标错配，透明度拿到 0（Chrome 实测） | 成立，要改；问题在结构上 | 撤掉全局规则：它在 components 层里加了重要声明，组件自己的减弱动效写法也盖不过它，个别地方无法纠正。改为逐处把位移的起点与终点收成同一个值（`transform: none`），按下与悬停的缩放原子类在 `styles.css` 一处收成 `scale: none`，关键帧仍用同名覆盖。逐处的：Tabs、NotificationStack、ContextMenu、RadioGroup、SegmentedControl、ToggleGroup、ComponentChecklist、EntryTextEditor、PageNotices、SearchSettingsPage、GoalsPage；已经自带减弱动效写法的（CharacterCard、EntryPage、EntryPageNav、LookCard、BookCard 等）不动。e2e 加“几项时长不同的过渡里透明度照常”“按下缩放收成 none” |
| 2 | ExplorerTree 的 `flyBack` 仍看 `--motion-base`，减弱动效下会飞 | 成立，要改 | 改看 `--motion-move`；`motionMs` 注释写明减弱动效时只有 move 是 0 |
| 3 | 十几处注释与文档仍写“减弱动效时 fast、base 是 0” | 成立，要改 | 逐处改成按令牌说清（styles.css 侧栏、DialogSurface.vue 与 .md、OverlayScrollbar、authoring-themes、两套 vars.css、AgentMessagesList、AgentMessagesSegment、EntryPage 两处、MarkdownCommentMargin.md、TasksView、ExplorerTree.vue 与 .md）；WorkbenchSurface 那句说的是网格的 `--motion-layout`，仍成立，不改 |
| 4 | nb-layout 仍把四档都归零，与 nb-ui 不一致 | 成立，但这次不改行为 | nb-layout 的落点框拿 base 做位置与尺寸过渡，放开要先收位移，且“四档归零”写在 nested-grid Spec 输出 59、142；改 global.css 里已不成立的那句注释，记为后续 |
| 5 | 焦点外框测试的混色不是主题实际那条；状态色改了淡底没跟 | 成立，要改 | 测试按两套主题的 `--control-outline`（16% 正文色）与 color-mix 的预乘 alpha 算；淡底与描边按新基色重写。淡底跟着变亮后 nbook-dark 的 danger、macos-dark 的 info 又低于 4.5，按“底随候选色一起变”重算（`#f98375`、`#7eb5fb`） |
| 6 | `clippedText` 只查直接带文字的元素，漏掉“壳裁子元素文字”；加大间距的报告与原有的重复 | 成立，要改 | 按裁切的容器查（`textContent` 非空、不在 `aria-hidden` 里）；加大间距只报新增的 |
| 7 | `smallTargets` 把隔着空白的 label 也并进来；停用的目标没排除 | 成立，要改 | 只并与控件相接或重叠的 label；排除 `:disabled` 与 `aria-disabled="true"`；注释写明祖先透明的悬停按钮照算 |
| 8 | 新 e2e 对 `--media` 与“只报告”只断言形状 | 成立，要改 | 报告加 `mediaMatched`（页面里 `matchMedia` 的结果）并断言为真；“只报告不算失败”直接用 `failedShots` 对造出的结果断言，越界照旧算失败 |
| 9 | 表格遮罩停留期仍拦指针，键盘已能操作 | 成立，要改 | 停留期加 `is-settled`、`pointer-events: none`；dom 测试断言 |
| 10 | `rowsInert` 翻转时焦点接管的 watch 不跑 | 成立，要改 | 把 `rowsInert` 列进两个 watch；dom 测试补“停留期焦点进新行，又开始加载，焦点接到表格区” |
| 11 | 几处“依据”超出原文 | 成立，要改 | 下一帧、低频收起、就地变化的读数各标明是本库的口径或引申 |
| 12 | 减弱动效的判据与实现不符 | 成立，要改 | 判据改成“位移起止相同、关键帧只含 opacity、透明度时长不为 0”，并写明为什么不统一改 `transition-property` |
| 13 | “分组与层次”第 5 条与交互八条第 7 条重复 | 成立，要改 | 第 5 条只留“连着用的挨着放”，危险的那半指向第 7 条 |
| 14 | Button 测试断言具体类名 | 成立，要改 | 只比缺省与写明 secondary、primary 是否同一套类 |
| 15 | 小项：`delay` 为 0、作用域外调用；nb-layout 焦点环回退；editorial、aurora 不在对比度用例里 | 前两项成立；第三项不改 | 注释补上；nb-layout 的回退改成实色 2px（theme-vars.ts 与 global.css）；editorial、aurora 是主题格式的示范，设计语言已写明“四种内置组合” |
| 16 | 列出合入前该跑的 e2e | 采纳 | 合入前清单加 editor-area、workbench-containers、workbench-views、files-explorer、agent-request-trace（见 Task README） |

## 变异检查（`6eb51de84` 之后在 worktree 里改、跑、`git show HEAD:` 恢复）

单元层 6 处：rowsInert 不进 watch、去掉 is-settled、rowsInert 不看 loading、不停留、Button 缺省 primary 都被抓到；“停留期再忙起来重新计延时”活下来，是等价变异（显示已经为真，多排一次显示不改变可观察结果），不补用例。
