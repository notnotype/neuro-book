# Cordis 插件框架调研：内核机制、运行时挂载与卸载

- 调研日期：2026-09-28
- 文档状态：非规范调研资料。不定义产品行为，不授权实现。
- 调研对象：上游 `cordiverse/cordis`（MIT）及其在 DeepSeek Harness 中的源码 vendored 副本
- 关联：[ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md)、[可扩展应用平台](../proposals/extensible-application-platform.md)、[应用运行时总提案](../proposals/application-runtime-and-plugins.md)
- 配套调研：[运行时模块卸载能力](runtime-module-unloading.md)
- 修订：2026-09-30 按 DeepSeek Harness 源码（commit `21638c5631`）复核客户端一节，补充两端结构与依赖（6.8 节）；来源为 [w00017 t27 的 DeepSeek Harness 调研](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/deps-dsh/REPORT.md)

## 证据口径与边界

证据分级，正文逐处标注：

| 标记 | 含义 |
|---|---|
| 实测 | 本机本次运行并记录输出（环境见文末） |
| 源码 | 直接阅读源码，给出文件与行号 |
| 官方文档 | 上游仓库 README，或 DeepSeek Harness 的 cordis 文档 |
| 检索 | 网络检索结果，未在本地独立验证 |

已做：阅读 DeepSeek Harness 的 vendored 源码与文档、查询 npm 与 GitHub API、安装 npm 版 cordis 并运行最小复现。

未做：未运行 DeepSeek Harness 本体；未在浏览器或 Nuxt/Nitro 环境加载 cordis；未验证 Koishi 的实际用法；本文实测使用 npm `cordis@4.0.0-rc.10`，而 vendored 副本是 `4.0.0-rc.7`，两者版本不同。

外部仓库 `deepseek-harness` 的本地路径为 `/home/notnotype/CodeRepository/deepseek-harness`，下文引用其中路径时省略该前缀。

## 1. 事实要点

1. cordis 是一个插件框架：插件通过具名服务（`ctx.<key>`）协作，不互相 `import`；依赖以 `inject` 声明，服务可用性驱动装载顺序。
2. 卸载的定义是「撤销该插件本次运行产生的外部效果」，不是「从模块缓存中移除代码」。重载 = 卸载后对同一个模块对象再执行一次插件入口函数（实测 + 源码）。
3. 框架自身不提供代码热替换；代码热替换由 `@cordisjs/plugin-hmr` 提供，它依赖 Node 私有模块缓存（源码 + 实测，详见配套调研）。
4. Loader 提供配置驱动的插件树：entry 有稳定 `id`、`disabled` 开关、`config`、嵌套 group；支持运行时增删改挂载，支持按绝对路径与 `file://` URL 装载（实测）。
5. cordis 核心不依赖 Node 专有模块（npm manifest 仅依赖 `@standard-schema/spec` 与 `cosmokit`），其客户端包 import cordis 并在浏览器中构建（源码）。core 在浏览器的实际运行未在本次验证（见 §9）。
6. cordis 不管理进程：进程信号、优雅停机、profile 装配由宿主层实现（源码 + DeepSeek Harness 的 app-boot 文档）。
7. 上游自述 API 未稳定，当前发布线为 `4.0.0-rc.*`（官方文档 + npm）。
8. DeepSeek Harness 以源码 vendoring 方式引入 cordis 及其周边包，并在 `vendor/README.md` 记录 22 条本地改动（源码）。

## 2. 来源与版本

npm 与 GitHub 在 2026-09-28 实查：

| 项 | 值 |
|---|---|
| 仓库 | `cordiverse/cordis` |
| License | MIT |
| star / fork / open issues | 8862 / 553 / 74 |
| created_at / pushed_at | 2022-05-17 / 2026-09-08 |
| `cordis` npm | `latest = 4.0.0-rc.10`（2026-09-08），首版 2022-04-21，共 166 个版本 |
| 仓库 README 自述 | "Cordis is under active development. The API is not yet stable and may change without notice." |
| 仓库 homepage 字段 | 指向 deepseek-harness 文档站的 cordis-primer 页 |

周边包 npm 版本（同日实查）：`@cordisjs/plugin-loader` 1.0.0-rc.7、`@cordisjs/plugin-hmr` 1.1.0、`@cordisjs/plugin-include` 1.1.0、`@cordisjs/plugin-group` 1.0.0、`@cordisjs/plugin-timer` 1.1.3。

DeepSeek Harness 的 vendored 副本（来源：`vendor/README.md` manifest 表）：

| 目录 | 上游 | 版本 | 上游仓库 |
|---|---|---|---|
| `vendor/cordis` | `cordis` | 4.0.0-rc.7 | `cordiverse/cordis` commit `56b3d4f7` |
| `vendor/loader` | `@cordisjs/plugin-loader` | 1.0.0-rc.5 | `cordiverse/cordis` commit `56b3d4f7` |
| `vendor/include` | `@cordisjs/plugin-include` | 1.0.4 | `deepseek-harness/cordis` commit `abb0a307` |
| `vendor/group` / `vendor/timer` / `vendor/hmr` / `vendor/logger-console` | 同名 `@cordisjs/plugin-*` | 1.0.0 / 1.1.2 / 1.0.15 / 1.0.0 | `deepseek-harness/cordis` commit `abb0a307` |
| `vendor/cosmokit` / `vendor/schemastery` | `cosmokit` / `schemastery` | 1.8.1 / 3.18.0 | `deepseek-harness/cosmokit`、`deepseek-harness/schemastery` |

规模（`vendor` 源码 `wc -l`）：core 9 个文件共 2,696 行（fiber 754、reflect 418、events 352、registry 337、utils 287、logger 271、context 146、service 115、index 16）；loader 1,064 行；include 343 行；hmr 463 行。四者合计 4,566 行。

## 3. 内核机制

### 3.1 插件形态

插件是函数、类，或带 `apply` 方法的对象（源码 `vendor/cordis/src/registry.ts` 的 `Plugin` 类型与 `isApplicable()`）。类插件可选实现 `Service` 基类，由 `super(ctx, name)` 把自身注册到上下文（源码 `service.ts`）。

### 3.2 服务与依赖声明

- 服务以字符串键挂到上下文，其他插件通过 `ctx.<key>` 取得实例（官方文档 `docs/cordis-primer.zh.md`）。
- 依赖声明 `inject`：数组形式 `['timer']`，或 `{ name: interceptConfig }` 映射形式；`Inject` 装饰器可加在类或方法上（源码 `registry.ts`）。
- 服务隔离：entry 通过 `isolate` 为某个服务名分配独立符号域（`LocalRealm` 按 entry，`GlobalRealm` 按 label），`intercept` 可为依赖插件注入配置（源码 `vendor/loader/src/config/isolate.ts`）。

### 3.3 Fiber 与状态机

每个已加载的插件实例是一个 fiber。状态机（源码 `fiber.ts` `_getState()`；官方文档教程第 2 章）：

```text
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

`PENDING` 表示所需服务尚不可用，是合法状态，不产生错误输出（官方文档教程第 6 章明确列出这一点，并给出通过 `ctx.registry` 遍历 fiber 状态的排查方式）。

### 3.4 依赖变化驱动的装载与卸载

fiber 维护一个 epoch 字符串：把每个 `inject` 服务所属 provider 的 fiber `uid` 拼接而成（源码 `fiber.ts:611` `_refresh()`）。epoch 变化触发 `_setEpoch()`，进而调用 `_reload()` 或 `_unload()`（源码 `fiber.ts:625-640`）。因此 provider 被替换、卸载或重启时，消费者会被自动卸载并重新装载。

### 3.5 effect：可逆注册

`ctx.effect(execute, label)` 立即执行 `execute`，收集其返回的 disposer（单个函数、promise，或产出多个 disposer 的同步/异步可迭代对象），在显式调用返回的 disposer 或 fiber 卸载时按逆序执行（源码 `fiber.ts:415`；官方 API 文档 `docs/cordis-api/fiber.zh.md`）。

同时，以下内置 API 本身即 effect，卸载时自动撤销（官方文档教程第 2 章）：`ctx.on(event, listener)`、`ctx.plugin(child)`、服务注册，以及 DeepSeek Harness 中返回 disposer 的注册表 API。

### 3.6 事件

事件声明合并到 `Events` 接口，分发模式有五种（官方文档 `docs/cordis-primer.zh.md`）：

| 模式 | 是否 await | 顺序 | 返回值 |
|---|---|---|---|
| `emit` | 否 | 注册顺序 | 无 |
| `waterfall` | 否 | 注册顺序，环绕中间件 | 有 |
| `parallel` | 是 | 并行 | 无 |
| `serial` | 是 | 注册顺序 | 有 |
| `bail` | 否 | 注册顺序，首个 bail 值停止 | 有 |

### 3.7 Registry

`RegistryService` 以插件的可执行 callback（函数插件本身，对象插件取其 `apply`）为身份键保存 `Plugin.Runtime`，每个 runtime 持有该插件的全部 fiber（源码 `registry.ts` `resolve()` / `get()` / `delete()`）。`delete(plugin)` 移除 runtime 并 dispose 其全部 fiber。

## 4. 卸载与重载机制

### 4.1 卸载做了什么

`_unload()` 清除 disposables 并等待其结算，随后清空 `store`（注入服务快照），状态转为 DISPOSED 或转入重新装载（源码 `fiber.ts:684`）。实现使用 `Promise.all` 并发执行 disposables；官方文档教程第 2 章明确写「多个**异步** disposer 会并发运行」，并建议需要顺序执行时把它们放进同一个 disposer 内串行 `await`。

### 4.2 重载复用同一个模块对象

`_reload()` 调用 `this._execute(this._runner)`，其中 `runner.callback` 是该插件首次注册时的同一个函数对象（源码 `fiber.ts`）。因此重载不会重新 import 模块，模块顶层状态跨重载保留。

实测（`cordis@4.0.0-rc.10`，Node v26.10.0）：

```text
[module] evaluated (top-level runs)      ← 模块顶层只求值一次
[apply] moduleCounter=1
[effect] setup
--- dispose fiber ---
[effect] cleanup
--- re-import module + re-plugin ---
same module instance? true               ← import() 返回同一模块实例
[apply] moduleCounter=2                  ← 顶层计数器继续递增
[effect] setup
```

### 4.3 官方对插件状态的表述

官方文档教程第 2 章的开头列出插件可被卸载的四种原因（修改配置、热重载、显式释放、所需服务消失），并要求「在这些 API 之外管理的资源必须包装在 `ctx.effect()` 中」。同一文档指出，在 `ctx.effect` 内获取并返回 disposer 后，「Cordis 会在卸载期间调用该释放逻辑，热重载时也不例外」。

### 4.4 代码热替换

框架不含代码热替换能力；由 `@cordisjs/plugin-hmr` 提供，其机制与对 Node 私有 API 的依赖见 [运行时模块卸载能力](runtime-module-unloading.md)。

## 5. Loader：配置驱动的插件树

### 5.1 结构

`Loader extends EntryTree`，`Entry` 的字段为 `id` / `name` / `config` / `group` / `disabled` / `inject`（源码 `vendor/loader/src/config/entry.ts` 的 `EntryOptions`）。`Entry.update()` 的判定顺序（源码同文件）：

1. 合并 options；
2. `disabled` 为真时 dispose 现有 fiber 并返回；
3. 已有活动 fiber 时，比较新旧 options：只有 `config` 变化且 `equalExceptVolatile()` 判定为仅 volatile 差异时原地提交，不再挂载；否则走 `loader/partial-dispose` 与 `_patchContext()`（可能触发 fiber `update()`，即重启）；
4. 没有 fiber 时执行 `init()`（import 模块并注册插件）。

`disabled` 字段支持 `!!js` 表达式，在每次挂载决策时基于 loader 上下文求值，原始表达式节点保留在 options 中以供写回（源码 `entry.ts` `disabledOf()`；DeepSeek Harness `vendor/README.md` 第 18 条）。

### 5.2 装载来源

`EntryTree.import(name, getOuterStack)`（源码 `vendor/loader/src/config/tree.ts`）：

1. `cordis:` 前缀 → 取 `loader.builtins`；
2. 存在内部 loader 时 → `ctx.loader.internal.import(name, ctx.baseUrl, {})`；
3. 否则以 `ctx.baseUrl` 解析相对路径 `import(new URL(name, baseUrl).href)`；
4. 其余按裸说明符 `import(name)`。

### 5.3 实测：运行时挂载与卸载

`@cordisjs/plugin-loader@1.0.0-rc.7` + Node v26.10.0：

```text
--- create entry by ABSOLUTE PATH ---
[plug] module evaluated
[plug] apply
[plug] setup
state: 2                                    ← ACTIVE
--- disable entry (unmount) ---
[plug] cleanup
--- re-enable (mount again) ---
[plug] apply
[plug] setup                                ← 模块未重新求值，apply 重跑
--- create entry by FILE URL ---
[plug] apply
[plug] setup
--- remove entries ---
[plug] cleanup
[plug] cleanup
```

即：`loader.create()` 接受绝对路径与 `file://` URL；`disabled: true` 卸载而不删除 entry；重新启用会再次 `apply`，但复用同一模块实例。

### 5.4 事务性

DeepSeek Harness `vendor/README.md` 第 8 条记录：loader 的 entry/group/tree 变更是急切且非事务的，不恢复先前的插件或选项，「plugin activation failures can leave a partially applied tree」。同条第 8 项说明 include 的解析保护（顶层非数组不缓存、刷新失败记日志、文件或 Include 配置变更后重新应用补丁）用于在文件无效时保留运行中的树。

### 5.5 Include 与补丁

`@cordisjs/plugin-include` 解析含 `!!js` 表达式的 entry 列表文件，监视文件变化并应用补丁。DeepSeek Harness 把补丁算法抽成纯函数 `applyEntryPatches(data, patches, warn)` 并导出，供 `dsh --dump-config` 在不启动插件树的前提下组合并打印结果（`vendor/README.md` 第 11 条）。

## 6. DeepSeek Harness 的生产用法

以下来自 `deepseek-harness` 的各包 README 与配置文件（源码/官方文档级证据）。

### 6.1 profile、bundle 与补丁层

- profile 位于 `$DSH_HOME/profiles/<name>`，由 `package.json` 与 `cordis.patch.yml` 组成；`package.json` 的 `dsh.profile.bundles` 是有序的 bundle 列表（`packages/boot/app-boot/README.md`）。
- bundle 是一个静态补丁文档：对空 profile 根应用的一个 `insert` 列表，不挂服务、不发事件、无可变状态（`packages/bundle/base/README.md`、`packages/bundle/base/cordis.patch.yml`）。
- 补丁语义：替换目标行的整个 `config`，而非合并；因此每行只应出现在一个 bundle 层加用户层（`cordis.patch.yml` 顶部注释）。
- 层顺序：bundle 层之后是 profile 的 `cordis.patch.yml`，再到 home 级补丁；后者优先级更高。
- 补丁可对 entry 使用 `disabled: !!js "<表达式>"`，例如 `disabled: !!js "!ctx.get('profileContext')"`（`packages/bundle/base/cordis.patch.yml`）。
- `insert` 的 name 可为绝对路径、`file://` URL 或包说明符；补丁加载会把绝对路径与相对补丁文件的 `./`、`../` 路径转成 file URL（`packages/boot/app-boot/README.md`）。

### 6.2 兼容性门禁

导入插件前，DSH 检查其 `peerDependencies`（对 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`）是否匹配当前运行时版本；不匹配的行在启动器自己的组合副本中被标记为 `disabled: true`，其模块不会被 import（`packages/boot/app-boot/README.md`）。另有按「包名@版本 → 运行时版本」的精确豁免文件 `compatibility.json`（同文档、`packages/boot/plugin-manager/README.md`）。

### 6.3 运行时管理

`@deepseek-ai/dsh-plugin-manager` 提供运行时启停单个 entry、安装与移除 bundle（经 pnpm）。启用 HMR 时配置变更立即生效；未启用时组合保持到重启。安装过程对外广播 `plugin-manager/install-state`（`installing` / `cancelling` / `applying`）与 `plugin-manager/install-log`（`packages/boot/plugin-manager/README.md`）。

### 6.4 HMR 的默认配置

base bundle 中 `hmr` 行的配置为 `root: []`，即默认只做配置热重载，不监视源码模块；源码监视需在 profile 补丁中显式配置（`packages/bundle/base/cordis.patch.yml`、`packages/boot/hmr/README.md`）。

### 6.5 进程生命周期

cordis 不参与进程管理。DSH 由宿主层负责：`boot()` 装载 profile、应用补丁、启动插件；`installFailLoud()` 为未处理的 rejection/exception 写一条带标签的诊断，等待 surface 注册的 release 钩子，然后以 1 退出；CLI 各退出路径在 SIGINT/SIGTERM 上 dispose 根上下文（`packages/boot/app-boot/README.md`）。关闭超时由各插件自行实现，例如 OTel 插件携带 `shutdownTimeoutMillis: 3000`（`packages/bundle/base/cordis.patch.yml`）。

### 6.6 客户端

cordis 核心可在浏览器运行：DSH 的多个客户端包 import cordis，Web 启动时执行 `new Context()`、`ctx.plugin(Loader)`，并把客户端模块系统设为 Loader 的内部装载器（源码 `packages/client/**` 的 import 语句、`packages/client/web/src/boot.ts:169`、`packages/client/web/src/boot-client.ts:38-40`；未运行验证）。插件的浏览器部分有两条加载路径，两者都不重新构建 Web 客户端（官方文档）：

1. **已安装插件的客户端模块**（`docs/subsystems/client-modules.md`、`packages/client/modules/README.md`；2026-09-30 按源码复核）：
   - 插件包在 `package.json` 中声明 `dsh.client`，其中 `platform` 必填且 Web 端只认 `web`，并以 `exports["./client"]` 导出自己预先构建的 bundle；声明了 `dsh.client` 却没有该导出时，扫描直接报错（源码 `packages/util/package-manifest/src/types.ts:80-94`、`packages/client/modules/src/index.ts:836-848`）。
   - Host 只收录未禁用且已有 fiber 的 Loader entry，即 Node 端 import 成功的行（源码 `packages/client/modules/src/index.ts:984`），组合启动图注入页面，经 `/plugins` 路由提供 bundle。因此只有浏览器部分的包也要带一个能导入的 Node 端，多为空 `apply()`：71 个带 `dsh.client` 的包中有 44 个如此（脚本统计 `packages/*/*/package.json` 与对应 `src/index.ts`）。
   - 浏览器用自有的 lazy-CJS 模块表加载：执行 bundle 只登记工厂，首次使用才求值。模块解析顺序为种子表、已物化记录、图中的包行、已注册工厂（源码 `packages/client/modules/src/client/manifest.ts:18-21`）。外壳冻结的共享模块表 `PLATFORM_MODULES`（React、Cordis 与静态 UI 库）是隐式基线；包还可以经 `dsh.client.external` 请求另一个动态包行，目前有 5 个包这样做，请求的都是 `@deepseek-ai/dsh-api-gateway/client`（源码与脚本统计）。
   - 浏览器 entry 以 `{ name: 包名 }` 创建，拿不到 Host entry 的配置（源码 `packages/client/modules/src/client/entries.ts:167-175`）。
   - 打开的页面经 dsh-client-hmr 与 `ClientEntries` 跟随 Host 的模块图，不经 cordis 的 `@cordisjs/plugin-hmr`（源码 `packages/client/hmr/src/client/index.ts:22`）：启用插件时加入；停用时先移除并等待其异步清理（源码 `packages/client/modules/src/client/entries.ts:200-209`），再逐出不再使用的模块与样式；重新启用时装载一个新实例。这在默认 Web 组合下成立，web-app bundle 常驻 `client-hmr` 行（`packages/bundle/web-app/cordis.patch.yml:201-202`）；Host 侧配置热应用依赖 `dsh-hmr`，base bundle 只在有 `profileContext` 时启用它（`packages/bundle/base/cordis.patch.yml:28-32`），没有 HMR 时启停要到重启才生效（`packages/boot/plugin-manager/README.md`）。
   - 替换已安装包的版本需要重启进程（`packages/boot/plugin-manager/README.md` 已知限制）。
2. **模型定义的进程内动态包**（`packages/extensions/cordis-client-runner/README.md`）：浏览器部分是纯 JavaScript（无 JSX、TypeScript 与模块 import），以 async 函数执行，只能使用注入的 `React`、`console`、`styles`、`host`；须经批准或用户手势才进入页面，页面刷新后不恢复。

第 2 条的设计笔记（`.agents/notes/rejected/architecture/2026-08-08-cordis-web-dynamic-packages.md`）状态为“rejected — closed as a proposal”，原因是已发布的 `packages/extensions` 运行时及其 README 接管了设计。笔记中“状态无法一致解释”是它要解决的问题陈述，不是否决理由。

本节第 1 条已按源码复核，第 2 条来自 README；两条都未在本地运行验证（见[未验证边界](#9-未验证边界)）。

### 6.7 vendoring 与本地改动

`vendor/README.md` 记录 22 条本地改动，与生命周期、装载、兼容性直接相关的包括：

| 编号 | 内容 |
|---|---|
| 6 | `cordis/src/fiber.ts` 生命周期加固：关闭三处重入卸载缺口（effect 的 owner-list wrapper 在 setup 之前登记；同步 setup 失败回滚已收集清理；`UNLOADING` 期间拒绝创建 effect） |
| 8 | include 的容错刷新与补丁重应用；说明 loader 变更为急切、非事务 |
| 15 | 懒惰的 Loader 配置解析（移植 `cordiverse/cordis` PR #41）：保留原始 fiber config，待声明的注入激活后再解析 |
| 18 | `disabled` 的 `!!js` 插值 |
| 19 | 内部 loader 形状探测按 module-job API 判定，而非按 Node 主版本号（v2 接口在 Node 24.12.0 才出现，24.0–24.11.1 会被旧逻辑误判） |
| 20 | loader 记录 registry 结果 context 中的原始 fiber，而非其 PromiseLike 包装 |
| 21 | `cordis/src/logger.ts` 各 disposer 保留登记 id，移除较早的 exporter 不影响较晚的 |
| 22 | volatile 配置语义（跨 cosmokit / schemastery / cordis / loader） |

同步流程为：记录上游 commit → 覆盖 `src/` → 重新应用本地改动 → 更新 manifest 版本与 commit → 跑根仓库 `pnpm install && pnpm run test && pnpm run build`（`vendor/README.md` 末尾）。

### 6.8 两端结构与依赖

2026-09-30 按源码补充（commit `21638c5631`，未运行验证）；完整行号见 [t27 的 DeepSeek Harness 调研](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/deps-dsh/REPORT.md)。

- **两端是两个 cordis 插件。** 一个包的 Node 端来自 `"."` 导出，浏览器端来自 `exports["./client"]`，各有自己的 `apply` 与 `inject`，两端的 `inject` 可以完全不同。例如 file-upload 的 Node 端依赖 `agents`、`attachments`、`commands`、`connection`，浏览器端只依赖 `remote`（源码 `packages/client/file-upload/src/index.ts:58`、`packages/client/file-upload/src/client/index.ts:18`）。
- **依赖声明分三层，互不替代**（文档 `packages/client/AGENTS.md:85-97`）：
  - cordis `inject` 按服务名声明，决定激活。vendored cordis 只有必需一种，缺任一服务即停在 `PENDING`（源码 `vendor/cordis/src/registry.ts:12-19`、`vendor/cordis/src/fiber.ts:611-623`）；可选依赖用子插件 `ctx.inject([...], cb)` 或运行时 `ctx.get()`。
  - `dsh.client.inject` 是包名列表，只在浏览器端用于工厂到达顺序与 HMR 比对，类型注释写明它不是 cordis 服务注入（源码 `packages/util/package-manifest/src/types.ts:84-85`、`packages/client/modules/src/client/system.ts:268-271`、`packages/client/modules/src/client/entries.ts:29-31`）。
  - npm 依赖只表示安装关系，不决定激活（文档 `packages/client/AGENTS.md:60-66`）。
  - 没有“插件 A 依赖插件 B”的插件级依赖：`DshManifest` 只有 `bundle`、`profile`、`client` 三个角色字段（源码 `packages/util/package-manifest/src/types.ts:30-39`）。
- **浏览器端经 `remote` 网关使用服务端能力。** Host 服务继承 `TypertRemoteService` 并以名字登记，例如 `fileUploads`；构建从它的类型生成 `./remote` 描述。浏览器端网关把描述挂为 `ctx.remote.<命名空间>`，并为每个命名空间另登记一个 `remote.<命名空间>` 服务（源码 `packages/client/file-upload/src/index.ts`、`packages/api/gateway/src/client/index.ts:348-366,752-753`）。挂载只在浏览器本地完成，不检查 Host 服务是否在线；Host 服务缺席时，调用返回 `gateway/service-unavailable` 或 `gateway/invocation-unavailable`（源码 `packages/api/gateway/src/index.ts:694-700,771-772`）。多数命名空间由 `dsh-api-remotes` 的浏览器端静态列出（24 个）；实验性的语音输入在自己的浏览器端激活时自行挂载（源码 `packages/api/remotes/src/client/index.ts`、`packages/experimental/client-ui-voice-input/src/client/mount.ts:61`）。
- **启停身份在 Host 端。** 安装单位是 bundle，启停单位是 Host Loader entry id；浏览器行由 Host entry 派生、按包名标识，经 HMR 推到每个页面；页面本地失败不改变 Host 的启用状态（源码 `packages/client/modules/src/client/entries.ts:9`；文档 `packages/client/modules/README.md:42`）。
- **两端的失败语义不同。** 3.3 节所述 `PENDING` 不产生错误输出是 cordis 本身的行为，DSH 在两端另加了审计：
  - Host 端非必需 entry 停在 `PENDING` 只告警，7 个必需 id 任一失败即抛 StartupError 并退出（源码 `packages/boot/app-boot/src/index.ts:746-754,824-862`）。
  - Web 首次启动要求全部浏览器 entry 都已激活，否则停在启动页、不挂载界面（源码 `packages/client/web/src/boot-client.ts:36-88`；文档 `packages/client/web/README.md:123`）；启动后新增的行停在 `PENDING` 时只记为页面本地失败（源码 `packages/client/modules/src/client/entries.ts:232-243`）。
  - Host 端 import 失败时浏览器行不发布（源码 `vendor/loader/src/config/entry.ts:221-235`、`packages/client/modules/src/index.ts:984`）；Host 端停在 `PENDING` 或失败时浏览器行照常发布（推断，依据同上两处，无测试覆盖）。
- **同一服务名在两端可以是不同实现**，例如 `connection`（源码 `packages/client/connection/src/rpc-host.ts:80`、`packages/client/connection/src/client/index.ts:310`）。
- **客户端平台。** `dsh.client.platform` 是字符串，目前只有 Web 端消费 `web`；headless、acp、sdk 等是服务端的 profile 组合，不是客户端平台（源码 `packages/util/package-manifest/src/types.ts:80-94`；文档 `packages/boot/app-boot/README.md:50`）。

## 7. 与 w00017 内核合同的机制对照

对照对象为本仓库现有内核合同（`runtime/lifecycle/contracts.ts`、`runtime/services/contracts.ts`、`runtime/plugins/contracts.ts`、`runtime/application/contracts.ts`）。左列为机制维度，中列为 cordis 的对应实现，右列为本仓库现有合同的规定。

| 维度 | cordis | 本仓库现有合同 |
|---|---|---|
| 插件实例与状态 | `Fiber`，6 态；依赖就绪与否由 epoch 决定 | `EntryState.status` 6 态，含 `foreign-location` 与 `closeout` |
| 依赖声明 | `inject` 字符串键数组或 name→intercept 映射 | `ServiceDependency {key: ServiceKey<T>, required?}` |
| 依赖缺失的表现 | 停在 `PENDING`，无错误输出（官方文档） | `Unavailable` 带 11 种 `UnavailableReason` 与 `path`；`recover()` 显式恢复 |
| 依赖的静态检查 | 无静态检查；顺序由服务可用性在运行时决定 | `AssemblyReport` 给出 satisfied / missing / unreachable / conflict / provider-rejected 判定 |
| 服务键 | 字符串键，挂在 Context 原型链上 | `ServiceKey<T>` 对象身份，声明只能引用受信登记表中的键 |
| 实例寿命与换代 | 消费者 epoch 绑定 provider fiber `uid`；provider 换代即卸载重载消费者 | 每次初始化新建 service scope；`ServiceBinding` 带 `stale` 标记，旧绑定不自动改投新代次 |
| 释放顺序 | 同一 fiber 内 disposer 逆序启动，异步 disposer 并发执行 | `ResourceSpec.dependsOn` 与 `BorrowHandle` 构成跨作用域依赖；关闭按依赖顺序 |
| 关闭控制 | `fiber.dispose()` 等待全部清理结算；无截止、无失败记账、无重试 | `close(deadline)` / `recover()` / `CloseIncomplete`（release-failed、deadline、blocked） |
| 贡献的事务性 | 无框架级机制；由各服务自建注册表实现 | `ContributionReceiver` 的 validate / prepare / commit / revoke 多接收者事务，`ContributionHandle.implementation()` 在提交前不可用 |
| 诊断 | `fiber.getEffects()`、`internal/status` 事件、`ctx.registry` 遍历 | 结构化 observer + `snapshot()` + 带 `sequence` 的失败记录 |
| 配置驱动的插件树 | Loader：entry 树、id、disabled、group、include、补丁层、隔离域 | 无对应机制 |

## 8. 与 ADR 0022 各条决策的对应关系

下表只列「ADR 的决策内容」与「cordis 中可对应的机制」，不给出取舍结论。

| ADR 0022 决策 | cordis 中可对应的机制 | 证据 |
|---|---|---|
| 1 开放第三方可执行插件；最终验收为从本地文件夹安装的文生图插件 | Loader 可按绝对路径、`file://` URL 或包说明符装载并运行时挂载 | 源码 `tree.ts` `import()`；§5.3 实测 |
| 1 第一版不做插件市场、在线分发、签名、权限沙箱、独立扩展宿主进程、热安装与热卸载 | cordis 无沙箱与分发机制；运行时挂载/卸载与配置热更新存在，代码热替换依赖外部插件并需要 Node 私有 API | 本文件 §5、配套调研 |
| 1 文生图插件需在浏览器侧生效 | cordis 核心可在浏览器运行；DSH 已安装插件的浏览器部分以预构建 bundle 在运行时装入浏览器模块表，共享依赖以外壳的冻结模块表为基线，默认 Web 组合下启用与停用可在打开的页面上即时同步，版本替换需重启 | 6.6 节；DSH 客户端模块源码与文档 |
| 2 内核拥有进程 | cordis 不提供；由宿主层实现进程信号、启动门禁与根上下文 dispose | §6.5 |
| 2 内置与第三方使用同一套登记、激活与贡献机制 | Loader 的 entry 机制对内置与第三方一致；贡献点机制需另建 | §5、§7 |
| 3 公开 API 全部异步、参数与结果可序列化，插件只经注入的 API 对象访问宿主 | cordis 的服务是进程内对象引用（`ctx.<key>`）；跨端或跨进程调用需另加传输层 | 源码 `service.ts` / `context.ts`；§6.4 之外另见 DSH 的 Remote API 与 gateway 包 |
| 3 密钥由模型 Provider 插件保管 | 无对应机制，属应用层设计 | — |
| 4 服务端按单一所有者部署 | 无对应机制，属部署设计 | — |
| 5 先重排地基，再用资源管理器竖切 | 无对应机制，属推进顺序 | — |

## 9. 未验证边界

- 未运行 DeepSeek Harness 本体。第 6 节主要来自其 README 与配置文件，6.6 节与 6.8 节于 2026-09-30 按源码复核；均未做运行时验证。
- 未在 Nuxt / Nitro / 浏览器环境加载 cordis。
- 未验证 cordis 在 Windows 与本项目 State Root 布局下的装载行为。
- 未验证 `isolate` / `intercept` 的实际效果。
- 本文实测使用 `cordis@4.0.0-rc.10` 与 `@cordisjs/plugin-loader@1.0.0-rc.7`；vendored 副本版本不同（4.0.0-rc.7 / 1.0.0-rc.5），两者行为可能存在差异。
- 关于 Koishi 使用 cordis 的说法来自网络检索摘要，未在本地验证。

## 10. 证据清单与复现

本仓库：

- `runtime/lifecycle/contracts.ts`、`runtime/services/contracts.ts`、`runtime/plugins/contracts.ts`、`runtime/application/contracts.ts`
- `../adr/0022-extensible-platform-and-plugin-trust.md`、`../proposals/extensible-application-platform.md`

外部仓库 `deepseek-harness`：

- `vendor/README.md`（manifest、22 条本地改动、同步流程）
- `vendor/cordis/src/{context,events,fiber,index,logger,reflect,registry,service,utils}.ts`
- `vendor/loader/src/{index,internal}.ts`、`vendor/loader/src/config/{diff,entry,group,isolate,tree,utils}.ts`
- `vendor/hmr/src/index.ts`、`vendor/include/src/index.ts`
- `docs/cordis-primer.zh.md`、`docs/cordis-api/fiber.zh.md`、`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md`、`docs/cordis-tutorial/06-composition-and-hmr.zh.md`
- `packages/boot/app-boot/README.md`、`packages/boot/hmr/README.md`、`packages/boot/plugin-manager/README.md`
- `packages/bundle/base/{README.md,cordis.patch.yml}`
- `docs/subsystems/client-modules.md`、`packages/client/modules/README.md`、`packages/extensions/cordis-client-runner/README.md`（§6.6，2026-09-28 修正时补读）
- `.agents/notes/rejected/architecture/2026-08-08-cordis-web-dynamic-packages.md`
- 6.6 节与 6.8 节（2026-09-30，commit `21638c5631`）：`packages/util/package-manifest/src/types.ts`、`packages/client/modules/src/{index.ts,client/manifest.ts,client/system.ts,client/entries.ts}`、`packages/client/hmr/src/client/index.ts`、`packages/client/web/src/{boot.ts,boot-client.ts}`、`packages/client/file-upload/src/{index.ts,client/index.ts}`、`packages/api/gateway/src/{index.ts,client/index.ts}`、`packages/api/remotes/src/client/index.ts`、`packages/boot/app-boot/src/index.ts`、`vendor/loader/src/config/entry.ts`、`packages/client/AGENTS.md`、`packages/bundle/web-app/cordis.patch.yml`

外部事实来源：

- `https://registry.npmjs.org/cordis`、`https://registry.npmjs.org/@cordisjs/plugin-{loader,hmr,include,group,timer}`
- `https://api.github.com/repos/cordiverse/cordis`
- `https://raw.githubusercontent.com/cordiverse/cordis/main/packages/core/README.md`

本次实测环境：Node v26.10.0；`cordis@4.0.0-rc.10`、`@cordisjs/plugin-loader@1.0.0-rc.7`、`@cordisjs/plugin-hmr@1.1.0`；临时目录已清理，复现步骤见配套调研的文末。
