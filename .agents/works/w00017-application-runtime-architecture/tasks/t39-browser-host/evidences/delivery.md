# t39 浏览器宿主交付

## 1. 结论
浏览器宿主最小范围已实现，完成标准 2–5 通过；标准 1 尚未达成，指定测试范围存在一个现有菜单用例失败。验证覆盖未提交工作区，无独立 revision；checkout 为 `.worktree/w00017-runtime-foundation`，分支名沿用 Work 快照 `refactor/w00017-runtime-foundation`，当前 HEAD 未另行核实。唯一证据目录为本目录。
1. 新增、改写合同：2 文件、10 用例通过，exit=0（[host-contract-tests-final.log](host-contract-tests-final.log)）；指定范围：102 文件、613 通过、1 失败，exit=1（[scoped-tests-final.log](scoped-tests-final.log)）。失败为 `WorkbenchPartHost / 容器移动菜单：列出生效落位之外的落点，选中后回传 move-container`，`expected undefined to be truthy`；本任务未改其生产实现，临时测试修改已撤回。`scoped-tests-after.log` 的 614 全通过依赖已撤回修改，不作为最终验收证据。
2. `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` 均 exit=0、0 错误；证据：[runtime-typecheck.log](runtime-typecheck.log)、[scripts-typecheck-delivery.log](scripts-typecheck-delivery.log)、[app-typecheck-delivery.log](app-typecheck-delivery.log)。
3. `smoke:runtime-foundation -- --host browser --browser-executable /usr/bin/google-chrome-stable`：exit=0、failures=0；证据：[runtime-browser-smoke.log](runtime-browser-smoke.log)。
4. `smoke:product-lifecycle -- --only L1,L9,L10 --browser-executable /usr/bin/google-chrome-stable --report <本目录>/lifecycle-report-final.json`：含生产构建、exit=0、三项通过、无 pending；证据：[lifecycle-production-final.log](lifecycle-production-final.log)、[lifecycle-report-final.json](lifecycle-report-final.json)、[product-lifecycle-build.log](product-lifecycle-build.log)。
最终 JSON 同步到指定的 [lifecycle-report.json](lifecycle-report.json)；`lifecycle-report-final.json` 保留为最终命令的原始输出。
5. 临时 State Root 下经公开 `dev` 入口与内置 Chromium 完成真实表单登录、主页与 Files 目录读取；`index.md`、`host-check.md` 可见。证据：`development-public-server.log`、`development-login.json`、`development-workbench.{json,png}`、`development-failure-desktop.{json,png}`、`development-failure-390.{json,png}`、`development-retry.json`、`development-page-ports.json`。颜色实测等于 `--bg-main`、`--text-main`、`--text-secondary`、`--status-danger`；390px 无横向溢出、文字重叠。`development-cleanup.json` 记录自有进程树全部退出、端口关闭、临时根删除；没有保留开发服务。

| 检查 | 子断言 | 结果与实证 |
| --- | --- | --- |
| L1 | `L1-login`、`L1-create-project`、`L1-seed-files`、`L1-workbench-files` | 全 pass；真实登录、API 创建 Project、两文件入临时目录并从 Files 树读回 |
| L9 | `no-half-workbench` | pass；500 后所有约定工作台/Files 标记不存在 |
| L9 | `failure-surface-with-retry` | pass；GET 引导拦截命中 1 次，连接失败 alert 与真实重试存在 |
| L9 | `retry-recovery` | pass；解除拦截后真实重试恢复工作台；原断言 id、判据与刷新兜底均保留 |
| L10 | `L10-window-isolation` | pass；关闭 A 后 B 可重载、读文件，ready HTTP 仍可用 |

## 2. 设计
- 引导协议在 `shared/browser-bootstrap.ts`，接口在 `server/api/runtime/browser-bootstrap.get.ts`：GET `/api/runtime/browser-bootstrap`，协议 `1`、集合修订号 `builtin-browser-v1`、两插件版本 `1.0.0`；不兼容协议变更提升协议版本，成员/版本/清单变化提升修订号。沿现有鉴权中间件，不新增白名单，不返回路径、数据库对象或凭据。
- `app/plugins/browser-host.client.ts` 在根组件挂载前等待引导与激活；`app/runtime/browser-window.ts` 只登记服务端列出的本构建内置插件，使用现有 `BrowserRuntimeHost`，workbench 必需，Files 存在时完成其激活再开放界面。每窗口独立 UUID/实例，pagehide 只停止本窗口，不向共享服务端发送停止。
- `app/app.vue` 按窗口状态决定是否渲染 NuxtPage；`BrowserHostFailurePage.vue` 使用 nb-ui Button/Spinner、主题变量和宿主传入的中英文 i18n。网络/5xx 显示真实重试；协议不兼容提示刷新/更新；激活失败显示原因；401 交现有鉴权，不显示连接失败。
- `app/features/workbench/browser-plugin.ts` 在激活作用域建立唯一命令表、贡献接收者与服务 `nbook.workbench/browser`。`provideWorkbenchCommands()` 使用该表并绑定/释放页面上下文；`index.vue` 挂载后接入 shell/View 端口，卸载注销外壳命令和端口而不销毁窗口实例。Files 刷新命令在激活时登记，端口不存在时返回 `{ok:false, code:"unavailable", reason:"工作台页面端口未就绪"}`。
- `app/features/files/browser-plugin.ts` 拥有 Files View/刷新贡献及 HTTP/SSE 订阅服务 `nbook.files/browser`，停止信号与调用方取消组合；`product-browser-runtime.ts` 仅保留 `registry`、`resolveViewFactory`、`subscribeFiles` 与实例服务查询门面，不负责创建。
- 现有产品宿主路由均建立窗口实例，排除 `/login` 和 `productHost:false` 的 Component Lab；管理路由可复用同一窗口，Lab 保留独立命令宿主。登录文档的 idle 宿主进入产品时整页加载；401 文档从登录页离开且仍 unauthorized 时同样整页加载，首次 401 导航不刷新循环。真实管理页往返已验证同一实例/命令表保留、页面端口释放并重新接入。

## 3. 公开行为变化
新增受鉴权引导接口及上述版本合同；产品首次挂载前要求窗口引导和 workbench 激活完成，失败替换整页而不是显示半工作台，连接重试不刷新文档。登录后进入产品先完整启动窗口实例。
删除 `createProductBrowserRuntime()` 和页面 `destroy()` 旧路径；两个内置浏览器插件从原 runtime 模块迁入功能目录，未删除 `product-browser-runtime.ts` 文件。Files 的注册表、工厂、订阅效果与 Lab 独立性保留；不实现阶段 2 事件流、集合变化、懒激活、menus/keybindings 或第三方装载。Spec/README 按任务限制未改，由主 Agent 更新。

## 4. 测试迁移
- 原 `two windows publish independent Files View and refresh; pagehide revokes only its own commands` 改由“场景 6：两个窗口各有独立实例，一个 pagehide 不影响另一个且不向服务端发全局停止”承担：独立实例/命令表、Files 描述/工厂/刷新执行、关闭后撤回和另一窗口继续调用；“场景 7”另覆盖页面接入执行、卸载注销与未就绪结果。
- 原 `stops the exact Files stream on pagehide without stopping another window` 改由“Files 订阅在 pagehide 取消精确窗口的流，不取消另一个窗口”承担：精确 projectRoot/publicId、A 流取消、B 流不取消且仍 available。
- 验收场景 1–7 各一个用例位于既有 `product-browser-runtime.test.ts`，场景 8 一个用例位于新接口并列测试；另保留上述订阅用例并增加“只登记引导集合出现的插件，不自行补回 Files”。现有配置仅收集指定 runtime 测试，未改测试配置。菜单测试最终未改、未跳过，失败单独保留。

## 5. 改动文件
下列路径均相对当前 worktree；除最后一项外共同前缀为 `packages/neuro-book/`，共 20 个源码/测试/组件文档文件。
- `shared/browser-bootstrap.ts`；`server/api/runtime/browser-bootstrap.get.ts`、`server/api/runtime/browser-bootstrap.get.test.ts`
- `app/plugins/browser-host.client.ts`；`app/runtime/browser-window.ts`、`app/runtime/browser-window-nuxt.d.ts`、`app/runtime/product-browser-runtime.ts`、`app/runtime/product-browser-runtime.test.ts`
- `app/features/workbench/browser-plugin.ts`、`app/features/files/browser-plugin.ts`
- `app/app.vue`、`app/pages/index.vue`、`app/composables/useWorkbenchCommands.ts`；`app/middleware/00.product-host.global.ts`、`app/middleware/auth.global.ts`
- `app/components/workbench/BrowserHostFailurePage.vue`、`app/components/workbench/BrowserHostFailurePage.md`；`app/i18n/locales/zh-CN.ts`、`app/i18n/locales/en-US.ts`
- `scripts/smoke/product-lifecycle/browser.ts`：仅 L9 引导拦截、失败页定位与相关过时注释；L1/L10 及其它 smoke 文件未改。
- `.agents/works/w00017-application-runtime-architecture/tasks/t39-browser-host/evidences/`：本报告、完整命令输出、JSON 和截图。用户已有 `packages/neuro-book/docs/research/README.md` 改动未触碰；Task/Work README 与 brief 未改。

## 6. 禁止清单自查
- 错误分类与诊断：401 按 statusCode；异常输出诊断，启动失败展示原因；未新增按错误文案分支或静默 catch。既有鉴权 catch 语义未改。
- 不掩盖检查失败：没有新增 skip、放宽断言、替换失败类别或产品测试分支；恢复 L9 原判据，菜单失败原样报告；旧全绿证据明确无效。
- 不改范围外代码配置注释：菜单测试曾被误改，现已逐行撤回；最终无该文件改动。内核 `runtime/**`、其它 server 文件、Lab、docs、README、package/config/lockfile 未改。
- 清理与唯一接线：启动失败 destroy、窗口 pagehide 停止、Files AbortSignal、页面端口/命令上下文/订阅收口保留；没有页面第二创建路径或兼容 shim。
- 跨包边界：只用包名公开入口；应用内复用 nbook 别名，没有跨包深导入源码。
- 可验证性：使用既有宿主/鉴权/Files/命令模式；自测真实开发和生产页面。指定浏览器路径的内置工具 CDP 附加失败已报工具问题，改用同一内置能力的默认 Chromium，未接入用户浏览器。
- 临时数据与证据：State Root/缓存在系统 Temp，开发与 smoke 已收口；没有 `rm -rf` 仓库目录。命令均从 worktree 根执行，日志写本证据目录；CLI 传入的 report 使用其支持的绝对路径定位同一目录。
- 其它限制：未 commit/push/stash/切分支/改 Git 配置；未改 http_proxy、时区/locale；未调用真实 Provider/Model；设计和主要编码未委派；重任务串行，构建期间未编辑源码。注释用中文、不匹配源码字符串测试；先写本报告后实现，组件同名文档先于组件落盘。

## 7. 遗留问题
1. 菜单测试失败属于已知分支基线，已由主 Agent 核实为既有问题（10 个失败文件之一），留阶段 1 集成复核。
2. L10 收口 exit 1、`SIGTERM` 与 `STORAGE_CONTEXT_INVALID` 403 均在 t35/t37/t38 已有，已由主 Agent 核实为既有问题，留阶段 1 集成复核。
3. 本轮全量 `bun run test` 与生产 L1–L10 未运行，按 brief 留给主 Agent；运行期集合变化、事件流、懒激活不属于本任务。
4. 最初开发探测缺鉴权配置、stdin 尾换行进入临时账号密码、首次 Vite 预构建加载中断均已纠正；保留初次日志，最终证据只认 public dev 记录。Nuxt 注入类型通过独立 `browser-window-nuxt.d.ts` 修复；相关声明文件与实现文件同名时 typecheck 未加载声明。范围和基线规则已有规范覆盖，本次不提出新增全局规则回写。

## 返工 1

### 返工内容

1. 恢复 `workbench.view` 与 `workbench.command` 的 `validate`。本轮选择原有的产品目录白名单策略：只接受 `SHELL_FILES_VIEW` 与 `SHELL_FILES_REFRESH_COMMAND` 的 canonical 声明；运行时内核继续负责重复贡献拒绝。新增合同用例提交两个不合格声明，断言目录中的 `validation` 为 `rejected`、包含原因，`delivery` 保持 `waiting-receiver`，且没有 `implementation`，因此不进入交付。
2. 新增内置浏览器插件定义与 `BUILTIN_BROWSER_PLUGINS` 的逐插件、逐字段合同测试，覆盖 browser 入口、activationEvents、provides、dependencies、contributionPoints、receives、contributions；同时补齐 workbench 入口的 `onStartup` 声明，防止清单漂移。
3. 恢复 `useWorkbenchCommands.ts` 头部注释，删除 `auth.global.ts` 分支后的多余空行。

### 返工验证

- `rework-1-tests.txt`：指定范围 39 个测试文件、276 个测试通过，exit 0。
- `rework-1-smoke.txt`：一次性浏览器宿主冒烟实际启动到 `ready`，两个不合格声明均为 `invalid-declaration` 且交付状态为 `waiting-receiver`，exit 0。
- `rework-1-typecheck-runtime-foundation.txt`：`typecheck:runtime-foundation` exit 0。
- `rework-1-typecheck-app.txt`：`typecheck` exit 0。
- 未运行生产 L1–L10 与全量测试，按本次返工范围保留给主 Agent。

### 返工自查

- 错误按状态、合同和内核校验结果分类；没有按错误文案分支，也没有静默吞错。
- 没有跳过测试、放宽断言、替换失败类别或加入测试专用产品分支；首轮测试暴露新增测试遗漏既有 `SHELL_PANEL_DEFAULTS` 导入，已补回，focused 3 项与随后全范围测试均通过。
- 没有改动 `runtime/**`、范围外 server、Lab、docs、README、package/config/lockfile，也未触碰用户已有 `docs/research/README.md`。
- 保留窗口、页面端口、贡献接收与失败收口路径；没有增加第二条运行实例路径、跨包深导入、兼容 shim 或未实现占位。
- 没有 commit、push、stash、切分支或修改 Git 配置；证据命令均从 worktree 根执行。无需新增全局规则回写。
