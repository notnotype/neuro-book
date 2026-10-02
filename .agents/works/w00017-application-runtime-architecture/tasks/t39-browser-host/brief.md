# 任务说明：浏览器宿主——挂载前建立窗口运行实例（w00017 t39）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

阶段 1 的服务端部分已完成：内核按依赖图启停（t32–t36），生产与开发进程由宿主拥有（t37 `174a132e`、t38 `4705141b`）。`smoke:product-lifecycle` 现状：L1–L8、L10 通过；L9 失败，子断言 `no-half-workbench` 不成立。

浏览器端现状：
- 主页面 `app/pages/index.vue` 在 setup 中调用 `createProductBrowserRuntime()`（`app/runtime/product-browser-runtime.ts`）建立浏览器运行实例，并把页面自己的命令表（`provideWorkbenchCommands()` 创建）、外壳命令端口和 View 动作端口交给它。`nbook.workbench` 与 `nbook.files` 两个浏览器插件也定义在 `product-browser-runtime.ts` 里，外壳命令在一个启动门禁里注册。
- 这一切发生在页面挂载之后，因此服务端请求失败时页面已经渲染出工作台外壳。
- `app/runtime/browser-host.ts` 的 `BrowserRuntimeHost` 是浏览器宿主适配器（`pagehide` 时请求停止），本任务继续使用。
- Client plugin 先于路由中间件执行（见 `app/middleware/00.product-host.global.ts` 的注释）；鉴权中间件 `auth.global.ts` 把未登录用户重定向到 `/login`；登录页登录后经 `router.push` 做 SPA 导航进入主页；Component Lab（`/lab`）以 `definePageMeta({productHost: false})` 声明自己不是产品宿主，自建命令宿主。

开发者已选定本任务做最小范围：满足阶段 1 退出条件（L9 通过、`index.vue` 不再创建运行实例），不提前做阶段 2 的工作。

依据：
- `docs/specs/runtime/browser-host.md`：启动序列第 1–4 步、失败与恢复、边界与兼容、验收场景 1、2、4；
- `packages/neuro-book/docs/proposals/extensible-application-platform.md` P7 与 P9 中 `nbook.workbench` 一行；
- `scripts/smoke/product-lifecycle/browser.ts` 的 L1、L9、L10。

先读：上面三份依据；`app/runtime/`；`app/pages/index.vue` 中与 `browserRuntime`、`provideWorkbenchCommands`、`shellCommandPort`、`viewActions` 相关的部分；`app/composables/useWorkbenchCommands.ts`；`app/plugins/`、`app/middleware/`、`app/app.vue`；`server/middleware/auth.ts`；`runtime/application/` 与 `runtime/plugins/` 的公开合同（只读）。界面部分先读 `.agents/skills/ui-development/SKILL.md`、`docs/standards/code/components.md`、`packages/nb-ui/docs/ui-development-spec.md`，改动或新增组件时读同名 `.md`。

## 目标

### A. 引导接口

- 新增一个需要登录的服务端接口（路径由你定，放在 `/api/` 下，不加入 `server/middleware/auth.ts` 的公开白名单），返回：协议版本、有效插件集合（每个插件的 id、版本与清单中的浏览器部分）、集合修订号。阶段 1 只有内置浏览器插件 `nbook.workbench` 与 `nbook.files`，集合是固定的；修订号与协议版本的取值方式由你定并说明。
- 协议版本常量与响应类型放在应用与服务端共用的位置（例如 `shared/`），不跨包深导入。
- 不返回服务端路径、数据库对象与凭据。

### B. 宿主 client plugin 与失败页

- 一个 Nuxt client plugin 在根组件挂载前调用引导接口，成功后用 `BrowserRuntimeHost` 建立本窗口的运行实例：只登记集合中出现的内置浏览器插件，激活启动必需的 `nbook.workbench`，然后才挂载界面。每个窗口一个实例，互相隔离，关闭窗口时尽力停止（沿用 `BrowserRuntimeHost` 的 `pagehide` 处理）。
- 引导失败（网络错误、5xx）：显示带重试的连接失败页，不渲染工作台的任何部分；重试成功后继续启动序列，不需要刷新页面。协议版本不兼容：提示刷新或更新。`nbook.workbench` 在本窗口激活失败：显示启动失败页并附原因，不挂载工作台。
- 未登录（引导接口返回 401）不算连接失败：照旧交给现有鉴权跳转到 `/login`，不显示失败页。
- 哪些路由需要窗口运行实例由你决定并说明理由。约束：`/login` 与 Component Lab 的行为不变；登录后经 SPA 导航进入主页，主页也必须先有窗口运行实例才挂载工作台（可以参考 `00.product-host.global.ts` 改为整页加载的做法，也可以有更自然的做法），这条路径由 L1 覆盖。
- 失败页是界面改动：用现有 nb-ui 组件与主题变量，文案走 i18n（中英文），不硬编码颜色。

### C. `nbook.workbench` 与 `nbook.files` 的浏览器部分

- 两个插件的浏览器部分移出 `product-browser-runtime.ts`，放到各自功能目录（例如 `app/features/workbench/`、`app/features/files/`），由宿主 client plugin 登记。插件激活不能依赖页面状态。
- 命令表（`createCommandRegistry()` 的实例）归 `nbook.workbench` 的激活作用域，在页面挂载前就存在；Files 的命令贡献在激活时登记到这张表上。主页面的命令宿主（上下文键、命令面板、活动编辑器等页面状态）改为使用这张表，不另建第二份。Component Lab 的命令宿主不受影响。
- 主页面仍是外壳的渲染者：挂载后把外壳命令端口、View 动作端口等接到 `nbook.workbench` 提供的服务上，卸载时释放；外壳命令在接入时注册、释放时注销。端口接入前调用依赖端口的命令，要得到明确的“未就绪”结果，不抛未处理异常。
- Files View 与刷新命令的现有行为不变（`registry`、`resolveViewFactory`、`subscribeFiles` 的对外效果保持）。

### D. 删除旧路径

- 删除 `index.vue` 中的 `createProductBrowserRuntime()` 调用与对应的 `destroy()`；页面从宿主取得本窗口的运行实例。
- `product-browser-runtime.ts` 中页面内创建运行实例的接线删除，不保留两套；其中仍有用的部分（例如 Files 订阅）迁到合适的位置或保留为不负责创建的模块，逐项说明。

### E. 更新 L9 的拦截规则

`scripts/smoke/product-lifecycle/browser.ts` 的 L9 目前拦截 `GET /api/projects` 作为引导接口的替身，并在 `[data-project-picker-view] [role=alert]` 里找失败提示（代码注释写明接入浏览器宿主后要替换）。改为：
- 拦截 A 节新增的引导接口（只拦截该路径与方法，返回 500）；
- 失败提示改为在 B 节的连接失败页中查找（给失败页一个稳定的 `data-*` 标记）；
- 三个子断言的 id 与通过条件不变：`no-half-workbench`（失败后页面中不存在 `[data-role=files-explorer-view], [data-workbench-shell], [data-role=workbench-shell], .workbench-shell`）；`failure-surface-with-retry`（拦截命中次数大于 0，失败提示存在、文本匹配现有的连接失败正则，且有“重试”按钮）；`retry-recovery`（解除拦截并点击真实的重试按钮后，出现 Project Picker 的项目卡片或工作台）。

L9 之外的检查与 smoke 其它文件不改。

## 不做

- 事件流、插件集合变化、离线重连（Spec 场景 5–7）；懒激活（场景 3）；
- `menus`、`keybindings` 贡献点；把外壳布局搬进 workbench 插件交出的根组件；
- 第三方浏览器插件的装载、宿主模块表；
- 服务端插件、内核（`runtime/**`）的改动。

## 验收场景（写成合同测试，每个场景一个用例，用例名写清场景）

1. 挂载前建立实例：引导成功时，根组件挂载前窗口运行实例已建立、`nbook.workbench` 已激活（照抄 Spec 场景 1 的前半句；布局恢复沿用现有实现）。
2. 引导失败：显示带重试的连接失败页，没有工作台；重试成功后继续启动并挂载工作台（Spec 场景 2）。
3. 未登录：引导返回 401 时不显示连接失败页，交给鉴权跳转。
4. 协议版本不兼容：提示刷新或更新，不挂载工作台。
5. `nbook.workbench` 激活失败：显示启动失败页并附原因，不挂载工作台。
6. 多窗口隔离：两个窗口各有自己的运行实例，一个关闭不影响另一个，不向服务端发全局停止（Spec 场景 4 的前半句）。
7. 端口接入：页面挂载后外壳命令可执行；页面卸载后外壳命令被注销；接入前调用得到“未就绪”结果。
8. 引导接口：未登录返回 401；登录后返回协议版本、`nbook.workbench` 与 `nbook.files` 两个插件与修订号，不含服务端路径。

已有测试保持通过。删除或改写的测试，在汇报中逐个列出它覆盖的行为现在由哪条测试承担。

## 允许改动的文件

- 新增或修改 `packages/neuro-book/app/plugins/**`、`app/runtime/**`、`app/features/workbench/**`、`app/features/files/**`、`app/middleware/**` 及测试
- `packages/neuro-book/app/app.vue`（只为渲染失败页）、`app/pages/index.vue`（只为 D 节与端口接入）、`app/composables/useWorkbenchCommands.ts`（只为改用 workbench 的命令表）
- 新增失败页组件与同名 `.md`（放在合适的组件目录）；i18n 语言文件中新增的文案键
- 新增引导接口路由及测试（`packages/neuro-book/server/api/**` 下）；`packages/neuro-book/shared/**` 中新增的协议常量与类型
- `packages/neuro-book/scripts/smoke/product-lifecycle/browser.ts`（只改 E 节所述的 L9 拦截与失败页定位）
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t39-browser-host/evidences/`

不改：`packages/neuro-book/runtime/**`（内核）、`server/` 下除新增引导接口以外的文件、`app/component-lab/**`、`docs/**`、任何 `README.md` 与 Work/Task 文档、`package.json`、锁文件、`tsconfig*.json`、`vitest*.config.ts`、`nuxt.config.ts`。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。

## 验证命令与完成标准

命令从 worktree 根目录执行，包内命令用 `bun run --cwd packages/neuro-book <脚本>`：

1. 新增与改动的测试，以及 `test -- app/runtime app/features app/plugins app/middleware app/composables app/components/workbench server/api shared scripts/smoke/product-lifecycle`：全部通过。
2. `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck`：0 错误。
3. `smoke:runtime-foundation -- --host browser --browser-executable /usr/bin/google-chrome-stable`：通过。
4. `smoke:product-lifecycle -- --only L1,L9,L10 --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/lifecycle-report.json`（含生产构建）：三项通过，报告里没有 `pending` 项，不能只看退出码。
5. 开发模式：用临时 State Root 启动开发服务，用 Chromium 登录并打开主页，工作台与资源管理器正常显示；截图存证后停止开发服务，确认没有残留进程。
6. 全量 `bun run test` 与生产 L1–L10 由主 Agent 跑，你不用跑。
7. 把第 1–5 步的完整输出保存到证据目录。

本机内存有限：构建、smoke、开发服务与类型检查不要并行跑，一次只跑一个重任务；开发服务用完立即停止。构建期间不要改动 worktree 中的文件。开发者自己可能开着 `nuxt dev`：用空闲端口，只结束你自己启动的进程，按 pid 结束。等进程退出用 `wait <PID>` 或检查输出里的结束标记，不用 `pgrep -f` 循环。

本次运行有 3 小时上限，到点会被直接截停。**先写 `delivery.md`**（按下面“最终汇报”的结构写设计与改动），验证跑完后再补结果。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项（例如 `package.json` 里的其它 scripts）和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”；
- 不用 `rm -rf` 清理仓库内的目录；误写的文件逐个删除，删除前用 `git ls-files` 确认它们没有被跟踪。写证据的命令从仓库根执行，用仓库根相对路径。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。子代理给出的事实性结论要你自己实测确认后才能写进代码注释或汇报。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码；测试不匹配源码字符串。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。不要触碰 `packages/neuro-book/docs/research/README.md`（开发者自己的改动）。

## 最终汇报

写入证据目录的 `delivery.md`，再输出同样内容：

1. 结论：完成标准 1–5 各自的结果（附证据文件名），以及 L1、L9、L10 各子断言的结果；
2. 设计：引导接口、宿主 client plugin、失败页、窗口运行实例、`nbook.workbench` 命令表与端口接入各自放在哪里、如何协作；哪些路由建立窗口运行实例及理由；登录后进入主页的路径怎么处理；
3. 公开行为的变化（主 Agent 据此更新 Spec）：新增接口、协议版本、失败页、删除的模块；
4. 删除与改写的测试，以及它们覆盖的行为现由哪条测试承担；
5. 改动的文件列表；
6. 禁止清单逐条自查结果；
7. 遗留问题（不超过 5 条）。
