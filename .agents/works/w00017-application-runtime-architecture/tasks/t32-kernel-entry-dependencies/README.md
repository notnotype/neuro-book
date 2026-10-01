---
schema: nbook.task/v2
taskId: t32-kernel-entry-dependencies
---

# 内核的入口与服务级依赖

## 目标与范围

阶段 1 的第一个实现切片，只改内核（`runtime/plugins`、`runtime/application`）：服务 id 归插件所有（`<插件 id>/<名称>`），现有内置插件随之改名；按入口推导受阻（`missing-service`、`location-mismatch`、`provider-blocked`、`provider-failed`、`dependency-cycle`）；插件汇总状态；启动时并发激活启动必需插件与 `onStartup` 入口，依赖先于依赖者；关闭严格按依赖逆序；输出激活与关闭诊断，供 [t31](../t31-product-lifecycle-smoke/README.md) 的 L2 与 L3、L4 关闭顺序子断言在后续切片读取。行为依据为 [`runtime.plugin-manifest`](../../../../../docs/specs/runtime/plugin-manifest.md) 的第 2–9 条（该 Spec 保持 `planned`，清单文件格式与第三方规则在阶段 3）。

不做：清单文件读取、`pluginVersions`、插件通道、贡献点由拥有者插件定义与按单条贡献校验（下一个 Task）、运行期热插拔、产品内置服务迁移。

编码由 omp 完成（`@default` 回退链，实际运行在 `aihub/gpt-6.1-sol`），任务说明见 [brief.md](brief.md)，审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-01 验收通过。

**行为变化**（已写入 [`runtime.plugins`](../../../../../docs/specs/runtime/plugins.md) 输出第 11–14 条、场景 12–15 与实现合同，以及 [`runtime.application`](../../../../../docs/specs/runtime/application.md)）：

- 服务 id 必须以本插件 id 加 `/` 开头、名称非空、不为 `channel`、在插件内不重复，否则整个插件不登记（`foreign-service-id`、`reserved-service-name`、`duplicate-service`）。内置插件改名为 `nbook.diagnostics`、`nbook.sqlite`、`nbook.platform-files`、`nbook.files`（服务端入口 `server`），服务键相应为 `nbook.diagnostics/diagnostics`、`nbook.sqlite/sqlite`、`nbook.platform-files/files`、`nbook.files/workspace`。
- 受阻由纯函数 `runtime/plugins/blocked.ts` 按需推导；`EntryStatus` 新增 `blocked`，`activate()` 对受阻入口返回 `rejected`/`blocked`，不消耗代次；目录按插件 id 码元顺序排序并给出 `summary`。
- `ApplicationManifest.requiredPlugins` 与入口 `activationEvents: ["onStartup"]`：登记后、门禁前并发激活；`StartupFailure` 新增 `activation` 类别与 `activate` 阶段。启动期间宿主停止仍报 `stopped`。
- 关闭顺序：代次作用域 `plugin:<id>/<entry>#<n>` 持有必需借用与收口资源，子作用域 `entry-work` 承载入口资源、激活产出、贡献与服务租约，其上的受管操作等待已交付服务关闭；依赖链 A→B→C 的 `closed` 诊断顺序为 A、B、C。
- 新诊断：`activation-started`、`blocked`、`close-started`、`closed`。

**审查中处理的问题**（[review-1](reviews/review-1.md)）：启动期间宿主停止被改报为 `failed`；必需插件登记被拒绝时同一原因报告多次；重复服务 id 未拒绝；目录排序依赖 locale；激活产出中途校验失败时后续服务实例漏释放（原有缺陷，一并修复）；停止开始后仍可交付服务实例；英文注释与被删掉的清单说明。均已修正并有回归测试（`runtime/plugins/review-regressions.test.ts`、`runtime/application/application-startup.test.ts`）。

**主会话修改**：`scripts/smoke/runtime-foundation.ts` 的测试页面声明空 icon。完整版 Chrome 会请求 `/favicon.ico`，夹具返回 404，被控制台错误断言计为页面错误；这与本 Task 的改动无关。本机没有 Playwright 自带的浏览器，browser 模式只能经 `--browser-executable` 用完整版 Chrome 运行。

**验证**（主会话运行）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `test:runtime-foundation` | 17 个文件、199 条全部通过 | [acceptance-test-runtime-foundation.txt](evidences/acceptance-test-runtime-foundation.txt) |
| `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:runtime-foundation` 的 `--host server`、`--services`、`--host browser --browser-executable /usr/bin/google-chrome-stable` | 全部通过 | [acceptance-smoke-runtime-foundation.txt](evidences/acceptance-smoke-runtime-foundation.txt) |
| `bun run test` | 10 个文件 23 条失败，与 master 基线（[t30](../t30-branch-test-baseline/README.md)）完全相同，无新增 | [acceptance-test-full.txt](evidences/acceptance-test-full.txt) |
| `docs:check` | 通过 | |

omp 自己的输出与汇报：`evidences/` 下的 `test-*.txt`、`typecheck.txt`、`smoke-runtime-foundation.txt`、`implementation-report.json`、`review-round-1.json`。

## 下一步

t33：贡献点由拥有者插件定义（`contributionPoints`），按单条贡献校验，拥有者未登记时贡献“待校验”，取代宿主传入接收者；之后进入服务端宿主切片。
