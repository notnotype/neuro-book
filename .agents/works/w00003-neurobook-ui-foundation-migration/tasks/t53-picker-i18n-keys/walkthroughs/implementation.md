# t53 补齐 Picker 缺失文案并覆盖两个布局场景

## 决策：复用既有 key，不新增 `changeCover`/`deleteProject`

**依据是"动作是否同一件事"，我判为同一件事：**

| 调用点 | 动作（事件） | 既有同动作调用点 | 结论 |
|---|---|---|---|
| `ProjectPickerClassicCompactView.vue:160`、`ProjectPickerClassicEditorialView.vue:178` | `emit('open-cover-dialog', project)` | `ProjectCard.vue:151`（经典网格）用 `t('ide.picker.setCover')` | 同一动作 → 复用 `ide.picker.setCover` |
| `ProjectPickerClassicCompactView.vue:167`、`ProjectPickerClassicEditorialView.vue:185` | `emit('delete', project)` | `ProjectCard.vue:159`（经典网格）用 `t('ide.bookshelf.deleteBook')` | 同一动作 → 复用 `ide.bookshelf.deleteBook` |

补充依据：

1. 三个视图是**同一个书架**的三种呈现，行内入口连事件名都相同；上游删除流（`ProjectPickerScreen.vue:308/325`）用的也是 `ide.bookshelf.deleteConfirm` / `ide.bookshelf.deleteFailed`，`ide.bookshelf.*` 就是这条动作线的既有词汇。
2. 「更换封面」与「设置封面」的差异只在**措辞**，不在动作：行内按钮打开的是同一个 `ProjectCoverDialog`，是否已有封面由对话框内部区分（`chooseCover` 选图 / `replaceCover` 替换图片）。行内入口不需要按有无封面分文案。
3. 若产品确实想要「更换封面 / 删除作品」这套措辞，那是一次**跨三个布局的文案重设计**（经典网格也该跟着改），不是给两个视图各加一个近似 key 的补丁；t53 的定位是"补齐缺失文案"。
4. 复用还有一个直接好处：不新增 key，就不存在 zh-CN 与 en-US 之间新的漂移面（本次 **locale 文件一行未改**，也就与 t50 返工代理无并发写风险——它已确认不碰这两个文件）。

## 改动（4 处调用点，0 个 locale 文件）

| 文件 | 行 | 前 | 后 |
|---|---|---|---|
| `app/components/novel-ide/project-picker/components/ProjectPickerClassicCompactView.vue` | 160 | `t('ide.picker.changeCover')` | `t('ide.picker.setCover')` |
| 同上 | 167 | `t('ide.picker.deleteProject')` | `t('ide.bookshelf.deleteBook')` |
| `app/components/novel-ide/project-picker/components/ProjectPickerClassicEditorialView.vue` | 178 | `t('ide.picker.changeCover')` | `t('ide.picker.setCover')` |
| 同上 | 185 | `t('ide.picker.deleteProject')` | `t('ide.bookshelf.deleteBook')` |

未改：交互语义、事件、图标、样式；`title` 之外未加 `aria-label`——nb-ui `IconButton` 的 `:aria-label="props.ariaLabel || props.title"` 已把 `title` 作为无障碍名，补一条是多余的。

`packages/neuro-book/scripts/smoke/project-picker-view.ts`（t52 的脚本）同步扩展：新增 `compact`（密集列表）与 `editorial`（宽幅图文）两阶段，并把 t52 里"因缺 key 不纳入"的注释整段删除。

## key 清单核对

- 复用 key 在**两个 locale 都存在**：zh-CN `ide.picker.setCover`「设置封面」/ `ide.bookshelf.deleteBook`「删除书籍」；en-US `Set cover` / `Delete Book`。
- 全量核对 picker 表面：扫 `app/components/novel-ide/ProjectPickerScreen.vue` + `app/components/novel-ide/project-picker/**/*.vue`（11 个文件）里所有 `t("…")` 字面 key，共 **61 个**，对着两份 locale 的展平 key 集合求差：

```text
missingInZh: []
missingInEn: []
```

（只覆盖 `t("字面量")`：模板里拼接出来的动态 key，例如 `ide.picker.genres.${id}`、`ide.picker.layout*`，不在本次核对范围。）

- 三个布局现在用同一套行内文案：

```text
ide.picker.setCover        → ProjectCard.vue, ProjectPickerClassicCompactView.vue, ProjectPickerClassicEditorialView.vue
ide.bookshelf.deleteBook   → ProjectCard.vue, ProjectPickerClassicCompactView.vue, ProjectPickerClassicEditorialView.vue
```

## 验证

- cwd：`C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration/packages/neuro-book`
- 服务：复用运行中的 3001（未启停/未重启；未在其中写业务数据）。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3001 --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe" --suite project-picker` | 0 | `Component Lab Project Picker smoke passed`；失败条目 0，含新增的两个布局阶段（密集列表 14 行 / 宽幅图文 14 行、网格卡片让位） |
| 同上 `--suite all` | 0 | `Component Lab smoke passed`；失败条目 0 |
| 同上 `--suite core` / `--suite agent-profile` | 0 / 0 | 未受本次改动影响 |
| `bunx vitest run app/components/novel-ide/project-picker app/component-lab/fixtures/ProjectPickerViewFixture.test.ts` | 0 | 2 个文件 19 个用例全过 |
| `bunx tsc --noEmit --pretty false -p scripts/tsconfig.json` | 2 | 仅剩已登记基线错误 `scripts/deploy/product-agent-state-root-smoke.ts:318`；本次改动的脚本无新增错误 |

**负面对照（改 key 之前、同一实例同一 revision）**：t52 的 smoke 带上这两个布局场景后，一进 `compact`/`editorial` 就产出 14 行 × 2 个缺失 key × 2 个视图 = **56 条** `[intlify] Not found 'ide.picker.changeCover' | 'ide.picker.deleteProject' key in 'zh' locale messages.`，console 监听把它们记为失败 → exit 1（日志 `Temp/nb-t52-picker/run1.log`，断言本身全部通过，失败只来自 warning）。修好 key 后同一阶段零 warning、exit 0 —— 这就是本缺陷的回归证据。

**未放松判定**：`observePage`（`scripts/smoke/component-lab.ts`）的 console/pageerror 收集逻辑一行未改；本次是通过"让 key 真的存在"消掉 warning，不是过滤 warning。

## 覆盖到的场景（`--suite project-picker`）

`default`（经典网格）、`compact`（密集列表）、`editorial`（宽幅图文）、`empty`（零项目空态）、`create-dialog`（新建对话框）、`loading`（加载中）、`load-error`（加载失败）、`phone`（手机 390×844）。fixture 的 `creating`（创建中）不在 smoke 内，由 `ProjectPickerViewFixture.test.ts` 覆盖。

## 未验证项

- 未做人工视觉验收：两个布局的行内按钮文案是 `title` 悬浮提示，smoke 只验证"没有缺失 key warning + 视图逐行渲染"，未逐像素确认 tooltip 视觉。
- 未跑 `bun run typecheck` / `nuxt prepare|generate|build`（会重建共享 `.nuxt`、摧毁 3001，Leader 明令禁止）。
- 未跑 `docs:check` / `governance:check`（全项目门禁由 Leader 统一执行）。
- 动态拼接的 i18n key 未纳入本次清单核对（见上）。
- 未改 `app/i18n/locales/*.ts`：本次走复用路线，未新增 key，因此"新 key 在两个 locale 都存在"这一类核对不适用；两个 locale 文件保持原样。

## 协作记录

- 编辑前已 `hub send` 与 `BrowserTitlebar`（t50 返工代理）约定顺序：它回复未编辑 `app/i18n/locales/*.ts` 及其邻域（它在改 `app.vue`、`DesktopTitleBar*`、`workbench-chrome.ts`、`vitest.config.ts` 等）。因本次复用路线不触碰 locale，最终无文件重叠；我在这两个 picker 视图上的编辑与它的清单不重叠。
