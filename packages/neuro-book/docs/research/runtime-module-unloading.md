# 运行时模块卸载能力调研：Node、Cordis HMR 与 Bun

- 调研日期：2026-09-28（2026-09-30 补充 §4.4）
- 文档状态：非规范调研资料。不定义产品行为，不授权实现。
- 调研问题：运行时能否把已 `import` 的模块从模块缓存中移除并重新求值；各运行时提供了哪些路径；代价是什么。
- 关联：[Cordis 插件框架调研](cordis-plugin-kernel.md)、[ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md)
- 适用范围：服务端宿主运行时（Node 26 / Bun 1.4）的进程内模块卸载；不含浏览器构建工具链

## 证据口径与边界

| 标记 | 含义 |
|---|---|
| 实测 | 本机本次运行并记录输出 |
| 源码 | 阅读源码，给出文件 |
| 官方文档 | 运行时官方文档 |
| 未验证 | 未在本地执行 |

已做：Node v26.10.0 与 Bun 1.4.2 的最小复现；Bun canary 构建上验证 `Bun.ModuleGraph`；阅读 cordis HMR 源码并在 Node 上运行其热替换全流程。

未做：未验证 Windows；未验证与打包器（Nuxt/Nitro/tsdown）组合后的行为；未验证 `Bun.ModuleGraph` 与原生 addon 交互。

## 1. 事实要点

1. 三个运行时都没有「卸载指定模块」的**通用公开 API**。可用的卸载能力按运行时与模块格式不同而不同（实测）。
2. Node：CommonJS 可用 `delete require.cache[key]` 卸载单模块；ESM 无公开 API，只能通过 `--expose-internals` 触达私有 `loadCache`（实测）。
3. cordis 的内核不解决此问题：它把「卸载」定义为撤销该插件产生的外部效果，重载时对**同一个模块对象**再执行一次插件入口（实测，见配套调研）。
4. cordis 的代码热替换由 `@cordisjs/plugin-hmr` 实现：备份并删除 Node 私有 `loadCache` 与 `require.cache` 条目，重新 `import()` 插件入口，然后把注册表里的旧插件换成新导出；任何一步失败则回滚缓存并重新注册旧插件（源码 + 实测）。
5. `--expose-internals` 不是唯一途径；DeepSeek Harness 的 loader 也接受原生插件 `node-addon-require-builtin` 读取内部 builtin（源码）。
6. Bun：`bun --hot` 会重置整个模块注册表并重新求值整张入口图（官方文档 + 实测）；粒度是整图，不是单模块。
7. Bun 1.4.2 稳定版没有 `Bun.ModuleGraph`，也没有运行时的 `import.meta.hot`（实测）。`Bun.ModuleGraph` 于 2026-09-17 进入上游 main，当前仅存在于 canary 构建，官方文档标记为 experimental（源码 + 官方文档 + 实测）。
8. `import.meta.hot`（Vite 风格）在 Bun 中属于**全栈开发服务器**的浏览器侧 API，不属于 `bun --hot` 运行时（官方文档 + 实测）。
9. 2026-09-30 补充：Bun 1.4.2 中 `delete require.cache[path]` 对经 `import()` 加载的 ESM 同样生效，删除后同一路径重新 import 会重新求值，旧模块在无人引用后被回收（实测，见 §4.4）。这一行为没有官方文档保证。

## 2. Node

### 2.1 ESM

- 同一 URL 的 `import()` 永远返回同一模块实例（实测）。
- 追加 query 可绕过缓存得到新实例，但旧实例不被回收，且同一 URL 再次 import 仍回到旧实例（实测）。
- 无公开 API 移除某条模块记录。

实测（Node v26.10.0）：

```text
[mod] evaluated
同 URL 两次 import 同实例? true
[mod] evaluated
query 破缓存 -> 新实例? true | marker 不同? true
```

### 2.2 CommonJS

`delete require.cache[require.resolve(spec)]` 生效，随后的 `require` 重新求值（实测）。

```text
两次 require 同实例? true | require.cache 条目数: 2
delete 生效? true
[mod] evaluated
删后重新 require 同实例? false | 重新求值? true
```

### 2.3 私有 ESM 模块注册表

`--expose-internals` 下可取到 `internal/modules/esm/loader`：

```text
internal/modules/esm/loader 可取: object | 形状: v2 (getOrCreateModuleJob)
loadCache instanceof Map: false | size = 2
```

补充探测同一环境下的 `loadCache` 形态：

```text
constructor: LoadCache
toStringTag: [object Map]
typeof get/set/has/delete: function function function function
Map.prototype.get.call 可用: true
loader 自身键: ... getOrCreateModuleJob, import, register, resolveSync, load, ...
```

要点：

- Node 26 的 loader 属于 cordis 所称的 v2 形状：有 `getOrCreateModuleJob`，无 `getModuleJobForImport`（实测；与 DeepSeek Harness `vendor/README.md` 第 19 条的判定逻辑一致）。
- `loadCache instanceof Map` 为 `false`，但 `Map.prototype.get/set/has/delete.call(loadCache, ...)` 可用（实测）。DeepSeek Harness `vendor/hmr/src/index.ts` 的注释记录了同一现象：Node 24 起 `loadCache` 的 `.delete()` 只把类型槽置为 `undefined`，因此 HMR 必须用 `Map.prototype.delete.call()` 才能完整移除条目。
- 用 `Map.prototype.delete.call()` 删除条目后重新 `import()`，模块被重新求值（实测）：

```text
loadCache 中命中 mod.mjs: true
驱逐前 marker = undefined
delete 后 loadCache 仍命中? false
[mod] evaluated
驱逐后重新 import 是同一实例? false | marker = 6a2b9a | 重新求值? true
```

- 不带 `--expose-internals` 时不可达（实测）：

```text
internal/modules/esm/loader 不可取: MODULE_NOT_FOUND
```

## 3. Cordis 的 HMR 实现

来源：`deepseek-harness/vendor/hmr/src/index.ts`（427 行）与其 vendored 版本 1.0.15；实测使用 npm `@cordisjs/plugin-hmr@1.1.0`。

### 3.1 依赖前提

HMR 服务在构造时检查 `ctx.loader.internal` 是否存在，不存在即报错（vendor 1.0.15 的实现为 `throw new Error('--expose-internals is required for HMR service')`）。npm 1.1.0 的行为是记一条警告并禁用源码 HMR（实测文本）：

```text
[W] hmr loader internals are unavailable, source code HMR is disabled; pass --expose-internals or install node-addon-require-builtin to enable it
```

`loader.internal` 的获取方式见 `vendor/loader/src/internal.ts` 的 `ModuleLoader.fromInternal()`：先尝试 `require('internal/modules/esm/loader')`（要求 `--expose-internals`），失败则尝试 `require('node-addon-require-builtin').requireBuiltin(...)`，均失败则返回 `undefined`。

同一函数的形状判定依据是模块作业 API 的归属（`getOrCreateModuleJob` → v2，`getModuleJobForImport` → v1），不依据 Node 主版本号；DeepSeek Harness `vendor/README.md` 第 19 条记录了按版本号判定曾导致 Node 24.0–24.11.1 被误判。

### 3.2 变更分类

文件变更后，`partialReload()` 之前的处理按 `loader.watcher` 的 `change` 处理分支（源码同文件）：

1. 变更文件属于宿主入口的依赖树（`externals`）→ `loader.exit()`，交由宿主做整体重启；
2. 变更文件命中 ESM `loadCache` → 记入 `stashed`，稍后执行部分重载；
3. 变更文件是某个 Include 的配置文件 → 对该 include 调用 `refresh()`；
4. 其余情况 → 派发 `hmr/change` 事件。

`analyzeChanges()` 依据 `ModuleJob.linked`（模块依赖图）把变更文件划分为 accepted 与 declined：变更文件及其「被接受的依赖方」进入 accepted，宿主入口依赖树的成员进入 declined；`node:` 与 `node_modules` 路径被排除。

### 3.3 缓存备份、清除与回滚

对 accepted 集合中的每个 URL（源码同文件）：

1. 用 `Map.prototype.get.call()` 备份 `loadCache` 条目，再用 `Map.prototype.delete.call()` 删除；
2. 若同一文件在 `require.cache` 中，备份后 `delete`；
3. 逐个重新 `loader.import(filename)`；
4. 任一步抛错则调用 `rollback()`：恢复两个缓存的备份，并对已换出的插件重新注册旧插件。

该流程同时处理 ESM 与 CJS，注释说明原因是 Node 24 中经 `import()` 加载的 CJS 模块同时出现在两个缓存里。

### 3.4 插件交换

重新导入成功后，对每个待替换插件（源码同文件）：

```text
registry.delete(oldPlugin)     // 旧 runtime 的全部 fiber 被 dispose
registry.plugin(newPlugin, oldFiber._config)   // 用新导出建立 fiber
fiber.entry = oldFiber.entry   // 保持 loader entry 关联
```

随后派发 `hmr/reload` 事件并清空 `stashed`。

### 3.5 实测

配置 `cordis.yml`（loader + include + timer + logger-console + hmr）并以 `node --expose-internals node_modules/cordis/bin.js` 启动，连续两次保存插件文件：

```text
[hello] MODULE EVALUATED #1 evalId=45f530
[hello] VERSION 1 apply from evalId=45f530
[hello] v1 effect setup
[I] hmr watching [ '.' ]
[hello] MODULE EVALUATED #2 evalId=aba9e0     ← 模块被重新求值
[hello] v1 effect cleanup                      ← 旧 fiber 的 effect 逆序撤销
[I] hmr reload plugin at hello.mjs
[hello] VERSION 2 apply from evalId=aba9e0
[hello] v2 effect setup
[hello] MODULE EVALUATED #3 evalId=9f8d33
[hello] v2 effect cleanup
[I] hmr reload plugin at hello.mjs
[hello] VERSION 3 apply from evalId=9f8d33
[hello] v2 effect setup
```

其中 `evalId` 为模块顶层生成的随机值，用于区分模块实例；计数递增与 `evalId` 变化共同证明是重新求值而非复用旧模块。

### 3.6 适用范围

- 仅服务端 Node 进程；同进程内替换。
- 旧模块对象若仍被其他引用持有（全局变量、闭包、宿主持有的引用），不会被回收。
- 缓存清除基于 URL；被清除集合由依赖图分析决定。
- DeepSeek Harness 在生产 profile 中默认只启用配置热重载：base bundle 的 `hmr` 行配置为 `root: []`，源码监视需在 profile 补丁中显式配置（源码 `packages/bundle/base/cordis.patch.yml`、`packages/boot/hmr/README.md`）。

## 4. Bun

### 4.1 可用路径

| 路径 | 粒度 | 公开 API | 旧模块/旧资源 | 实测结果 |
|---|---|---|---|---|
| `import()` 同 URL | — | — | — | 同实例，不可卸载 |
| URL 追加 query | 单模块，凭 URL 造新实例 | 是 | 不回收 | 新实例；再次用原 URL import 回到旧实例 |
| `delete require.cache[key]` | 单模块（CJS；Bun 1.4.2 实测对 ESM 同样生效，见 §4.4） | 是（ESM 部分未文档化） | 无人引用后回收（§4.4） | 生效，重新求值 |
| `bun --hot` | 整张入口图 | CLI 开关 | 重置注册表并同步 GC | 生效，见 §4.2 |
| `bun:test` 的 `mock.module()` | 单模块替换，进程级 | 是（测试内） | 不回收 | 生效，仅测试文件运行期 |
| `Bun.ModuleGraph` | 一整份独立模块图 | 是（experimental） | `dispose()` 关闭图内资源并丢弃注册表 | 见 §5 |

### 4.2 `bun --hot`

官方文档的描述（`bun.com/docs/runtime/watch-mode`）：

- 与 `--watch` 的区别是不重启进程，而是「更新内部模块缓存」；
- 从入口开始建立被 import 的源码文件注册表，**排除 `node_modules`**；
- 实现细节（文档折叠区原文）：重置内部 `require` 缓存与 ES 模块注册表（`Loader.registry`）、同步运行垃圾回收、从头重新转译全部代码、用 JavaScriptCore 重新求值；
- 全局状态（`globalThis`）保留。

实测（Bun 1.4.2，入口 + 两个依赖，每模块用 `globalThis` 计数自报求值次数）：修改任意一个文件后，三个模块全部重新求值，进程号不变。

```text
[dep-a] EVAL #1  hot=false
[dep-b] EVAL #1  hot=false
[entry] EVAL #1  hot=false
[entry] a = A1 | b = B1
[entry] pid = 306054
--- 只改 dep-a.mjs ---
[dep-a] EVAL #2  hot=false
[dep-b] EVAL #2  hot=false      ← 未修改的依赖同样重新求值
[entry] EVAL #2  hot=false
[entry] a = A2 | b = B1
[entry] pid = 306054            ← 进程未重启
--- 只改 dep-b.mjs ---
[dep-a] EVAL #3 ... [dep-b] EVAL #3 ... [entry] EVAL #3 ...
[entry] a = A2 | b = B2
```

同一实测中 `import.meta.hot` 在运行时为 `undefined`（见 §6）。

### 4.3 `mock.module()`

`bun:test` 的 `mock.module(specifier, factory)` 可替换后续 import 该说明符的结果。实测：

```text
第一次静态 import => real
[mock factory] 被调用
mock 之后再 import => mocked
第三次 import 同一实例? true
```

文档记载它是共享项：对之后加载的模块生效，已加载的实例不变（`Bun.ModuleGraph` 文档 "What is shared" 一节）。适用范围是测试运行。

### 4.4 2026-09-30 补充：`require.cache` 对 ESM 生效

来源：开发者本机笔记 `~/CodeRepository/notes/2026-09-30-hmr-module-unload-and-isolation.md` §12.2（仓库外），以及 w00017 t26 的复测与扩展实验（[`inproc-probe/`](../../../../.agents/works/w00017-application-runtime-architecture/tasks/t26-platform-architecture-redesign/evidences/inproc-probe/output.txt)）。环境 Bun 1.4.2，Linux。

| 做法（每次求值约 8MB） | 结果 |
|---|---|
| 每次复制到新路径再 import（换 specifier） | 40 次后留存 305.3MB，每次 +7.63MB，线性增长 |
| 固定路径，import 后 `delete require.cache[path]` 再 import | 40 次后留存 7.7MB；`stamp` 每轮不同，确为重新求值 |
| 插件目录含入口与懒加载分块，两个版本交替启用、禁用与升级；每次先撤回宿主注册表中的插件函数，再删除 `require.cache` 中该目录下的全部键 | 40、160 次后留存 7.7–15.4MB（一到两份），不随次数增长 |
| 只删 `require.cache`、不撤回宿主注册表中的插件函数 | 内存不下降，插件闭包仍被宿主引用 |

要点：

- `require.cache` 的键包含 `import()` 加载的 ESM 路径，可以按插件安装目录前缀枚举并删除；不需要 `--expose-internals`。`globalThis.Loader` 在 Bun 1.4.2 不存在。
- 回收的前提是宿主不再持有插件交出的任何对象。
- 留存的一到两份不随次数增长，从现象推断与 JSC 的保守式栈扫描有关，未验证。
- 这是未文档化行为，未找到官方文档保证。

## 5. `Bun.ModuleGraph`

### 5.1 来源与状态

- 上游文档：`oven-sh/bun` 的 `docs/runtime/module-graph.mdx`，正文首行标注 `` `Bun.ModuleGraph` is experimental ``。
- 落地提交：2026-09-17 进入 main（GitHub API：`docs/runtime/module-graph.mdx` 首次提交 `0d3492e35`，标题 "Bun.ModuleGraph: a context per graph for timers and I/O, per-graph CommonJS (#42590)"）。
- 发布状态：2026-09-28 实查 npm `bun` 的 `dist-tags` 为 `latest: 1.4.2`、`canary: 1.4.2-canary.20260927.1`；本机稳定版 1.4.2 中 `typeof Bun.ModuleGraph === "undefined"`，canary 包（二进制自报 1.4.3）中存在。
- API 面：`new Bun.ModuleGraph(options?)`、`graph.import(specifier)`、`graph.run(fn, ...args)`、`graph.dispose()`、`Bun.ModuleGraph.current`；`options` 含 `globals` 与 `onError`。

### 5.2 语义（官方文档）

- 每张图有自己的模块级状态（顶层绑定、类、闭包）、自己的模块注册表、自己的 `require.cache`、自己的 `import.meta`、自己的一套 `globals` 值。
- 共享：`globalThis`、`process`（除非通过 `globals` 替换）、内建模块、intrinsic、原生 addon、事件循环。「it is not a sandbox」。
- 图有自己的定时器与 I/O 上下文，且该上下文随代码异步传播（类似 `AsyncLocalStorage`）：图内代码开的 timer、`Bun.serve` / `Bun.listen` 服务、socket、`fetch()`、WebSocket、watcher、子进程（含 `Bun.$`）、worker、数据库连接、`Bun.file().writer()` / `bun:sqlite` / `node:sqlite` 打开的文件、以及图内代码再建的图，都归属该图。
- `graph.dispose()` 关闭上述全部，并丢弃该图的模块注册表与 `require.cache`；此后 `graph.import()` / `graph.run()` / 图的 `require()` 以 `ERR_INVALID_STATE` 失败。
- `dispose()` 是终止语义：不触发 `close` / `onExit` / `'error'`；在途 `fetch()`、连接、`import()` 的 promise 不 reject 而是永不 settle；已缓冲未写的数据丢弃。
- 未覆盖的部分（文档列出）：`node:quic` 端点、脚本自己持有的 fd、同步调用（`Bun.spawnSync`、`fs.writeFileSync` 会执行完）、共享 `http.globalAgent` 的请求、共享对象上的监听器（活过 `dispose()`）。
- 错误归属：未捕获异常与未处理拒绝进入该图的 `onError`，不进进程级处理器。

### 5.3 实测

环境：canary 二进制（自报 Bun 1.4.3），Node 无关。

```text
Bun 1.4.3 | typeof Bun.ModuleGraph = function
[tenant] EVALUATED (globalThis.__evals=1) marker=474fd4
[tenant] EVALUATED (globalThis.__evals=2) marker=b70726
同图内两次 import 同实例? true
两图是不同模块实例? true | marker 不同? true
g1.bump()= 1 g2.bump()= 1 g1.bump()= 2          ← 模块级状态按图隔离
dispose 后 g1.import => ERR_INVALID_STATE | g1.run => ERR_INVALID_STATE
[tenant] EVALUATED (globalThis.__evals=3) marker=6fa7ef   ← 新建图重新求值
[timer.mjs] 在图的上下文里起了 setInterval
dispose 前后 ticks: 4 -> 4 | 图里的定时器已随图关闭? true   ← 资源随图回收
```

`globalThis.__evals` 跨图累加，与文档「`globalThis` 共享」的表述一致。

## 6. `import.meta.hot` 的分布

- Bun 运行时：`bun --hot entry.mjs` 下 `import.meta.hot` 为 `undefined`（实测，Bun 1.4.2）。官方 watch-mode 文档记载「Support for Vite's `import.meta.hot` is planned」。
- Bun 全栈开发服务器（浏览器侧）：实现了 Vite 风格的 `import.meta.hot`，官方 bundler 文档给出 API 状态表：`accept` 可用、`data` 可用、`dispose` 可用、`on` / `off` 可用、`decline` 为 no-op、`prune` 标注为进行中（回调当前不会被调用）、`invalidate` 与 `send` 不可用。该 API 的调用需写成 `import.meta.hot.<api>()` 的直接形式，以便生产构建做 dead-code elimination。

## 7. 未验证边界

- 未在 Windows 验证任何一项。
- 未验证与 Nuxt / Nitro / tsdown 打包产物组合后的模块缓存行为；打包可能改变模块图的形状，从而改变 `loadCache` 中出现的 URL 集合。
- 未验证 `node-addon-require-builtin` 的实际可用性与构建要求。
- 未验证 `Bun.ModuleGraph` 在多线程 / worker 场景与原生 addon 交互下的行为。
- 未验证 `Bun.ModuleGraph` 在后续正式版本中的 API 稳定性；当前仅存在于 canary，文档标注 experimental。
- 未在 Bun 上验证 `bun --hot` 对 CJS 与 `node_modules` 的具体处理；`node_modules` 排除来自官方文档而非实测。

## 8. 复现步骤

Node（v26.10.0 实测）：

```sh
mkdir /tmp/probe && cd /tmp/probe
printf "console.log('[mod] evaluated')\nexport const marker = Math.random()\n" > mod.mjs
# 同 URL 缓存与 query 破缓存
node -e "const a=await import('./mod.mjs');const b=await import('./mod.mjs');const c=await import('./mod.mjs?x=1');console.log(a===b,a===c)"
# 私有 loadCache 驱逐后重新求值
printf "import {createRequire} from 'node:module'\nconst r=createRequire(import.meta.url)\nconst l=r('internal/modules/esm/loader').getOrInitializeCascadedLoader()\nconst m1=await import('./mod.mjs')\nconst u=[...l.loadCache.keys()].find(u=>u.endsWith('/mod.mjs'))\nMap.prototype.delete.call(l.loadCache,u)\nconst m2=await import('./mod.mjs')\nconsole.log('same?',m1===m2)\n" > probe.mjs
node --expose-internals probe.mjs      # 驱逐生效
node probe.mjs                         # MODULE_NOT_FOUND（internal 不可达）
# CJS
printf "console.log('[cjs] evaluated');module.exports={n:Math.random()}\n" > cjs.cjs
node -e "const a=require('./cjs.cjs');delete require.cache[require.resolve('./cjs.cjs')];const b=require('./cjs.cjs');console.log(a===b,a.n!==b.n)"
```

Cordis HMR：

```sh
mkdir /tmp/hot && cd /tmp/hot
npm i cordis@4.0.0-rc.10 @cordisjs/plugin-hmr @cordisjs/plugin-loader \
      @cordisjs/plugin-include @cordisjs/plugin-timer @cordisjs/plugin-logger-console
# cordis.yml: logger-console + timer + hmr(root: ['.']) + './hello.mjs'
node --expose-internals node_modules/cordis/bin.js   # 保存 hello.mjs 观察重新求值
node node_modules/cordis/bin.js                       # 观察源码 HMR 被禁用的警告
```

Bun：

```sh
# 稳定版：ModuleGraph 与 import.meta.hot 均不存在
bun -e 'console.log(typeof Bun.ModuleGraph, typeof import.meta.hot)'
# --hot 的整图重跑
mkdir /tmp/bhot && cd /tmp/bhot   # entry.mjs import './dep-a.mjs' 与 './dep-b.mjs'，各自用 globalThis 计数
bun --hot entry.mjs               # 保存任一文件后观察全部模块重新求值、pid 不变
# ModuleGraph（需要 canary）
mkdir /tmp/bcanary && cd /tmp/bcanary
npm i bun@1.4.2-canary.20260927.1 && (cd node_modules/bun && node install.js)
./node_modules/.bin/bun --version && ./node_modules/.bin/bun -e 'console.log(typeof Bun.ModuleGraph)'
```

外部文档来源：

- `https://bun.com/docs/runtime/watch-mode`
- `https://bun.com/reference/bun/ModuleGraph`
- `https://raw.githubusercontent.com/oven-sh/bun/main/docs/runtime/module-graph.mdx`
- `https://bun.com/docs/bundler/hot-reloading`
- `https://api.github.com/repos/oven-sh/bun/commits?path=docs/runtime/module-graph.mdx`

外部源码：`deepseek-harness/vendor/hmr/src/index.ts`、`deepseek-harness/vendor/loader/src/internal.ts`、`deepseek-harness/vendor/README.md`
