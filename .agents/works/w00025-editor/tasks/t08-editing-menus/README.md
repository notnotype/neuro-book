---
schema: nbook.task/v2
taskId: t08-editing-menus
status: active
updated: 2026-11-05
---

# 编辑命令与菜单

## 目标与范围

编辑命令登记为工作台命令；固定工具栏、选区浮动菜单、块手柄与块菜单、正文右键菜单、斜杠命令。行内 AI 用的编辑器接口拆到 [t12](../t12-inline-ai-editor-api/README.md)，批注界面在 [t13](../t13-comments-ui/README.md)（决定 1、4）

合同：[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)（新增菜单位置）、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)（编辑命令登记）、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（“不承诺”里的正文右键菜单）。来源：t06 决定 3、13，开发者 2026-10-16 补充块手柄、命令系统与行内 AI。

## 开发者的决定

1. （2026-10-20）行内 AI 用的编辑器接口不在本 Task 做，拆到 t12，等 Agent Work 接入时再做：现在没有使用方，做了没法验收。
2. （2026-10-20）注意力排序：只有固定工具栏常驻，放在标签栏下方，与 720px 的版心同宽居中，可在“视图”菜单里关掉，默认打开；选区浮动菜单、斜杠命令、块手柄、正文右键菜单按需出现。块左侧照 Notion 放两个按钮：拖动手柄与 `+`。
3. （2026-10-20）插件能往这些菜单里加东西：每种菜单一个菜单位置，菜单项照 [`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md) 的规则显示；所有编辑动作登记成工作台命令，按钮的选中状态由编辑器发布成公开状态，Ctrl+B 这类快捷键照旧。
4. （2026-10-20）“加批注”不在本 Task 做，连同批注的编辑与删除归 t13；本 Task 不放这一项。
5. （2026-10-20）块左侧两个按钮照 Notion 分工：点 `+` 在下方插入一个空块并打开斜杠菜单（按住 Alt 插在上方）；点拖动手柄打开块菜单（转换为、复制、删除等），拖动手柄移动块。
6. （2026-10-20，评审板第 1 轮 `r1-set`）固定工具栏用完整的一套（19 个）：撤销、重做｜块类型｜粗体、斜体、删除线、行内代码｜文字颜色、高亮｜链接｜无序、有序、任务列表｜引用、提示块、代码块｜对齐、清除格式｜⋯（上标、下标、分割线、注音、双语）。版心变窄时从右往左收进“⋯”。
7. （2026-10-20，`r1-surface`）工具栏平铺：没有底色，按钮从正文左边缘起排，下面一条分隔线。
8. （2026-10-20，`r1-gutter`）块左侧按钮不通过：要再往左移，现在离文字太近；悬停底色的圆角太圆。第 2 轮改。
9. （2026-10-20，`r2-gutter`）块按钮右缘离正文 14px，悬停底色圆角 4px。
10. （2026-10-20，`r2-bubble`）选区浮动菜单只放行内格式：粗体、斜体、删除线、行内代码｜链接、文字颜色、高亮｜注音、清除格式｜插件的菜单项。
11. （2026-10-20，`r2-slash`）斜杠菜单的内容与行为照评审板（四组：基本、列表、块、插入；插入类等 t09；按名称与拼音首字母筛选）。开发者另提：底部的按键提示不要；关心面板是否用了 nb-ui 的组件与规范、为什么看不到滚动条、面是不是 nb-ui 下拉那种磨砂半透明。核实结果：Composer 的 `PromptMenuPanel` 只用了 nb-ui 的 `Kbd`、`Spinner`，面是自己写的不透明 `--bg-panel`（不是 `nb-ui-popover-surface` 的磨砂），列表是原生滚动，没有 nb-ui 浮层的 4px 浮动滑块与底部渐隐，不合 nb-ui 下拉的规范。处理方式：开发者 2026-10-20 定先另开 nb-ui 的整理（w00029），把弹出列表收成一套、做不抢焦点的候选菜单，同时整理 nb-ui 的组件、命名与文档；做完再回到本 Task。
12. （2026-11-05，`r3-block`）块菜单：转换为｜创建副本、复制｜上移、下移｜插件的菜单项｜删除。对齐和颜色不放，常驻工具栏里有。
13. （2026-11-05，`r3-context`）正文右键菜单：剪切、复制、粘贴、粘贴为纯文本｜全选｜插件的菜单项；没有选区时剪切、复制置灰。保存、撤销重做、插入、注音、双语不放。
14. （2026-11-05，`r3-slash`）斜杠菜单用 nb-ui 的 `SuggestionMenu`，右侧不写 Markdown 写法，输入处没有占位提示（新规则“界面不靠说明文字解释自己”，[`design-language.md`](../../../../../packages/nb-ui/docs/design-language.md#四排版)）。决定 11 里“右侧灰字”按这条改。
15. （2026-11-05，计划）t09 搁置期间不出现链接按钮，t09 登记命令后自动出现；注音与双语用带单个输入框的弹层；上移、下移加快捷键 Alt+↑、Alt+↓；拼音筛选用 `pinyin-pro`，按需加载。

不需要开发者定、按新方言处理的：下划线不搬（新方言没有）；缩进只在列表里有；插入链接与图片的做法归 t09，本 Task 只留入口（见 [research.md](research.md) 的“与新应用对不上的地方”）。

## 当前状态

完成，已合入本地 master（`fcefe8f4a`、`b079a5834`），没有 push。合同：[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)，状态 `planned`、待晋升，晋升由开发者批准。

做了：`nbook.edit.*` 命令与公开键、五个菜单位置、固定工具栏（可在“视图”菜单关掉）、选区浮动菜单、斜杠菜单（拼音首字母筛选）、块按钮与拖动、块菜单、正文右键菜单。nb-ui 新增 `AnchoredPopover`，`Toolbar` 加 `variant="flat"`。Composer 与正文共用抽出来的触发插件。

验证：

- 新 e2e `markdown-editing.e2e.ts` 32 条（真实 Chrome、产品页、真实文件服务），合入 master 的改动之后连跑两轮 64 次全过；复跑时抓到一个真缺陷：工具栏下拉菜单关闭时把焦点还给按钮，已修（`b079a5834`）；现有编辑器 e2e（`markdown-input`、`lab-markdown`、`lab-editor`、`editor-area`、`editor-types`）同跑：两条失败，一条是这份新测试的写法错误，已改；另一条 `markdown-input` 的“行尾用输入法打字”是打开文件时的竞争，单独跑三次全过。之前一轮 `editor-area` 的“重新打开回到上次的光标”在负载下失败一次，单独跑两次全过，判断是按键早于聚焦。这两条老用例的等待没有改。
- `test:affected --since master --typecheck`：只有 nb-story 类型检查失败（`qa-service.ts:548`，老问题）。
- `governance:check`、`docs:check` 通过。
- 入口 chunk 不含 Tiptap、ProseMirror，拼音库单独分块。
- nb-ui 两处改动：nbook、macos × 明暗 × 1100px、390px 量过，没有横向溢出，`AnchoredPopover` 的外框没有 `role`。

没有验证到的：`AnchoredPopover` 翻到另一侧（Lab 的窗口里锚点上方总有空间，场景已删，翻转由 floating-ui 负责）；拖到边缘自动滚动的路径；Firefox 与 Safari 的剪贴板差异；换文档时注音弹层收起（只有代码，没有单独的 e2e）。

审查：设计审查 17 条（[报告](evidences/design-review.txt)、[处理](evidences/design-review-disposition.txt)），实现审查 13 条（[报告](evidences/impl-review.txt)、[处理](evidences/impl-review-disposition.txt)）。

待开发者追认（都是审查后主会话定的）：

1. 命令、公开键与菜单位置归 `nbook.editor`。要改回：加反向连接与类型互引。
2. 行首的 `、` 算斜杠（中文输入法下这个键打出的字符）。要改回：删一个正则。
3. 列表项转换为正文或标题时把列表断开。
4. 容器块（引用、提示块等）的手柄对着整个容器。
5. 解开带标题的提示块时，标题留成开头一段。
6. 多块选区上的块动作只作用于第一块。

## 下一步

开发者看过实际效果后决定是否批准 Spec 晋升。草稿 worktree `.worktree/w00025-t08-drafts` 不再需要。
