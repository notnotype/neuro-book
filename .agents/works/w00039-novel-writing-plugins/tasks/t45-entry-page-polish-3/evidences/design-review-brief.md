# 任务：只读设计审查 w00039/t45：条目页第三轮的实施计划

你在 worktree `/home/notnotype/CodeRepository/neuro-book/.worktree/w00039-novel-writing-plugins`（分支 `feat/w00039-t45-entry-page-polish-3`，刚从 master 开，还没有改动）。审查对象：主工作区的计划 `/home/notnotype/CodeRepository/neuro-book/.agents/works/w00039-novel-writing-plugins/tasks/t45-entry-page-polish-3/plan.md`。读代码读 worktree 里的；读 Spec 与 Task 记录读主工作区（`/home/notnotype/CodeRepository/neuro-book/`）的。

找出它的问题。假定作者过于自信：找没写出来的假设、没处理的边界、隐含的耦合与共享状态、违反合同的方式、被破坏的既有约定、异常输入下的失败。不要复述、不要给总体评价；找不到问题时明确写“仔细检查后没有发现”。

## 依据

- Task README（开发者的四条原话摘要与答复）：`/home/notnotype/CodeRepository/neuro-book/.agents/works/w00039-novel-writing-plugins/tasks/t45-entry-page-polish-3/README.md`
- 开发者已确认的决定（2026-11-27，会话里答四道选择题，又对计划答“可以”）：
  1. 种类可以登记几种有名字的预设，插件可以追加；“添加一组设定”改成对话框，顶上点一个预设把它的几组勾上；新建条目对话框里也能用。
  2. 三种看法的切换放在选中的设定组分页上（“人物 ▾”，点开选三种），非缺省的看法在分页上写明；名字“用户视图 | AI视图 | 原始视图”。
  3. 成段文字在原文下方出浮层，原文不动，盖住后面的内容、不推开。
  4. 人物分页的富文本编辑归 w00055，不在本 Task。
  5. 计划里的内置预设（人物“基本”“主要角色”）、“第一次点选中、再点出菜单”、不加“看得出能点”的提示，开发者答“可以”。
- Spec：`docs/specs/canon/author-ui.md` 输入一节的 `canon.entry-kinds`、输出 4、9、38、51、54（主工作区）。
- 设计顾问意见：同 Task 目录 `evidences/designer-r1.txt`。
- 相关代码：`packages/neuro-book/src/plugins/canon/web/components/` 的 `EntryPage.vue`、`EntryPageNav.vue`、`EntryPageHost.vue`（`fieldEditorOf`、`pickerItems`、`addComponent`、`dataLook`）、`AddComponentPicker.vue`、`NewEntryDialog.vue`、`CharacterCard.vue`、`LookCard.vue`、`ConfirmBar.vue`；`canon/shared/entry-kinds.ts`、`canon/shared/components.ts`、`canon/web/entries-view.ts`、`canon/backend/plugin.ts`；`plot/plugin.ts`；nb-ui 的 `controls/Tabs.vue`、`feedback/Popover.vue`、`popup/ContextMenu.vue` 与同名 `.md`、`packages/nb-ui/docs/ui-development-spec.md`。

## 重点

1. nb-ui `Tabs` 加 `menu`：选中的标签再点、Enter、Space、ArrowDown 发 `menu`。和 `Tabs` 现有的键盘（方向键自动激活、Home/End、roving tabindex）、`adapt` 档位与“更多”、指示线测量、读屏（`role=tab` 上的 `aria-haspopup`）会不会冲突；EntryPage 现有的分页拖动、右键菜单、`entry-tabs.ts` 的分页项构造怎样接。
2. 成段文字改用 `Popover`（Reka）：Spec 输出 51 对成段文字的要求（点外面不收起、Escape 与“取消”放弃、Ctrl+回车保存、输入法组字中不算放弃、切走分页再回来草稿还在、打开时滚进可见范围、浮层不越出条目页）在受控 `Popover` 下能不能都成立；Reka 的焦点陷阱、`modal: false` 下点外面的事件、浮层随滚动的定位；计划里“Escape 是 ConfirmBar 自己处理还是靠浮层”的不确定处，请读 `ConfirmBar.vue` 给出结论。
3. 预设的登记格式与并法：贡献 id 前缀校验、剧情插件往 canon 内置的种类追加（插件启用顺序、canon 停用时）、同 id 不同显示名、预设写到不可用的类型、诊断写在哪里；会不会和已有的 `components`（默认组）、`order`、`icon` 的并法互相影响。
4. `ComponentChecklist` 两处共用：键盘模型（搜索框与列表之间的焦点、Space、Enter、打字回搜索框）是否自洽、是否符合 ARIA 的常规写法；新建条目对话框里“作者没动过勾选时跟着种类换默认”的规则加了预设以后还成不成立；多组一次写入（几条 `component add` 在一次 `runEntries` 里）内核收不收、失败时的提示。
5. 计划有没有漏掉要改的调用方与测试：`AddComponentPicker` 的使用方、e2e（`packages/neuro-book/e2e/` 里搜 `data-add-component`、`data-data-look`、`搜索设定组`、`data-editing-in-place`）、Lab 场景（`packages/neuro-book/src/plugins/lab/web/fixtures/index.ts`）、文案键。

## 审查维度

1. 与已定设计一致：上面的决定逐条覆盖，没有悄悄改变已定项。
2. 依赖的机制真的存在：方案依赖现有机制的顺序、时序或寿命保证时，读该机制的 Spec 或实现确认，不按名字推断。
3. 接口与合同：类型与语义一致；失败有通道；后续切片照字面实现会不会返工。
4. 遗漏：失败路径、资源释放、兼容与迁移。
5. 对照参照：同一应用里同类交互的现有做法（例如别的对话框、别的勾选列表、别的浮层的键盘与焦点），列出参照有、计划没有的项。
6. 验收映射：每条判据有对应测试，测试能用真实运行时写出来。
7. 别扭与反常之处：和普遍做法、仓库里同类实现不一样的地方，逐处判断是有理由的取舍还是能优化，给出改法。
8. 上游选择：方案在迁就的更底层选择（nb-ui 组件的能力、已接受的决定）的理由现在还成不成立。
9. 界面规矩：界面上只留能操作的东西与状态、不写解释系统内部的说明文字；每个状态变化都有过渡（`.agents/skills/ui-development/SKILL.md` 第三节第 5、6 条）。计划里的新界面有没有违反。

## 规则

- 只读：不修改仓库文件，不 commit、push、stash、切换分支，不删除文件。实验文件只放在 `/tmp/review-t45-design/`。
- 可以跑类型检查与单测（在上面的 worktree 里）；不跑 e2e 与开发服务。
- 每核实一条就追加写入报告文件（用 `cat >> 报告 <<'EOF'` 一次写一条），不要等到最后。不开子代理。
- 有数字就给数字；问题是真的就直说。
- 用中文写。

## 报告

写到 `/tmp/review-t45-design/report.txt`。按影响排序，每条用 `### N. 标题` 开头，写：严重程度（阻断 / 重要 / 建议）、类别、位置（文件:行）、现象、为什么是问题、如何核实、建议改法。最后写“未发现问题的方面”、各级数量与有效发现的编号。报告写不成时放进最终回复。
