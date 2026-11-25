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

- **记最近打开**：`shared/contracts.ts` 的远程合同加 `opened({id})`；浏览器入口在窗口绑定了项目（引导给了 `project`）时调一次，失败只写诊断。服务端把 `{id, at}` 存进插件的用户层记录（同 `projects.stats` 的存法，`shared/stats-record.ts`），新记录名 `projects.last-opened`。多个窗口时后打开的覆盖先打开的。
- **设置**：`shared/contracts.ts` 加 `startupOpen`：`"last-work" | "shelf"`，缺省 `"last-work"`，用户层，放设置窗口“作品”分区（`nbook.works`，同 `librarySetting`），标题“启动时打开”，选项“上次的作品”“书架”。
- **路由**：`backend/plugin.ts` 已向 `http.routes` 贡献封面路由（`cover-routes.ts`），同处加 `resume`：设置为 `shelf`、没有记录、记录的 id 不在登记表里（`projectsKey.resolve` 失败）时 302 到 `/`；否则 302 到 `/?project=<短名>`（短名取登记表当前的，改过短名也对）。只读，不打开项目、不检查项目能不能打开。查询串里别的参数原样带过去（留给以后，例如桌面壳带的标记），没有就不带。
- 路径常量 `RESUME_PATH = "/api/nbook.projects/resume"` 放 `src/shared/projects.ts`（宿主与插件共用的那份），桌面壳与命令行从那里取。

### `packages/neuro-book/src/desktop`（壳的协调器）

- `windows.ts` 的 `openWindow`：要开的窗口是“此刻没有任何页面窗口”时的第一个（启动、托盘或 Dock 在没窗口时开窗、第二次启动转交时恰好没有窗口），加载 `serverUrl + RESUME_PATH`；已有窗口时再开的照旧加载根地址（书架）。启动时还没就绪的窗口在 `serverReady(url)` 时按同一规则算。页面自己请求的新窗口（`pageWindowRequested`）不变。

### `packages/neuro-book/src/cli`

- `start.ts` 的 `openBrowser` 两处调用（新起服务、已有实例在跑）都打开 `instance.url + RESUME_PATH`。`--no-open` 时打印的地址不变（给人看的仍是根地址）。

### 不变量

- 302 的目标只会是同源的 `/` 或 `/?project=`；短名经 `encodeURIComponent`。
- 记录是用户层的插件数据，不写登记表 `projects.json`（不改它的格式）。
- 新状态根上没有记录：所有入口与现在一样落到书架，首次启动向导照旧弹出。

## Spec 与文档改动

- `docs/specs/runtime/projects.md`：输出加“最近打开”（`opened` 与记录）与“启动时打开”路由（规则同上）；术语“最近打开”从“后续范围”里拿掉。
- `docs/specs/workbench/bookshelf.md`：设置窗口“作品”分区加“启动时打开”。
- `docs/specs/runtime/desktop-shell.md`：开窗一节写明“没有窗口时开的第一个经 resume 路由”。
- `docs/specs/runtime/cli.md`：打开浏览器的地址改为 resume 路由。
- 验收场景：projects.md 加一条（打开作品 A 再打开 B、关掉，经路由进 B；把 B 移出书架后经路由进书架；设置改书架后进书架）。

## 切片

1. **projects 插件**：远程方法、记录、设置、路由、浏览器入口调 `opened`；`projects` 的合同测试（真实服务端：打开、记录、302 的三种结果、改短名后仍对、移出书架后落书架）。提交。
2. **壳与命令行**：`windows.ts` 规则（壳的单测：没窗口时第一个带路由，已有窗口时不带，启动未就绪时就绪后带）、`start.ts`（`cli.test.ts` 的假 `xdg-open` 记下打开的地址）。提交。
3. **Spec**。提交。

每片自跑 `bun run test:affected --typecheck`。

## 验收映射

新 Spec 条目写好后回填编号；当前按行为：

- 记录与路由三种结果 → `projects` 合同测试（切片 1）。
- 壳开窗规则 → 协调器单测。
- 命令行地址 → `cli.test.ts`。
- 设置项出现在“作品”分区 → 设置窗口已有的分区渲染测试补一条，或 e2e `settings` 里查到该项（实施时看哪一个已覆盖“作品”分区）。

## 验证

- 上面的测试；e2e 只跑覆盖“作品”分区设置的那个文件，开工前在起点先跑一遍作基线。
- 发布冒烟：`desktop/scripts/smoke-windows.ts` 用新状态根、手动 `goto /?project=`，`smoke-update.ts` 备份并恢复缺省状态根的 `projects.json`、`settings.json`，但不备份插件记录：升级后重启会经路由进上次的作品而不是书架。实施时逐个核对两份冒烟重启后的判据，按“向导在不在、页面是不是书架”改成不依赖起点页，再用 `bun run release rehearse` 演练（只在开发者同意推送时）。
- 未验证边界：macOS Dock 重开只能在真机上看（t23 的真机验收一起做）。

## 不做与风险

- 不做：恢复多个窗口、恢复窗口里打开的文件（工作台布局本来就按项目恢复）。
- 不做：上次的作品打开失败时自动退回书架（停在“无法打开项目”页，用户点“不打开项目”）。开发者要自动退回再加。
- 风险：发布冒烟只在 Release 流水线上跑（记忆 first-launch-ui-check-release-smokes），本机验证碰不到；靠上面的逐个核对与演练兜底。
