---
schema: nbook.task/v2
taskId: t03-shared-packages-migration
status: active
updated: 2026-10-27
---

# 共享包与迁移

## 目标与范围

按 t01 的方案与 t02 的结论落地：

- 共享包端口：nb-form、nb-agent-ui、nb-markdown、nb-ui 合并各自的 `say`、`formatText`、locale 类型（现有四份副本：`neuro-book/src/shared/localized-text.ts`、`nb-agent-ui` 的 `types.ts`、nb-form 的 `text.ts`、`nb-markdown/src/locale.ts`）；
- 已发布包的兼容：列出包、公开接口是否变、目标版本、发布顺序、宿主重建（nb-form、nb-agent-ui、nb-markdown 已发 0.1.0，nb-story 已发 0.1.1 且随包带 `dist/web`），加 tarball 安装与 `dist/web` 的 smoke。发布本身逐次授权；
- 插件 SDK 还没发布（ADR 0030），直接切换，同时改 `sdk.test.ts` 的导出面快照与 `surface.test.ts`；
- 内联文字用脚本抽进目录：约 1178 处 `"en-US"`、124 个文件（非测试 110 个），按插件逐个切；
- 测试：约 369 个文件断言了中文文字（e2e 37 个里有 30 个），改成按键或结构断言。

估计 8 到 11 个工作日（独立设计的估算），t01 定稿后重估并考虑再拆。

合同：按 t01 定稿后的 Spec，会改 [`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 等的声明字段。

## 当前状态

提案已接受（2026-10-27）。计划：[plan.md](plan.md)（第二版，两轮计划审查已处理）。Haiku 与 Sonnet 的对照实验：`evidences/haiku-experiment.txt`。代码在 Work 分支 `feat/w00028-i18n`（worktree `.worktree/w00028-i18n`）。

### 切片记录

| 片 | 提交 | 验证（实际跑的命令与结果） |
|---|---|---|
| 1 纯数据层与端口 | `d8a2234af` | `packages/nb-ui`：`bunx vitest run src/text src/text-port` 15 过；`bun run typecheck` 退出 0。`packages/neuro-book`：`bun test src/shared/text.test.ts` 11 过；`bun run typecheck` 退出 0。`docs:check`、`governance:check` 无失败 |
| 2 语言类型改字符串 | `967053a30` | `nb-agent-ui`：`bun test` 184 过、vitest 51 过、typecheck 退出 0；`nb-markdown`：`bun test` 261 过、vitest 112 过、typecheck 退出 0；`nb-form`：bun 99 过、vitest 88 过；`dev-panel` typecheck 退出 0；`neuro-book`：`test:bun` 1538 过、`test:vitest` 373 过、typecheck 退出 0。另：nb-agent-ui、nb-markdown 的核心边界与应用 SDK 的服务端子路径放宽到可导入 `@notnotype/nb-ui/text`（纯数据层，没有外部依赖），两包 AGENTS.md 同步改。`nb-story` typecheck 报 `relations-view.ts` 找不到 `StoryNetwork.vue`，master 上同样报，与本片无关 |
| 3a 宿主引擎、窗口能力、注入与本地记录 | `e9cbe52e9` | `neuro-book`：`bun test src/web/host/text-engine.test.ts` 17 过（含与最小实现一致的 8 例）、`locale-hint.test.ts` 2 过；`test:bun` 1555 过、`test:vitest` 373 过、typecheck 退出 0；`docs:check`、`governance:check` 无失败。设计：引擎是窗口能力 `windowTextKey`（`src/shared/window-text.ts`），设置插件新增 `locale` 入口（启动即激活，引擎是可选依赖）把设置值推给引擎，值来自用户层时宿主写本地记录 `nbook.host-locale`；切换语言命令的选项改由 `HOST_LOCALES` 生成。还没有端到端测试覆盖“改设置后界面换语言”，留到 3c 替换各插件的 `displayLocale` 时一起补 |
| 3b 宿主静态文字、`html lang` | `c8330e1c8` | 宿主目录 `nbook.host`（`src/web/locales/{zh-CN,en-US}.json`，`resolveJsonModule` 打开）；失败页、找不到页面、离线横幅、路由标题、加载页提示走目录；两份 `index.html` 内联脚本按本地记录设 `lang` 与读屏名，与目录一致由 `locale-hint.dom.test.ts` 核对；`<html lang>` 跟随端口。`typecheck` 退出 0、`test:bun` 1557 过、`docs:check`/`governance:check` 无失败；`test:vitest` 在机器负载 15 到 20 时有 2 到 3 个 markdown/mount 用例等待超时，在 3a 提交上同样失败（负载所致，与本片无关），其余全过。已知缺口：找不到页面的 `document.title` 切换语言不刷新；英文用语待开发者过目；没跑 e2e，首帧 `aria-label` 未在浏览器验证 |
| 3c 插件改从端口取语言、端到端测试 | `c311eaa22` | 新增 `windowLocale(services, fallback)`（`shared/window-text.ts`）：有窗口翻译引擎时读端口的 `locale`，没有引擎的测试场地退回设置；editor、explorer、plugins、projects、workbench 五个浏览器插件改用它（声明可选依赖 `windowTextKey`）。`window.test.ts` 新增端到端用例：经 `nbook.settings.switch-locale` 命令改设置，窗口端口与插件读到的语言一起切到 en-US。`typecheck` 退出 0、`test:bun` 1558 过、受影响目录 vitest 202 过。不改的：`commands/shared/plugin.ts` 与 `settings/shared/contracts.ts` 的 `displayLocale(settings)`（共享层，服务端也跑，没有窗口引擎；随第 6 片的公开状态原因一起处理）、设置插件自己（它是语言的来源）。共享包目录登记表推迟到各共享包出第一份目录的那一片：现在只有 nb-ui 一份且已在引导里登记，提前建登记表没有内容可放 |
| 4 声明里的文字改收 `TextSchema` | `1344b555f` | 7 个文件的 `LocalizedTextSchema` 换成 `TextSchema`（命令的 `title`、`category` 与公开状态 `reason` 按计划不动）。消费方的做法：`DisplayText` 改为 `Text`；纯 TS 函数收 `TextResolver`（`t` 加 `variants`，`shared/localized-text.ts`）而不是语言标签，覆盖设置窗口、命令搜索与 `otherTexts`、菜单事实 `MenuFacts`、工作台条目与标题栏、编辑器与资源管理器的菜单；组件仍收 `locale` 属性，用 `resolverFor(() => props.locale, useText())` 把语言映射按该属性取、`TextRef` 交端口（过渡期写法，等 `locale` 属性删掉时一并去掉）；插件用 `windowTextPort` 取端口。搜索匹配各语言的写法改用 `variants`。测试用 `textIn(locale)`（`shared/testing/text.ts`）。行为变化：纯字符串与单语言写法由被拒改为接受，`settings.test.ts`、`sections.test.ts` 与相关 Spec（settings-window、configuration、menus、views）同步，无效值改用不合法语言标签。SDK 打包的类型路径映射加 `nb-ui/text` 与 `text-port`，公开面闭包快照加 `shared/text.ts`。`typecheck` 退出 0、`test:bun` 1558 过、`test:vitest` 379 过、`docs:check`/`governance:check` 无失败 |
| 5 目录交付、清单 `l10n`、引导协议 5、registry v5 | `366b2737a` | 由 Opus 编码子代理写，我自己重跑验证：`typecheck` 退出 0、`test:bun` 1568 过、`plugin-sdk` 76 过、`nb-runtime` 405 过、`test:vitest` 379 过、`docs:check`/`governance:check` 无失败；没跑 e2e。校验函数放 nb-runtime 的 `plugin-manifest/catalog.ts`（构建、安装预览、窗口三处共用）；安装在复制后再检一次；引导响应带目录索引 `{plugin, source, locales, digest, prefix}` 并算进修订号；窗口在首连后取目录，缺失只进 `window.plugins` 问题。六个验收场景的测试对应见 `evidences/slice-5-report.txt`。没有真实内置插件带目录，内置路径只用测试插件验证；内置目录登记表在 `src/web/plugins.ts` 的 `builtinPluginCatalogs`，没在 `PluginDefinition` 上加字段。待追认见 `pending-confirmations.md`；热插拔在线替换、插件页按语言显示插件名留后 |
| 6 约定键、SDK 助手、运行期 `Text`、命令合同 v2、目录检查脚本 | `8dfda688b` | Opus 编码子代理写，我重跑验证：`typecheck` 退出 0、`test:bun` 1579 过、`plugin-sdk` 76 过、`nb-runtime` 406 过、`test:vitest` 379 过、`docs:check`/`governance:check` 无失败。登记时补约定键（只补必填的 title）；新增 `SettingsService.declaration()`；`pluginText(ns)` 辅助；目录检查脚本 `scripts/ci/message-catalogs.ts` 进 `governance:check`。详见 `evidences/slice-6-report.txt`（九条待决定）。遗留：内置插件还没有目录；闭合码表没接；`settings.ts` 的 `placeholder`/`unit` 仍是 `LocalizedText`；`explorer/browse.test.ts` 一例在高负载下偶发失败（单跑稳定，推断为时序，根因未查） |
| 7a 试点：`nbook.plugins` 迁到目录 | `5b52fe5d5` | Opus 编码子代理写，我重跑验证：`typecheck` 退出 0、`test:bun` 1582 过、`test:vitest` 380 过、`message-catalogs` 脚本退出 0、`docs:check`/`governance:check` 无失败；没跑 e2e 与 Lab 截图（`plugins.e2e.ts`、`plugin-authoring.e2e.ts`、`plugin-code.e2e.ts` 断言插件页中文，Task 收口时跑）。82 个键，值由脚本从旧版本逐字生成，“文字没变”测试双向核对。迁移指南与抽取脚本在 `evidences/slice-7a-pilot-report.txt` 与 `scripts/extract.ts`、`scripts/build.ts`，后续插件照它派 |
| 7b `nbook.explorer` 迁到目录 | `e1abcc55a` | Sonnet 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1585 过（整套有一例 markdown-dialect 5 秒超时，单跑 27 过，负载所致）、`test:vitest` 380 过、目录脚本/`docs:check`/`governance:check` 无失败。181 键；删 `web/messages.ts`；四个组件改 `useText()` 并标 `state:inject`；Lab 夹具用英文场景 id 约定。决定点见 `evidences/slice-7-explorer-report.txt`（命令/视图动作/菜单三份独立键、中文分隔符仍写死、参数 500 字截断）。e2e 与截图留到收口 |
| 7c `nbook.settings` 迁到目录 | `660293339` | Sonnet 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1589 过、`test:vitest` 380 过、目录脚本/`docs:check`/`governance:check` 无失败。113 键；设置窗口与 `src/ui/settings` 的组件一并迁入；`SettingsRow`、`SettingsSaveBar`、`SettingsPageList` 删了 `locale` 属性（SDK 交给第三方的组件，API 变化，`settings-window.md` 已同步）；`switchSetting` 必须传 `text`。未迁：`choices.ts` 的四条加载失败原因（nb-form 的 `FormText` 装不下 `TextRef`，随 nb-form 片）。详见 `evidences/slice-7-settings-report.txt` |
| 7d `nbook.editor` 迁到目录 | `4e5b99459` | Sonnet 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1595 过、`test:vitest` 380 过、目录脚本/`docs:check`/`governance:check` 无失败。153 键；删 `web/messages.ts`。子代理报告的决定点 1（目录用 `{x, number}`，nb-ui 最小翻译器不认，违反输出 9）我选了让最小翻译器也支持（改 `minimal.ts`、Spec `ui/i18n.md` 输出 6、9，`text-engine.test.ts` 加一致性用例）。未迁：`area.ts`、`commands.ts` 等约 70 处原本只有中文的运行期文字（`area.notice`、命令 reason 等）——这些要让 `area` 与命令工厂收 `TextResolver` 并新写英文，列为迁移完成后的追加切片；`ui.unit` 随 nb-form 片。详见 `evidences/slice-7-editor-report.txt` |
| 7e `nbook.workbench` 迁到目录 | `ab81c76e7` | Sonnet 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1599 过、`test:vitest` 381 过、目录脚本/`docs:check`/`governance:check` 无失败。139 键；约 69 个文件；设置窗口等四处测试辅助补登 `nbook.workbench` 目录（主题、明暗两项现在是文字引用）。随后单独提交放宽 `MenuItemDeclaration.label` 类型为 `DisplayText`。追加切片清单（迁移全完后做）：①editor 与 workbench 里原本只有中文的运行期文字（`area.notice`、命令 `reason`、shell `noLayout`、占位说明等，要新写英文）；②标题栏 4 个菜单项 label 迁入目录；③全角标点由代码拼的几处。英文旧不一致（Auxiliary Bar/Secondary Side Bar 等）逐字沿用，待开发者定是否统一。详见 `evidences/slice-7-workbench-report.txt` |
| 7f `nbook.projects` 迁到目录 | `f880309da` | Sonnet 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1605 过、`test:vitest` 381 过、目录脚本/`docs:check`/`governance:check` 无失败。zh-CN 195 键、en-US 199 键（多出的是英文 `_one`）；10 个组件改 `useText()`；Lab 9 个场景改 `withProjectsText`。服务端失败码文字分三组（`registerFailures`/`errors`/`remoteErrors`），码和语义不变，w00031 接手时再合并。存疑：`FileBrowser.vue` 的中文默认值、`ShelfDesk.vue` 用正则去 `formatWords` 的单位（脆弱，留）。详见 `evidences/slice-7-projects-report.txt` |
| 7g `html-preview`、`image-viewer` 迁到目录 | `a5397f257` | Sonnet 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1609 过、`test:vitest` 394 过、`plugin-sdk` 76 过、目录脚本/`docs:check`/`governance:check` 无失败。10 键与 9 键。`commands`（共享代码 REASONS 3 条，服务端也跑）、`markdown`（`NBOOK_IMAGE_MISSING` 是交给 nb-markdown 的 `MarkdownText`，随 nb-markdown 片）、`files`（全是服务端详情）无可迁界面文字，不建目录。**插件迁移到此结束**（Lab 不迁：开发者页面，固定中文）。`EditorControlProps.locale` 合同属性仍保留，待“删 `locale` 属性”的统一收尾决定。详见 `evidences/slice-7-small-report.txt` |
| 8 取文字样板收敛 | `5343894f2` | 新增 `shared/use-plugin-text.ts`（`usePluginText`、`boundText`），各插件 `web/text.ts` 导出 `useXxxText`，命名空间是 `shared/text.ts` 里的单一常量；25 个组件由 Haiku 机械替换（我复核 diff 并改去重复命名空间字面量），`SettingsPageFrame.vue`（包装函数带 reason 参数）、`WorkbenchShell.vue`（用 resolver）形状不同未改。`use-plugin-text.dom.test.ts` 验证切换语言不重挂载。`typecheck` 0、`test:vitest`、`test:bun`、`docs:check`/`governance:check` 无失败。此辅助函数是 SDK 浏览器入口 `useText` 的基础 |
| 9 nb-agent-ui 接入目录 | `452ae72bf` | Opus 编码子代理写，我重跑验证：nb-agent-ui `typecheck` 0、bun 189 过、vitest 55 过；neuro-book `typecheck` 0、`test:bun` 1609 过、`test:vitest` 396 过；`docs:check`/`governance:check`/目录脚本无失败；nb-story 仅有 master 上已有的 `StoryNetwork.vue` 类型错误。189 键（12 个复数）；删 `messages.ts`、`ViewText`、`textOf`、`HarnessTranscriptOptions`（**公开接口破坏性变化**，仓库内使用方已改）；包新增 `./locales` 子路径；无宿主注入时根组件按自己的 `locale` 建包内缺省端口；`createHostTextEngine` 登记本包目录。子代理发现 nb-ui 最小翻译器复数回退会让中文裸键被英文 `_other` 抢走，我已修（逐语言走三级，加回归测试）。未做：`AssistantMessageView.error`、`MessageAnnotationView.text` 仍是 string；`CatalogKey` 在本包抄了一份；`.ts` 目录没纳入目录检查脚本。e2e（lab-agent-ui）留到收口。详见 `evidences/slice-9-agent-ui-report.txt` |
| 10 nb-form 接入目录 | `8cbf36165` | Opus 编码子代理写，我重跑验证：nb-form `typecheck` 0、bun 112 过、vitest 92 过；neuro-book `typecheck` 0、`test:bun` 1611 过、`test:vitest` 396 过；dev-panel `typecheck` 0；`docs:check`/`governance:check`/目录脚本无失败。79 键；核心只产出 `TextRef`，Vue 层经端口翻译，核心 `import type` 自 `@notnotype/nb-ui/text`；`describeIssues` 第 4 参由 locale 改为 `FormTextApi`（公开接口变化）；`SchemaForm`/`SchemaField` 的 `locale` 改可选；解开 settings `choices.*` 与 editor 单位两处遗留。行为变化：包内缺省端口遇中英以外语言时回退中文（原为英文），应用只用中英不受影响。`explorer/browse.test.ts` 的“展开的目录改名”在 test:bun 里间歇失败，已是第三次（均单跑稳定），列入收口时排查。详见 `evidences/slice-10-form-report.txt` |
| 11 nb-markdown 接入目录 | `e1cc7b22b` | Opus 编码子代理写，我重跑验证：nb-markdown `typecheck` 0、bun 264 过、vitest 120 过；neuro-book `typecheck` 0、`test:bun` 1615 过、`test:vitest` 396 过；nb-story 545 过；`docs:check`/`governance:check`/目录脚本无失败。36 键；`MarkdownText` 放宽为 `Text`；两处 `render()` 带 `appContext`（加测试，去掉赋值会失败）；`NBOOK_IMAGE_MISSING` 迁入新建的 `nbook.markdown` 插件目录；nb-story 的 QaPage 注入合并端口。**公开接口变化**：四个零件去 `locale`、`ChipInput.locale` 换 `translate`、`MarkdownViewHost.locale()` 换 `context?`、删 `prompt-labels.ts`。**通用问题**：一个共享包的缺省端口遮住兄弟包目录（nb-agent-ui 缺省端口里没有 nb-markdown 等），本片只给 nb-story 补了合并端口，nb-ui 片决定是否在底层解决。未动：编辑器里 `html-embed` 缺省 `resolveLabels` 写死中文。e2e 留收口。详见 `evidences/slice-11-markdown-report.txt` |
| 12 nb-ui 默认文案迁入目录 | `0a7da6aa1` | Sonnet 编码子代理写，我重跑验证并审了新写的英文（33 条，读下来自然，未改）：nb-ui `typecheck` 0、vitest 649 过；neuro-book `typecheck` 0、`test:bun` 1619 过、`test:vitest` 396 过；`docs:check`/`governance:check` 无失败。33 键；20 个 `.vue` 属性缺省改走端口（显式传属性以属性为准）；19 个 `.md` 标 `state:inject`。我另把四个共享包目录的“宿主引擎与最小实现一致”测试合并为一组参数化测试（含 nb-ui、nb-agent-ui）。未迁：`grid*.ts`、`sash-drag.ts`、`theme/` 里的开发者诊断（`NestedGrid` 的 `issues` 事件若宿主直接显示给用户需另做）；Breadcrumb/Splitter/Dialog 缩放手柄/ColorPickerPanel 等读屏名仍无属性可覆盖。**共享包片到此结束**。详见 `evidences/slice-12-ui-report.txt` |
| 13 SDK 与通知 | `a4a94a451` | Opus 编码子代理写，我重跑验证：neuro-book `typecheck` 0、`test:bun` 1620 过、`test:vitest` 400 过；`docs:check`/`governance:check` 无失败。新增 SDK 子路径 `/text`（纯，`pluginText`、`CatalogKey`、文字类型）与 `/text/browser`（`useText`、`usePluginText`、`TextPort`，宿主模块表给宿主自己那份，按身份测试）；根入口去掉 `localize`、`formatText`、`pluginText`；示例与模板改用目录；通知标题、正文、动作 `label` 为 `Text`，显示时翻译。验收测试 `plugin-sdk/third-party-text.dom.test.ts`：tarball 构建第三方插件，切语言后文字原位更新。**偏离**：不做激活绑定的 `text()`，保留 `pluginText`（已记待确认）。另修：目录检查脚本与构建预设的矛盾、示例工作台替身。未做：focus 运行期中文、counter 公开状态 reason（服务端不翻译）、`displayLocale` 是否删、内置插件发通知仍传字符串、`examples/external/declarative`、e2e。详见 `evidences/slice-13-sdk-report.txt` |
| 14 workbench 运行期文字 | `4aabb5ae7` | Opus 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1622 过（唯一失败是已知间歇的 explorer 展开目录改名，单独重跑 16 过）、`test:vitest` 403 过；目录脚本、`docs:check`、`governance:check` 无失败。命令失败原因 `CommandResult.reason` 放宽为 `Text`，显示方翻译，失败通知正文随语言更新（标题不随）；远程合同仍 v2；新增 13 键；标题栏菜单项与全角标点入目录；英文术语统一（已记待确认）。因类型放宽顺带改了 editor/explorer/projects/lab 的使用处。未做：“外壳当前不可调整”（nb-ui 布局诊断，建议另片）、命令表自己的原因、`intents.ts`/`views/registry.ts`/主题命令的中文原因、Lab 命令场景在 editor 返回 `TextRef` 后要改用端口翻译。详见 `evidences/slice-14-workbench-report.txt` |
| 15 editor 运行期文字 | `3e54b8712` | Opus 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1624 过、`test:vitest` 406 过；目录脚本、`docs:check`、`governance:check` 无失败。editor 的 area.notice/notify、各动作与命令的 reason、LOST_FORMAT、Monaco 两条原因改为 `editorText` 引用（新增 52 键，英文 2 个单数形），area 不收翻译器；提示条经端口翻译，换语言原位更新；`RescuedText.note` 放宽为 `DisplayText`（browser-host.md、FailurePage.md 同步）；Lab 命令场景自建宿主引擎翻译原因。未做：`saveAll` 失败原因的全角“；”拼接、文件服务失败码、中文开发者诊断（按 ADR 0034 应改英文）、Lab 自己的 editor-commands 与 SampleTextEditor 仍返回中文。详见 `evidences/slice-15-editor-report.txt` |
| 16 收尾 | `1eca95a97` | Opus 编码子代理写，我重跑验证：`typecheck` 0、`test:bun` 1624 过、`test:vitest` 406 过；目录脚本、`docs:check`、`governance:check` 无失败。书架、作品目录、设置窗口、命令失败的通知改传 `TextRef`；新增机检 `scripts/ci/component-inject-tags.ts`（112 个取端口的组件，94 个有 `.md` 且全带 `state:inject`）；editor/settings/projects(welcome) 的开发者诊断改英文。`locale` 属性盘点后全部保留（见待确认）。遗留：projects/workbench 另有约 45 处中文开发者诊断；`WorkbenchDocument.locale` 与 boot.ts 重复；Lab 事件页显示 TextRef 对象；18 个组件无 `.md`。详见 `evidences/slice-16-cleanup-report.txt` |

## 交付：版本表（待开发者授权后再改版本与发布）

改版本、发布按 [`repository-workflow.md`](../../../../docs/standards/repository-workflow.md) 都要开发者授权，本表只是建议，没有动任何 `version`。0.x 的破坏性变化走次版本号。发布顺序按依赖：nb-runtime 与 nb-ui 先，再 nb-form、nb-agent-ui、nb-markdown，然后 nb-story，最后应用与 SDK（同一个版本号）。

| 包 | 现版本 | 建议 | 破坏性变化 | 消费者 |
|---|---|---|---|---|
| nb-runtime | 0.2.0 | 0.3.0 | 无破坏；清单 schema 加可选 `l10n`、新增共享的目录校验导出 | nb-story、应用 |
| nb-ui | 0.2.0 | 0.3.0 | 放宽类型，调用方传字符串仍有效：`NotificationInput` 的 `title`、`message`、`action.label` 与 `NotificationItem` 的对应字段由 `string` 放宽为 `Text`（自己画视口、把这些字段当字符串读的消费者类型报错）。新增 `./text`、`./text-port`（`TEXT_PORT_KEY`、`useText`、`defaultTextPort`，以及共享包目录的登记表 `registerDefaultCatalog` 与根组件用的 `provideDefaultText`）、`./locales`；组件缺省文案改走端口（没有宿主时仍是中文） | 其余共享包、nb-story、应用 |
| nb-form | 0.1.0 | 0.2.0 | `describeIssues` 的第 4 个参数由 `locale: string` 换成 `text: FormTextApi`（不是新增；按旧签名传语言标签的 JS 调用方运行期抛 TypeError）；`FormText` 放宽为 `Text`；组件经端口取文字 | nb-story、应用 |
| nb-agent-ui | 0.1.0 | 0.2.0 | 文字用 `TextRef`（命名空间 `nb-agent-ui`）；`AgentConversationView`、`AgentSessionList`、`AgentModelCatalog` 的 `locale` 由必填改为可选，宿主注入端口时不起作用；删除导出 `ViewText`、`textOf`、`HarnessTranscriptOptions`；`createHarnessTranscript` 去掉参数（传 `{locale}` 的 TS 调用报错，JS 调用方静默失效，错误说明变成 `TextRef`）；`SystemEntry.label` 与错误条目的 `message` 由 `string` 放宽为 `Text`（把它们当字符串读的宿主类型报错） | nb-story、应用 |
| nb-markdown | 0.1.0 | 0.2.0 | 四个零件去 `locale`；`ChipInput.locale` 换 `translate`；`MarkdownViewHost.locale()` 换 `context?`；删 `prompt-labels.ts` | nb-story、应用 |
| nb-story | 0.2.1 | 0.2.2 | 无；QaPage 不再注入合并端口（嵌套的共享包目录由 nb-ui 的登记表合起来），`dist/web` 需重建 | 终端用户 |
| neuro-book 与 nb-plugin-sdk | 0.11.1 | 0.12.0 | SDK 去掉 `localize`、`formatText`，新增 `/text`、`/text/browser`；插件注册表 v5、引导协议 5、命令合同 v2 | 第三方插件作者（SDK 还没有外部发布过的消费者，ADR 0030） |

nb-harness、nb-profile、nb-session 本 Task 没改，版本不动。

已跑的发布前检查（合入 master 之前的 Work 分支上，未发布）：`bun run release:check` 通过；`bun run release:smoke` 通过（本地打包：nbstory 与查看器、Vite 宿主导入 8 个公开入口、`bun add -g` 后 nbook 打开书架、`bunx -p` SDK 生成插件并构建、`nbook plugin install` 后重启已加载）。发布后还要在发布用的提交上跑 `release:smoke --from registry`。

## 收口（2026-10-29）

- 全量 e2e：`neuro-book` 269 过；`lab-agent-ui.e2e.ts` 的一例在 `beforeAll` 里等 `[dev] backend-ready` 超过 30 秒失败，连带 24 个未运行，单独重跑该文件 25 过（启动慢，不是断言失败）。nb-story 的 `test:e2e`（先重建 `dist/web`）54 过，单语中文的页面文字没变。Lab 截图对照没有单独跑，中文文字由逐键“文字不变”测试保证，外观由 e2e 与 Lab 场景覆盖。
- master 合入：Work 分支落后 211 个提交，合入时 3 处冲突（插件页内置名称表、书架 `return false`、`bun.lock`），已解决；合入带来的内置名称双语表已迁入 plugins 目录。
- `explorer/browse.test.ts` “展开的目录改名”间歇失败的根因：父目录的刷新先于 `renamed` 事件到达时，选择里旧地址的行已不在，被可见行 prune 清空；随后的路径跟随作用在空选择上。与 i18n 无关，没有修；真要修需让 prune 认得“刚改名的子树”，记入 explorer 的后续清单。
- 实现审查：后端（omp）与前端（Sonnet）各一份，报告在 `/tmp/w00028-t03/review-impl/`，处理见下一节。

## 实现审查处理（2026-10-29）

报告：`evidences/impl-review-backend.txt`（omp，6 条）、`evidences/impl-review-frontend.txt`（Sonnet，15 条）。修正提交：后端 `6a0c4ef0c`，前端 `0f4c03299`（交付报告 `evidences/slice-17-review-fixes-report.txt`）。

- 后端已修：目录文件严格按 UTF-8 解码；目录拒绝 `__proto__` 键、展开不碰原型；`locales` 本身是符号链接时归 `catalog-invalid`；目录检查脚本报 `locales/` 下的子目录。各补一条负样本测试。
- 后端不改：目录体积、深度与键数上限。插件受信任（ADR 0027），目录端点只读本机已安装的文件，收益与成本不对等。
- 前端已修：插值参数撞 i18next 选项（改走 `replace`）；缺省端口遮住兄弟包目录（nb-ui 加共享包目录登记表，nb-story 的合并端口删除）；非法语言标签；最小翻译器与宿主引擎对数字字符串、回退语言复数的分叉；17 处英文单数（检查脚本新增规则）；引用小块悬停提示不随语言刷新；nb-form 拼接全角标点移入目录；8 处新写的中文开发诊断改英文（`connection.ts` 的两句目录报错会显示在插件页，撤回成中文）；版本表。
- 前端不改：第 6、12 条（`CatalogKey` 抄了五份、取文字入口有五种形状），属重构，超出本 Task，留作后续。

## 下一步

已发布（2026-10-29，提交 `a33d0cba9`），registry 冒烟通过，见 `evidences/release-smoke-registry.txt`。（`ui.i18n` Spec 已晋升，待确认清单已全部追认）。
