---
schema: nbook.task/v2
taskId: t39-browser-host
---

# 浏览器宿主：挂载前建立窗口运行实例

## 目标与范围

阶段 1 的浏览器宿主切片，也是阶段 1 最后一个功能切片。主页面不再自行创建浏览器运行实例：

- 新增需要登录的引导接口，返回协议版本、有效的内置浏览器插件集合与集合修订号。
- 一个 Nuxt client plugin 在根组件挂载前调用引导接口：失败时显示带重试的连接失败页，不渲染工作台；协议不兼容时提示刷新；成功后建立本窗口的运行实例并激活 `nbook.workbench`。
- `nbook.workbench`、`nbook.files` 的浏览器部分移出主页面；命令表归 `nbook.workbench`。主页面仍是外壳的渲染者，挂载后把自己的布局与命令端口接到 workbench 上，卸载时释放。
- 删除 `index.vue` 中的运行实例创建与 `product-browser-runtime.ts` 的页面内接线。

行为依据：[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 的启动序列第 1–4 步、失败与恢复、验收场景 1、2、4；[可扩展应用平台设计](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md) P7、P9（`nbook.workbench` 一行）。

完成标准：`smoke:product-lifecycle` 的 L9 通过，L1、L10 不回退。L9 原先拦截 `GET /api/projects` 作为引导接口的替身（smoke 代码注释写明接入浏览器宿主后要替换），本任务改为拦截真实的引导接口，判定内容不变。

不做（2026-10-02 开发者选定最小范围）：事件流与插件集合变化（场景 5–7）、懒激活（场景 3）、`menus`/`keybindings` 贡献点、把外壳布局搬进 workbench 插件交出的根组件。

编码由 omp 完成（`@default`），任务说明见 [brief.md](brief.md)，审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-02 验收通过。`smoke:product-lifecycle` 的 L1–L10 全部通过，阶段 1 的 smoke 标准达成。

**行为变化**（已写入 [`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 证据的实现进展；设计细节见 [delivery.md](evidences/delivery.md) 第 2 节）：

- 引导接口 `GET /api/runtime/browser-bootstrap`（需要登录，不加入公开白名单）返回协议版本 1、集合修订号 `builtin-browser-v1` 与 `nbook.workbench`、`nbook.files` 的浏览器清单；协议常量、清单与响应校验在 `shared/browser-bootstrap.ts`，浏览器插件定义与共享清单由合同测试逐字段核对。
- 宿主 client plugin `app/plugins/browser-host.client.ts` 经 `app/runtime/browser-window.ts` 在根组件挂载前完成引导、按集合登记内置浏览器插件并激活 `nbook.workbench`；除 `/login` 与 Component Lab 外的产品路由都建立窗口运行实例。`app/app.vue` 只在窗口就绪时渲染页面，否则显示 `BrowserHostFailurePage`：连接失败可原地重试，协议不兼容与 workbench 激活失败提示刷新并附原因，401 交给鉴权跳转。从登录页进入产品路由时整页加载，保证主页挂载前已完成引导。
- `nbook.workbench` 的浏览器部分（`app/features/workbench/browser-plugin.ts`）在激活作用域持有命令表、View 与命令两个贡献点（保留与产品目录一致的逐条校验）和 `nbook.workbench/browser` 服务；主页面的命令宿主改用这张表，挂载后接入外壳与 View 动作端口、卸载时注销。`nbook.files` 的浏览器部分在 `app/features/files/browser-plugin.ts`。`product-browser-runtime.ts` 只剩不负责创建的服务门面。

**审查中处理的问题**（[review-1](reviews/review-1.md)）：

- 迁移时删掉了贡献点的逐条校验，不合格的声明会在交付时才失败；已恢复，并补了“不合格声明被拒绝并带原因”的用例。
- 共享清单与插件定义各写一份，补了逐字段一致性测试；它当即发现 workbench 入口少写了 `activationEvents`，已补齐。
- 恢复 `useWorkbenchCommands.ts` 文件头一句仍然成立的注释，删除一处多余空行。
- omp 汇报的两条遗留问题经主会话核实都是既有问题：`WorkbenchPartHost` 用例属全量测试基线；L10 收尾时 `Product completion` 退出码 1 与 `STORAGE_CONTEXT_INVALID` 403 在 t35 以来的日志中均已出现。
- 返工中 omp 的一次 JS 执行在测试跑完、证据写出后没有返回，空等 41 分钟；主会话结束了 omp 自己起的执行子进程（SIGTERM 无效，改用 SIGKILL），omp 收到失败结果后继续完成返工。

**主会话修改**：全量测试发现新组件 `BrowserHostFailurePage` 没有 Component Lab 场景（`app/component-lab/fixtures/index.test.ts` 失败）。起因是任务说明把 `app/component-lab/**` 列为禁止修改。主会话新增 `BrowserHostFailurePageFixture.vue`，在 `fixtures/index.ts` 登记 starting、connection-failed、incompatible、startup-failed（长原因）四个场景。

**验证**（主会话运行，返工后）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `test:runtime-foundation`；`app/runtime`、`app/features`、`app/plugins`、`app/middleware`、`app/composables`、`app/components/workbench`、`server/api/runtime`、`server/host`、`server/runtime`、`server/features`、`server/middleware`、`server/routes`、`shared`、`scripts/smoke/product-lifecycle` | 20 个文件 231 条；71 个文件 538 条通过，1 条失败为基线 `WorkbenchPartHost` | [acceptance-test-targeted.txt](evidences/acceptance-test-targeted.txt) |
| `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:runtime-foundation` 三种模式 | 全部通过 | [acceptance-smoke-runtime-foundation.txt](evidences/acceptance-smoke-runtime-foundation.txt) |
| `smoke:product-lifecycle`（L1–L10，含生产构建） | 全部通过 | [acceptance-smoke-product-lifecycle.txt](evidences/acceptance-smoke-product-lifecycle.txt)、[报告](evidences/acceptance-lifecycle-report.json) |
| `bun run test` | 11 个文件 24 条失败、22 个 errors：基线 10 个文件之外多出 `fixtures/index.test.ts`（缺 Lab 场景） | [acceptance-test-full.txt](evidences/acceptance-test-full.txt) |
| 补 Lab 场景后 `test -- app/component-lab` 与 `typecheck` | 只剩基线 `WorkbenchShellLayoutFixture` 的 9 条失败；类型检查 0 错误 | [acceptance-lab-fix.txt](evidences/acceptance-lab-fix.txt) |
| 失败页界面（omp 运行） | 开发模式 Chromium 实测：桌面与 390px 均无工作台、无横向溢出，颜色取主题变量 | `development-failure-desktop.png`、`development-failure-390.png` |

omp 的输出与汇报：`evidences/` 下的其余文件，含 [delivery.md](evidences/delivery.md)。

**后续问题**（阶段 1 集成复核）：smoke 收尾时以进程组 SIGTERM 结束产品，产品命令包装进程以退出码 1 报告“被信号中断”；L1、L10 浏览器日志中的 `STORAGE_CONTEXT_INVALID` 403。

## 下一步

阶段 1 集成复核：逐条对照阶段 1 的退出条件与相关 Spec，处理 t34–t39 记下的后续问题（smoke 在构建失败时以 0 退出、归档临时目录泄漏、`server/plugins/` 下其余 Nitro 插件、`nbook.sqlite` 与 `nbook.platform-files` 进入产品清单等）。
