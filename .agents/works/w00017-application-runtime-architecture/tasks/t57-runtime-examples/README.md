---
schema: nbook.task/v2
taskId: t57-runtime-examples
---

# nb-runtime 示例插件

## 目标与范围

开发者 2026-10-08 要求：给 `packages/nb-runtime` 补一组典型的示例插件，便于理解内核；之后随插件系统完善不断补充。同日看过第一批后要求：示例插件要像应用包的内置插件那样一个插件一个目录、带插件描述（id、版本、运行位置），像能照着写的生产插件，而不是测试；格式按内置插件的现行目录约定（开发者在三种格式中选定，规划中的 `package.json` 清单等 `runtime.plugin-manifest` 实现后再迁）。

行为合同：示例只演示 `runtime/services.md`、`plugins.md`、`application.md`、`lifecycle.md`、`plugin-channel.md` 已有的行为；[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md) 的术语补“插件描述”（类型 `PluginDescriptor` 从应用包移进内核），改到它时按规则一并清理了正文里的 Task 引用与“证据”一节。

## 当前状态

2026-10-08 完成。第一批五个单文件示例（`1132edb9`）按开发者意见重做为：

- `examples/plugins/<插件>/`：`plugin.ts`（插件描述）、`shared/contracts.ts`、`server/plugin.ts`、`web/plugin.ts`，入口是工厂函数，别的插件的服务键与宿主能力经参数交进来。七个插件：`clock`、`greeter`（共享服务与依赖）、`notes`（按调用方门面）、`menu`、`file-menu`（贡献点）、`counter`（一个插件两端之间的远程服务、按需激活、订阅）、`cloud-notes`（以调用方身份代理，`nbook.storage` 的同款结构）。
- `examples/scenarios/`：`hosts.ts` 像宿主那样装配实例并在 `afterEach` 收口，`probes.ts` 是调用方探针，五个场景测试共 7 例。
- 内核 `plugins` 入口新增类型 `PluginDescriptor`，应用包 `src/manifest.ts` 改为从内核重新导出，其余引用不变；`tsconfig.browser.json` 把 `examples/plugins` 纳入浏览器类型检查。

验证：`bun run test:affected --typecheck` 通过（内核 280 例含示例场景 7 例，应用 276 例与组件 57 例，两包类型检查含浏览器那份）；`docs:check`、`governance:check` 无失败。

下一批随 K5 起的切片补充：插件状态 store 与公开状态、项目实例与 `{project}` 目标等。
