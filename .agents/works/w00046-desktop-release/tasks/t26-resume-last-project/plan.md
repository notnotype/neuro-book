# t26 实施计划：打开 NeuroBook 时回到上次的作品

## Context

开发者 2026-11-25 要求：NeuroBook 每次打开时恢复之前的作品，而不是像现在这样打开书架。会话里确认的决定：

1. 只在“启动类入口”恢复：桌面版启动、点托盘或 Dock 开窗、`nbook` 命令打开浏览器。浏览器里手动打开地址、“回到书架”、出错页的“不打开项目”仍是书架。上次的作品已移出书架时落到书架。
2. 只恢复最近打开的那一部，不恢复多个窗口。
3. 加设置“启动时打开：上次的作品 / 书架”，缺省上次的作品。

现状（子代理调查，文件见下）：打开作品是整页导航到 `/?project=<短名>`，`/` 与 `/?project=` 是同一路由，靠窗口有没有绑定项目切换书架与工作台；登记表 `projects.json` 只有 `{id, name, path}`，没有“最近打开”；桌面壳与 `nbook` 命令打开的都是服务端根地址；没有“打开某部作品”的命令行参数。

依据：[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md)（输出 9、19）、[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md)（输出 21 的 `http.routes`）、[`runtime/desktop-shell.md`](../../../../../docs/specs/runtime/desktop-shell.md)、[`runtime/cli.md`](../../../../../docs/specs/runtime/cli.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 的失败呈现。

## 技术选型

无。

## 关键设计

### 思路

启动类入口不再打开 `/`，而是打开 `nbook.projects` 的一条服务端路由 `GET /api/nbook.projects/resume`，由它 302 到 `/?project=<短名>` 或 `/`。在服务端判断，窗口只加载一次：不先画书架再跳（页面里判断要整页再加载一次，因为绑定在握手时就定了）。手动打开 `/`、回到书架、出错页链接都不经过这条路由，所以不会来回跳：上次的作品打不开时停在“无法打开项目”页，“不打开项目”回到书架。

### `packages/neuro-book/src/plugins/projects`

- **记最近打开**：`shared/contracts.ts` 的远程合同加 `opened({id})`；浏览器入口在窗口绑定了项目（引导给了 `project`）时调一次，失败只写诊断。服务端先用登记表核对 id（不在登记表里就不记、交回 `not-registered`），再把 `{id}` 写进插件的用户层记录 `projects.last-opened`，写法照 `projects.stats`（`shared/stats-record.ts`、`project/stats-tracker.ts`）：记录 `corrupt` 或 `unsupported-version` 时 `reset` 后再写，不让一份坏记录永久挡住。语义是“最近一次有窗口绑定的作品”：多个窗口时后绑定的覆盖先绑定的，刷新再写一遍同一个值，无害。不存时间（没有使用者）。
- **设置**：`shared/contracts.ts` 加 `startupOpen`：`"last-work" | "shelf"`，缺省 `"last-work"`，用户层，`section: "nbook.works"`，标题“启动时打开”，选项“上次的作品”“书架”；配置项的贡献加进 `backend/plugin.ts`（与 `web/plugin.ts`，照 `librarySetting` 的登记处）的 `descriptor.contributions`；文案进 `zh-CN`、`en-US` 两份目录。
- **“作品”分区的页面**：`web/components/WorksSettingsPage.vue` 是手写的，不按 `section` 自动列配置项。在“作品目录”那行下面加一行“启动时打开”（nb-ui 的分段或下拉控件，照同页 `SettingsRow` 的写法），同步它的 `.md` 与 dom 测试。
- **路由**：`backend/plugin.ts` 已向 `http.routes` 贡献封面路由（`cover-routes.ts`），同处加 `GET resume`：设置为 `shelf`、没有记录、记录的 id 不在登记表里时 302 到 `/`；否则 302 到 `projectUrl(登记表当前的短名)`（`shared/project-url.ts`，改过短名也对）。查询串一律丢弃。整个处理包在 `try` 里：读设置、读记录、查登记表任何一步失败（含记录损坏、登记表 `registry-invalid`）都写诊断并 302 到 `/`，窗口里永远不会是一页 JSON 错误。只读，不打开项目、不检查项目能不能打开。
- 路径常量 `RESUME_PATH = "/api/nbook.projects/resume"` 放一个没有导入的小文件 `src/shared/resume-path.ts`，壳与命令行从那里取，不因此多依赖 `src/shared/projects.ts` 背后的运行时包。
- **拼地址**：一律 `new URL(RESUME_PATH, base).href`。`serverUrl` 与 `instance.url` 来自 `Bun.serve().url.href`，以斜杠结尾，字符串相加会成 `//api/…`，落到静态回退、静默进书架（设计审查第 1 条）；测试里写死完整的期望字符串。

### `packages/neuro-book/src/desktop`（壳的协调器）

- 规则只落在 `windows.ts` 一处（`openWindow` 与 `serverReady`），托盘、Dock、第二次启动转交都经 `openWindow`，不各写一份。
- 判据：开这个窗口时，没有别的“页面窗口或启动窗口”且不在关闭中（`closing` 的不算）。这样的窗口要 resume；已有窗口时再开的加载根地址（书架）。
- 启动期间：第一个启动窗口记“要 resume”，启动期间转交来的再开的启动窗口不记；`serverReady(url)` 时按各自的记号加载 `new URL(RESUME_PATH, url)` 或 `url`。
- 页面自己请求的新窗口（`pageWindowRequested`）不变。

### `packages/neuro-book/src/cli`

- `start.ts` 的 `openBrowser` 两处调用（新起服务、已有实例在跑）都打开 `new URL(RESUME_PATH, instance.url).href`。`--no-open` 时打印的地址不变（给人看的仍是根地址）。

### 不变量

- 302 的目标只会是同源的 `/` 或 `projectUrl(短名)`。
- 记录是用户层的插件数据，不写登记表 `projects.json`（不改它的格式）。
- 新状态根上没有记录：所有入口与现在一样落到书架，首次启动向导照旧弹出。

## Spec 与文档改动

- `docs/specs/runtime/projects.md`：输出加“最近打开”（`opened` 与记录）与“启动时打开”路由（规则同上）；术语“最近打开”从“后续范围”里拿掉；顺手把输出 18 写的 `version: 3` 改成代码里的 4（既有偏差）。
- `docs/specs/workbench/bookshelf.md`：输出 9、19 写明“回到书架”“打开”走 `/`，不经 resume；设置窗口“作品”分区加“启动时打开”。
- `docs/specs/runtime/desktop-shell.md`：输出 9 现写“加载首页、不带任何查询参数”，改为上面的开窗规则；输出 2、30 里说开窗地址的句子同步。
- `docs/specs/runtime/cli.md`：输出 9 与验收场景 1、8 的打开地址改为 resume 路由。
- 验收场景：projects.md 加一条（打开作品 A 再打开 B、关掉，经路由进 B；把 B 移出书架后经路由进书架；设置改书架后进书架；记录损坏时进书架）。

## 切片

1. **projects 插件**：远程方法、记录、设置、路由、浏览器入口调 `opened`；`projects` 的合同测试（真实服务端：打开、记录、302 的三种结果、改短名后仍对、移出书架后落书架）。提交。
2. **壳与命令行**：`windows.ts` 规则（壳的单测：没窗口时第一个带路由，已有窗口时不带，启动未就绪时就绪后带）、`start.ts`（`cli.test.ts` 的假 `xdg-open` 记下打开的地址）。提交。
3. **Spec**。提交。

每片自跑 `bun run test:affected --typecheck`。

## 验收映射

新 Spec 条目写好后回填编号；当前按行为：

- 记录与路由的结果（进作品、没记录、移出书架、设置为书架、记录损坏或登记表坏了都 302 到 `/`、改过短名）→ `projects` 合同测试（切片 1），请求真实服务端的 `resume` 路由。
- 壳开窗规则（没窗口时第一个、已有窗口、关闭中的不算、启动期间多个启动窗口只第一个）→ `windows.test.ts`，期望地址写死完整字符串。
- 命令行地址 → `cli.test.ts` 的 `openedUrls` 断言（写死完整字符串）。
- “作品”分区的新行 → `WorksSettingsPage` 的 dom 测试；e2e `bookshelf.e2e.ts` 的设置用例里查到这一行。

## 验证

- 上面的测试；e2e 只跑覆盖“作品”分区设置的那个文件，开工前在起点先跑一遍作基线。
- 发布冒烟：e2e 用模拟壳、直接打开服务端地址，碰不到真实壳的 resume 路径，所以在 `desktop/scripts/smoke-windows.ts` 里加一次重启：打开过种子作品之后退出、再启动，断言窗口最终地址是 `/?project=<短名>`。真实 WebView2 对 302 的处理靠它覆盖（macOS 的 WKWebView 只有 t23 的真机验收）。`smoke-update.ts` 用缺省状态根，同一作业里前面的冒烟会留下“上次的作品”：它已备份并还原 `settings.json`，在里面把 `startupOpen` 写成 `shelf`，让它照旧从书架开始，也不在开发机上动真实用户的记录。两份冒烟改完用 `bun run release rehearse` 演练（开发者已同意为此推 master）。
- 未验证边界：macOS Dock 重开只能在真机上看（t23 的真机验收一起做）。

## 不做与风险

- 不做：恢复多个窗口、恢复窗口里打开的文件（工作台布局本来就按项目恢复）。
- 不做：上次的作品打开失败时自动退回书架（停在“无法打开项目”页，用户点“不打开项目”）。开发者要自动退回再加。
- 风险：发布冒烟只在 Release 流水线上跑（记忆 first-launch-ui-check-release-smokes），本机验证碰不到；靠上面的逐个核对与演练兜底。
