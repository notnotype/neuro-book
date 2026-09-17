# 实施与验证记录

## 缺口是怎么算出来的

不靠印象，按 `component-index.ts` 的同一条规则重算：扫 `packages/neuro-book/app/components/**/*.md` 里同时存在同名 `.vue` 的条目，解析 frontmatter `标签:`，按 `io:` / `state:shared-write` / `persist:` 判可挂载性，再与 `fixtures/index.ts` 的 `component:` 名单求差。

- 组件条目 54（产品 48 + Lab 零件 6）；可挂载 53；登记 44。
- 可挂载但无场景：`CodeEditorView`、`EditorTabBar`、`EditorToolbar`、`EditorViewHost`、`EditorWelcome`、`MarkdownEditorView`、`MonacoCodeEditor`、`novel-ide/settings/sections/components/SettingsLoadState`、`workbench/WorkbenchContainerSection`。
- Lab 自己的零件（`CollapsibleSidePanel` / `EventLogPanel` / `HighlightBox` / `MarkdownView` / `SurfaceTierDemo` / `ViewportCanvas`）本来就有场景，不在缺口内。
- 没有「登记了但索引里不存在」或「登记了被阻断组件」的条目；当前也没有「可挂载且需状态快照（`state:shared-read`）」的组件——唯一的 `WorkspaceFilePanel` 同时带 `io:`/`persist:`，属不可挂载。

## 交付

9 个夹具 + 41 个场景，全部登记在 `app/component-lab/fixtures/index.ts`：

| 组件 | 场景 | 被检视的东西 |
|---|---|---|
| `EditorTabBar` | mixed / overflow / pinned-only / single-preview | 固定行与普通行、超长标题截断与横向滚动、脏点与预览斜体 |
| `EditorToolbar` | default / checked / submenu / empty | 快捷键、分隔符、停用与危险项；勾选态的可读表达；子菜单递归；空菜单数组 |
| `EditorWelcome` | novel-empty / novel-recent / user-assets / compact / readonly-node | 快捷动作、最近标签主按钮、素材库档、紧凑档、不可编辑节点分支 |
| `EditorViewHost` | switch / pending / view-error / single | 受控宿主的可见性、结算与错误收敛（替身视图，非真实内核） |
| `CodeEditorView` | markdown / json-invalid / html-source / readonly / empty | 真实 Monaco 下的语言投影；非法 JSON 原样保留；只读与空文档 |
| `MonacoCodeEditor` | markdown / typescript / readonly / placeholder / preferences | 内核入参：初值、语言、只读、占位文案、显示偏好与临时字号 |
| `MarkdownEditorView` | prose / comments / frontmatter / readonly / empty | 真实 TipTap；批注正文与批注面板动作；frontmatter 与正文分离；只读 |
| `SettingsLoadState` | loading / loading-message / error / error-custom-action | 整块加载与失败态、默认与自定义文案 |
| `WorkbenchContainerSection` | scroll / collapsed / fill / empty-text / no-collapse | 两种排版、受控折叠、空态、不可折叠头部 |

约定与边界（写进每个夹具的头部注释）：

- 夹具扮演宿主，`data-lab-subject` 标在被检视组件上；正文、tab 清单、菜单结构、节点快照都是夹具提供的内存假数据。
- 夹具不读写磁盘、不接 store、不联网、不依赖浏览器持久化；没有「已保存」「重试成功」这类结论。
- 编辑器内核场景挂真实 Monaco / TipTap；`EditorViewHost` 用明确标注的替身，因为那里检视的是宿主合同。替身按合同接线：`onMounted` 交出句柄、`onBeforeUnmount` 撤回、输入经 `events.change` 上报、外部正文更新覆盖本地草稿。
- 列表型场景（标签清单、欢迎区节点）的登记初值只放夹具一处，避免在 `index.ts` 里再抄一份长清单。

## 顺带修的两处既有缺陷

1. **`settings.state.reload` 两个语言包都不存在**（`settings.state` 下只有 `loading`）。`SettingsLoadState` 错误态在 `actionLabel` 留空时 `t("settings.state.reload")`，实际会渲染成原始键并打缺失告警。补 `zh-CN: "重新读取"` / `en-US: "Reload"`；夹具里自定义文案改成「重新加载设置」，否则新加的两档看起来一模一样。
2. **`EditorToolbar.md` 声明了不存在的无障碍行为**：文档写「补充 `aria-label` 与 `aria-checked` 状态描述」，但 nb-ui `Menubar` 模板不消费 `checked`、也不渲染任何勾选 ARIA，组件实现只做「文案后缀 + check 图标 + 原始叶项回传」。按实际行为改写该条，并把零件夹具入口补进文档的 Lab 段。

## 回归护栏

`fixtures/index.test.ts` 新增两条断言：

- 索引里每个**可挂载**组件都必须有场景登记（场景非空且 `load` 是函数）；失败信息直接给出组件名单与修法（登记场景，或按组件规范补阻断标签）。
- 登记不得指向不存在的组件名或不可挂载的组件——写错名字的登记在 Lab 里永远选不中，属于静默失效。

组件规范把纯零件/受控零件的状态说明交给 fixture 承载，所以第一条不是整洁强迫症；不可挂载的组件（`io:` / `state:shared-write` / `persist:`）不在此列，Lab 不给它们造替代场景。

## 真实浏览器证据

环境：隔离验收副本 `C:/Users/notnotype/AppData/Local/Temp/neuro-book/acceptance/editor-44caddf6`（独立源码 linked worktree、独立依赖与 `.nuxt`、端口 44322），独立 headless Chrome（CDP 44323）。3001 未参与。

- 组件树显示 `54 / 54`，9 个组件均在 `editor-workbench`（及 `novel-ide` / `workbench`）分组下可选。
- 逐个组件、逐个场景真实点击切换：41 个场景全部挂载出内容，`data-lab-subject` 有正尺寸（如 CodeEditorView 388×750、EditorWelcome 388×809、SettingsLoadState 370×318），页面横向溢出 0，控制台 `error` / `pageerror` 为空。
- 内核档实际渲染：Monaco 行号与语言高亮可见、空文档显示占位文案、偏好档不显示行号；TipTap 档渲染批注正文与 frontmatter 面板。
- 宿主交互路径（这是本批唯一需要交互才看得出的合同）：
  - 点「慢就绪替身」后 350ms，可见 textarea 仍是「源码替身」；2 秒后变成「慢就绪替身」——目标就绪前旧视图不被隐藏。
  - 点「失败替身」后出现「宿主收敛到的失败：失败替身 渲染即失败：这是替身登记的失败分支，不是产品缺陷。」，旧视图仍在，无白屏。
- 截图留在验收根：`lab-CodeEditorView-markdown.png`、`lab-CodeEditorView-json-invalid.png`、`lab-EditorViewHost-error.png`、`lab-MarkdownEditorView-prose.png`。

## 审查后修复（第二轮）

- 对齐 `docs/specs/ui/component-lab.md` 与 `fixtures/index.test.ts`：源码仓库内所有可挂载组件必须有非空 fixture 场景；Lab 仍保留无 fixture 的防御性空态。
- 修正 `EditorViewHost` 的 `view-error` 初始场景为 `crash`，并为宿主替身 textarea 增加可访问名称；切换回正常替身时清除旧错误横幅，避免错误态与正常视图并存。
- 删除 `EditorTabBarFixture` / `EditorWelcomeFixture` 中未登记数据驱动路径；`MonacoCodeEditorFixture` 对顶层 JSON 与 `preferences` 按字段运行期收窄，非法值回退登记初值。
- 重构 `WorkbenchContainerSection`：折叠 toggle、静态标题和 actions 同级渲染；不可折叠区段不再使用 disabled header button；新增 2 个行为回归测试。
- 为 `LabShell` 的异步 fixture loader 增加 revision guard 和局部错误收敛；迟到 loader 不得覆盖最后一次组件选择，失败不产生未处理 Promise。

## 第二轮验证

| 命令 / 场景 | 结果 |
|---|---|
| `bun run test app/component-lab app/components/editor-workbench app/components/workbench` | 16 文件 / 74 例通过 |
| `bun run typecheck` | exit 0，无诊断 |
| `bun run docs:check` | failures=[]，5947 文件 |
| `bun run governance:check` | failures=[]，warnings=[] |
| `git diff --check` | 无空白错误；仅报告工作树文件的 LF/CRLF 转换提示 |
| 隔离浏览器 `WorkbenchContainerSection / 不可折叠` | 无嵌套 button；无 toggle button；宿主刷新 action 可见且可点击 |
| 隔离浏览器 `EditorViewHost / 视图抛错被宿主收敛` | 初始错误横幅与失败替身出现；切回源码替身后错误横幅消失，textarea 的 `aria-label` 为 `源码替身 正文草稿` |
| 隔离浏览器 390×844 | `scrollWidth=390`、`clientWidth=390`，无横向溢出，无失败文案 |
| `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:44322 --browser-executable <chrome> --suite all` | exit 0，Component Lab smoke passed |

验收副本与 44322 服务仅用于浏览器验证；3001 未参与。临时 `lab-loader-race.ts` 已删除。

## 最终边界

- 未跑全仓测试与生产 build；未执行四主题完整视觉矩阵、真实桌面 bridge、Provider/Model、多窗口或 World Engine / Agent Chat Flow。
- 本地工作树保留用户原有 `descriptors.ts` 与 `descriptors.test.ts` dirty 改动；本任务未修改其内容、未暂存、未重置。
