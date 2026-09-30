# DSH 插件两端结构与依赖处理调研（只读，以源码为准）

调研对象是 `/home/notnotype/CodeRepository/deepseek-harness`，HEAD 为 `21638c5631`。下文路径都相对该仓库根。证据等级分三种：【源码】【文档】【推断】。本次没有修改任何仓库文件，也没有运行 DSH。

## 1. 结论

1. **DSH 没有“插件 A 依赖插件 B”这种激活依赖。** 决定激活的只有 cordis `inject`，依赖的是服务名。每一端在自己的代码里声明，在自己的内核里解析。清单里唯一的包名依赖边是 `dsh.client.inject`，只在浏览器端存在，类型注释写的是 “Informational package-name dependencies, not Cordis service injection”。它实际只用于浏览器端的工厂到达顺序和 HMR 比对；目标行不在图里就静默跳过。【源码】
2. **一个包的两端是两个独立的 cordis 插件。** Node 端来自 `"."` 导出，有自己的 `apply`、`inject`，可以有 `Config`；浏览器端来自 `exports["./client"]` 的预构建 bundle，有自己的 `apply` 和 `inject`。两边的 inject 可以完全不同。例如 file-upload 的 Host 端 inject 是 `['agents','attachments','commands','connection']`，浏览器端是 `['remote']`。浏览器 entry 只用 `{ name: 包名 }` 创建，拿不到 Host entry 的配置。【源码】
3. **只有浏览器部分的插件仍要带一个 Node 端**，写一个空 `apply()`，这样它才能作为 Host Loader entry 出现。71 个带 `dsh.client` 的包里有 44 个 Node 端是空 apply（脚本统计，属推断）。只有服务端部分的插件就是不声明 `dsh.client` 的普通包。只有 `./client` 导出不算浏览器插件。【源码】
4. **启用和停用的身份在 Host 端。** 安装单位是 bundle，启停单位是 Host Loader entry id。浏览器行由 client-modules 从“未禁用且已有 fiber 的 Host entry”派生，按包名标识，经 HMR 推到每个打开的页面。浏览器端失败只算页面本地状态，不回写 Host 的启用状态。【源码】
5. **两端失败基本互不牵连，只有一处单向耦合。** Host 端 import 失败时没有 fiber，浏览器行就不发布。Host 端停在 PENDING 或 FAILED 时 fiber 还在，浏览器行照常发布并独立激活。浏览器端失败不影响 Host。【源码；PENDING 和 FAILED 的情形是推断】
6. **两端对“依赖缺失”的严格程度不一样。** Host 端非必需 entry 停在 PENDING 只告警。Web 首次启动要求所有浏览器 entry 都激活，任何一个 PENDING，页面就停在启动页，整个 UI 不挂载。启动后经 HMR 新增的行即使 PENDING，也只在插件列表里显示为页面本地失败。【源码与文档】
7. **浏览器使用服务端能力，靠的是本端代理服务，不是激活依赖。** api-remotes 的浏览器端把各包的 `/remote` 描述符挂成 `remote.<ns>` 服务。这些服务在浏览器本地创建，不检查 Host 服务在不在线。Host 服务缺席时，调用会返回 `gateway/service-unavailable` 或 `gateway/invocation-unavailable`，由调用方自己降级。【源码】
8. **同一个服务名在两端用不同实现是常规做法。** `connection` 和 `dynamicCordisRunner` 两端实现不同；`typert` 两端是同一个类的不同实例。消费者只在本端内核里按名字解析。【源码】

## 2. 插件包的两端结构

### 清单、入口与构建
- `DshClientManifest` 的字段：`platform`（必填，Web 端只认 `web`）、`inject?`（包名数组，仅信息性）、`immediately?`、`external?`。见 `packages/util/package-manifest/src/types.ts:80-94`。【源码】
- Host 扫描逻辑在 `resolveMeta`（`packages/client/modules/src/index.ts:836-848`）。它读取包的 `dsh.client`；`platform` 不是 `web` 就视为非客户端包；声明了 `dsh.client` 却没有 `exports["./client"]` 会直接抛错。【源码】
- Node 端入口由 Host Loader 按 patch 行 `name: '<包名>'` 导入，例如 `packages/bundle/web-app/cordis.patch.yml:226-227`、`293-294`、`374-375`。浏览器端入口是 `lib/client.js`，执行时只注册工厂，首次 import 才求值（`packages/client/modules/src/client/manifest.ts:9-24`）。
- 两端分开构建：根目录 `package.json` 里有 `build:lib:host` 和 `build:lib:client` 两个脚本；两端的 externals 各自决定（`packages/client/AGENTS.md:67`）。

### 两端各是一个 cordis 插件（真实例子）

| 包 | Node 端 | 浏览器端 |
|---|---|---|
| dsh-client-file-upload | `static inject = ['agents','attachments','commands','connection']`（`src/index.ts:58`） | `inject = ['remote']`（`src/client/index.ts:18`） |
| dsh-api-remotes | `inject = ['typertGateway']`，登记转发事件源（`src/index.ts:37-45`） | `inject = ['remote']`，依次 `$mount` 各包的 Remote 描述符（`src/client/index.ts:169-198`） |
| dsh-api-gateway | `static inject = ['typert']`（`src/index.ts:199`） | `inject = ['typert','connection']`（`src/client/index.ts:134`） |
| dsh-client-ui-settings-models | 有 `Config`；apply 经 `webserver/index-inject` 把配置写成页面全局变量（`src/index.ts:13-20`） | inject 包括 `slots`、`locale`、`remote.llm`、`remote.credentials` 等（`src/client/index.ts:67-70`），从页面全局变量读配置（`:79-80`） |

- **配置传递**：浏览器 entry 在 `ClientEntries.create` 里以 `{ name: id }` 创建（`packages/client/modules/src/client/entries.ts:167-175`），既不带 config，也不带 entry 级 inject。所以浏览器端的 `Config` 只能用默认值，例如 `packages/client/ui-conversation/src/client/apply.ts:152`。需要 Host 配置时，由 Node 端主动发布，做法见上表的 ui-settings-models。【源码】
- **Loader entry 级 inject**：配置层可以给 entry 追加 inject（`vendor/loader/src/config/entry.ts:21-22`，合并点在 `vendor/loader/src/index.ts:129-135`），例如 `connection` 行写了 `inject: [webRuntime]`（`packages/bundle/web-app/cordis.patch.yml:215-217`）。它只作用于 Host fiber；这一点是从浏览器 create 不带 inject 推断出来的。

### 三类插件各举例
- **两端都有**：上表四个，另有 dsh-client-connection、dsh-client-locale、dsh-client-modules 等。
- **只有浏览器部分**：
  - dsh-client-ui-goal：`src/index.ts:1-9` 的注释原文是 “the empty apply exists so the plugin appears in the host cordis.yml / Loader”。
  - dsh-client-ui-renderer：Node 端也是空 apply；浏览器端提供 `slots` 服务（`src/client/registry.ts:160`）。
- **只有服务端部分**：
  - dsh-llm：没有 `./client` 导出，也没有 `dsh.client`。
  - dsh-attachment：提供 `attachments` 服务（`src/index.ts:55`）。
  - dsh-goal：有 `./client` 导出，但那只是类型出口（`src/client.ts:1-5`），没有 `dsh.client`，所以不是浏览器插件。`packages/client/AGENTS.md:63` 也写明 “a `./client` export alone does not select dependency policy”。

## 3. 依赖的声明层次与各端独立性

`packages/client/AGENTS.md:85-97` 有一张对照表，明确说三种声明互相不能替代。

### 第一层：cordis `inject`（激活依赖）
- 单位是服务名，写成数组或 `{name: interceptConfig}`。`Inject.resolve` 把每一项都放进 `fiber.inject`（`vendor/cordis/src/registry.ts:12-19`、`71-88`）。
- vendored cordis 里的 inject 只有“必需”一种，没有 `required: false` 之类的字段。只要有一个服务缺失，`_refresh` 就把 epoch 设为 INACTIVE，fiber 进入 PENDING（`vendor/cordis/src/fiber.ts:611-623`、`574-579`）。【源码】
- 可选依赖的写法有两种：
  - 在插件内部开子插件 `ctx.inject([...], cb)`，例如 client-modules 的 Node 端写了 `ctx.inject(['webServer'], registerWebCarrier)`（`packages/client/modules/src/index.ts:653`）；`@Inject` 方法装饰器也是这个机制（`registry.ts:45-55`）。
  - 运行时用 `ctx.get()` 取服务。
- 插槽级等待：用 `ctx.slots.inject(name, …)` 等某个插槽被声明，而不是给业务服务加 inject（`packages/client/AGENTS.md:145`）。【文档】

### 第二层：`dsh.client.inject`（包名边，只在浏览器层）
- 类型注释写的是 “Informational…not Cordis service injection”（`types.ts:84-85`）。新包清单也写明 “informational only… do not sequence entry activation”（`packages/client/AGENTS.md:144`）。
- 实际用途有两处【源码】：
  - 浏览器端 `arriveGraphRow` 在注册本行工厂前，先让这些包的工厂到达；图里没有该行就跳过（`packages/client/modules/src/client/system.ts:268-271`）。
  - `entryTargets` 把它纳入 HMR 比对（`entries.ts:29-31`）。
- Host 端排图只看 `external`，不看 inject（`index.ts:491-533`）。
- 例子：ui-goal 的 `dsh.client.inject` 列了 api-remotes、api-session-controller、ui-chat 等包（`package.json:28-38`）。它真正的激活依赖是 `inject = ['slots','sessions','remote','remote.goals','locale','uiConversation']`（`src/client/index.ts:61`）。

### 第三层：npm 依赖（安装关系，不是激活依赖）
- 规则见 `packages/client/AGENTS.md:60-66`，由 `scripts/verify-package-dependencies.ts` 执行【文档】：
  - Host 端的运行时 value import 放进 `dependencies`；需要共享身份的放进 `peerDependencies`。
  - 浏览器关系、类型关系和 `dsh.client.inject` 的目标只放进 `devDependencies`。
  - cordis 固定为 peer 依赖。
- 插件管理器在安装前检查 DSH peer 版本是否兼容（`packages/boot/plugin-manager/README.md:63`）。这是兼容性检查，不影响激活。【文档】

### 插件级依赖
不存在。`DshManifest` 只有 `bundle`、`profile`、`client` 三个角色字段（`types.ts:30-39`）；在 plugin-manager 和 package-manifest 里 grep `dependsOn`、`pluginDependencies`、`requiredPlugins` 都没有结果。【源码】

### 浏览器端如何使用其它插件的浏览器部分
- **用服务**：按服务名 inject。例如 ui-goal 使用 ui-conversation 提供的 `uiConversation` 和 ui-renderer 提供的 `slots`。
  - 类型靠 `import type {} from '<pkg>/client'` 拉取模块增强。这种导入会被擦除，不产生模块请求（`packages/client/ui-goal/src/client/index.ts:14-29`；`packages/client/modules/README.md:46`）。
- **用模块值**：只能通过 `dsh.client.external` 请求另一个动态包行，或请求 `PLATFORM_MODULES` 里的静态键（`packages/client/modules/README.md:44-46`）。
  - 规范限定只有基础设施、传输层或生成的装配代码可以这样做（`packages/client/AGENTS.md:79`）。
  - 目前有 5 个包使用它，请求的全是 `@deepseek-ai/dsh-api-gateway/client`。

### 浏览器端如何使用服务端能力
- **本地挂载**：各领域包导出 `/remote` 描述符，api-remotes 的浏览器端逐个 `$mount`（`packages/api/remotes/src/client/index.ts:4-28`、`179-188`）。gateway 客户端为每个 namespace 在本地建一个 `remote.<ns>` 服务 fiber（`packages/api/gateway/src/client/index.ts:348-366`，服务键在 `:752-753`）。
- **不和 Host 握手**：所以浏览器插件 inject `remote.llm` 时，等的只是浏览器本地挂载，不等 Host 上的 llm 服务。
- **调用时才解析 Host 服务**：`receiverContext.get(descriptor.service)` 取不到就返回 `gateway/service-unavailable`（`packages/api/gateway/src/index.ts:694-700`）；没有描述符就返回 `gateway/invocation-unavailable`（`:771-772`）。
- **降级由调用方负责**，例如：
  - ui-agent-preset 把 `invocation-unavailable` 当作“可选服务不在”，返回空列表（`packages/client/ui-agent-preset/src/client/settings-store.ts:62-65`）。
  - 文档预览把这两种错误码都转成“不可用”提示（`packages/client/ui-sidebar-documentpreview/src/client/office/index.ts:106-107`）。

## 4. 解析、失败与跨端状态同步

### 某一端缺服务时
**Host 端**：fiber 停在 PENDING，没有超时；服务出现后按 epoch 自动激活。
- 启动审计：非必需 entry 只告警；7 个必需 id（agent-loop、webserver、modules、connection 等）任一失败，就抛 StartupError 并退出（`packages/boot/app-boot/src/index.ts:746-754`、`824-862`；README `:43`、`:92`）。
- 通过插件管理器启用：之后会跑 `reconcileProfilePatches`；被显式启用的目标如果没激活，操作以诊断失败（`index.ts:273-296`；plugin-manager README `:94`、`:145`）。

**浏览器端**：
- Web 首次启动时，`bootClient` 在 `loader.await()` 之后调用 `assertEntriesActive`。任一 entry 出现以下情况就抛错，页面停在启动页，`mountClient` 不会执行：
  - import 失败；
  - 停在 PENDING（报错里列出缺失的服务）；
  - 其它非 ACTIVE 状态。
- 出处：`packages/client/web/src/boot-client.ts:36-88`、`boot.ts:173-190`；README `:123` 原文是 “partial UI availability is not supported”。
- 启动后新增的行由 `ClientEntries.reconcile` 处理，PENDING 记为页面本地失败 “waiting for activation”，可以重试（`entries.ts:232-243`；测试 `tests/entries.client.spec.ts:232-241`）。

### 另一端受不受影响
- **Host import 失败**：`Entry._init` 捕获错误后不设置 fiber（`vendor/loader/src/config/entry.ts:221-235`）。client-modules 只收录 `entry.fiber !== undefined && !entry.disabled` 的行（`packages/client/modules/src/index.ts:984`），所以这时浏览器行不会出现。【源码】
- **Host 端 PENDING 或 FAILED**：fiber 已经存在，浏览器行照常发布，浏览器端独立激活。【推断：依据是上面两处源码；没有找到覆盖这种情形的测试】
- **浏览器端失败**：`entries.ts:9` 的注释写着 “Page-local failures do not change the Host's bundle enablement”。README 也说插件列表提供重试，且不改 Host 的启用状态（`packages/client/modules/README.md:42`）。【源码与文档】
- **对照：模型定义的动态包**（不是安装的插件）走另一条路径。它先跑 Host 端，Host 端失败就不取浏览器代码（`packages/extensions/cordis-client-runner/src/client/orchestrator.ts:333-342`）；浏览器端通过 `host.call` 只能调用自己包的 Host 端（该包 README `:32`）。

### 启停同步与身份
- **安装与启停单位**：安装单位是 bundle，由 `dsh.bundle.patch` 声明它包含的行。整个 bundle 的选中与取消改的是 `dsh.profile.bundles`；单行启停只改 profile 的 `cordis.patch.yml` 里该 entry id 的 `disabled`（plugin-manager README `:40`）。
- **从 Host 同步到页面的链路**【源码】：
  1. Host entry 的 fiber 每次建立或销毁都会触发 `internal/plugin`。client-modules 把该包标脏，在微任务里重算它的浏览器行（`index.ts:624-634`、`981-1049`）。同一个包名来自两个活跃 Loader 源时，报组合错误（`:1026-1033`）。
  2. 图变更通过 `onGraphChanged` 推给 dsh-client-hmr（`packages/client/hmr/src/index.ts:195`）。
  3. 浏览器端执行 `entries.sync(frame.graph)`（`packages/client/hmr/src/client/index.ts:22`）。被移除的行先 `loader.remove`，再等 fiber 清理完（`entries.ts:200-209`）。
- **身份链**：bundle 管安装，Host Loader entry id 管启停，包名作为浏览器行和页面 entry 的名字。浏览器端没有独立的启停开关。
- 每个页面执行 `new Context()`，各自一个内核（`packages/client/web/src/boot.ts:169`）。
- 替换已安装包的版本需要重启进程（plugin-manager README `:130`）。

## 5. 与已有 NeuroBook 调研不一致的地方

对照文件：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/docs/research/cordis-plugin-kernel.md`

1. **“客户端”小节说外部依赖“只能解析到外壳冻结的共享模块表 PLATFORM_MODULES”，这不准确。** 实际解析顺序是：seed 表、已物化记录、图中的包行、已注册工厂（`manifest.ts:18-21`）。`dsh.client.external` 可以请求另一个动态包行，目前有 5 个包在用。PLATFORM_MODULES 只是隐式基线。
2. **同一处说“Host 扫描已启用的 Loader entry”，少了一个条件。** 还要求该 entry 已有 fiber，也就是 Node 端 import 成功（`index.ts:984`）。这也说明只有浏览器部分的包必须带一个能导入的 Node 端。
3. **有三处遗漏，会影响“依赖在哪一层声明”的判断**：
   - `dsh.client` 还需要 `platform: 'web'`；
   - `dsh.client.inject` 存在，但不决定激活；
   - 浏览器 entry 拿不到 Host 配置。
4. **“依赖缺失时停在 PENDING、无错误输出”对 cordis 本身成立，但在 DSH 里两端都另有审计**：Host 启动时告警或抛 StartupError，Web 首次启动直接失败（见第 4 节）。用它描述 DSH 行为时需要补上这一层。
5. **“cordis 核心可在浏览器运行，未验证”可以更新。** 源码已确认浏览器端执行 `new Context()`、`ctx.plugin(Loader)`、`loader.internal = modules`（`boot.ts:169`，`boot-client.ts:38-40`）。仍然没有做运行验证。
6. **“未验证浏览器端 @cordisjs/plugin-hmr 是否存在”可以回答。** 浏览器页面同步走的是 dsh-client-hmr 加 `ClientEntries`，不是 cordis 的 plugin-hmr。
7. **“启用与停用可在打开的页面上即时同步”需要补一个限定。** 在默认 Web 组合下成立（web-app bundle 里常驻 `client-hmr` 行，`cordis.patch.yml:201-202`）。但 Host 侧配置热应用依赖 `dsh-hmr`，base bundle 只在有 profileContext 时启用它（`packages/bundle/base/cordis.patch.yml:28-32`）；没有 HMR 时需要重启（plugin-manager README `:14`）。

## 6. 对 NeuroBook 问题的启示

### DSH 的做法能直接说明的
- **回避跨端误判**：依赖挂在“插件整体”上会造成跨端误判，DSH 的回避方式是根本不设插件级激活依赖，每一端按服务名各自 inject、各自在本端解析。照 DSH 的写法，文生图的服务端写 `inject: ['models']`，浏览器端写 `inject: ['editor']`，各等各的，不会因为另一端的依赖缺失而被判缺失。
- **依赖声明的位置**：DSH 两端的依赖表写在各自的代码里（模块导出的 `inject`），不在清单里。清单里的包名边只做信息展示和到达顺序，不参与激活。
- **浏览器使用服务端能力**：DSH 不把“服务端服务在线”当作浏览器端的激活条件。它在浏览器挂本地代理服务，服务端不在时让调用失败，由调用方降级。
- **单一身份**：身份可以只由一端持有。DSH 用 Host Loader entry 作为启停身份，浏览器端完全派生；只有浏览器部分的插件用一个空 Node 端占位。
- **两端失败语义可以不同**：DSH 的 Web 首次启动是全有或全无，Host 端是尽力而为。

### DSH 不能说明的
- 按端细分的清单级插件依赖表是否可行、是否更好：DSH 没有这类机制，既无正例也无反例。
- 安装或启用时的静态依赖判定：DSH 里缺依赖只在运行时表现为 PENDING；静态校验只有构建期脚本对 `dsh.client.inject` 和 `external` 的检查。
- “浏览器端依赖某插件的服务端部分”怎样表达成激活依赖：DSH 只有调用期失败，没有这种表达。
- 服务键模型：DSH 每端一个全局字符串服务名空间，没有服务键归属、版本或受信登记，和 NeuroBook 现有的 `ServiceKey<T>` 合同不同，不能直接套用。
- 第三方插件的信任与配置：DSH 安装的插件在进程内运行、没有沙箱，浏览器端也不接收 Loader 配置。这些是 DSH 自己的取舍，不代表 NeuroBook 应该怎么做。
- “Host 端 PENDING 时浏览器端照常加载”只有源码推断，没有测试覆盖。

## 7. 证据清单

以下路径都相对 deepseek-harness 根，commit `21638c5631`。

**清单与扫描**
- `packages/util/package-manifest/src/types.ts:30-39,80-94`
- `packages/client/modules/src/index.ts:597,624-657,836-848,984,1021-1049`
- `packages/client/modules/src/client/manifest.ts:9-24,44-68,99-133`
- `packages/client/modules/src/client/system.ts:246-272`
- `packages/client/modules/src/client/entries.ts:9,29-31,69-85,167-175,192-246`
- 测试 `packages/client/modules/tests/entries.client.spec.ts:232-241`

**浏览器启动**
- `packages/client/web/src/boot.ts:160-190`
- `packages/client/web/src/boot-client.ts:36-88`
- `packages/client/web/README.md:12,68,74,123`

**cordis 与 Loader**
- `vendor/cordis/src/registry.ts:12-19,37-60,71-88`
- `vendor/cordis/src/fiber.ts:574-579,597-639`
- `vendor/loader/src/config/entry.ts:10-23,109-155,221-235`
- `vendor/loader/src/index.ts:129-135`

**Host 审计与插件管理**
- `packages/boot/app-boot/src/index.ts:273-296,746-754,824-862`
- `packages/boot/app-boot/README.md:43,92`
- `packages/boot/plugin-manager/README.md:14,40,63,94,130,145`

**跨端调用**
- `packages/api/remotes/src/index.ts:37-45`
- `packages/api/remotes/src/client/index.ts:4-28,161-198`
- `packages/api/gateway/src/client/index.ts:134,202-210,348-366,752-753`
- `packages/api/gateway/src/index.ts:199,694-700,771-772`
- `packages/client/ui-agent-preset/src/client/settings-store.ts:62-65`
- `packages/client/ui-sidebar-documentpreview/src/client/office/index.ts:106-107`

**例子包**
- `packages/client/file-upload/src/index.ts:58`
- `packages/client/file-upload/src/client/index.ts:18`
- `packages/client/ui-goal/src/index.ts:1-9`
- `packages/client/ui-goal/src/client/index.ts:14-29,61`
- `packages/client/ui-goal/package.json:21-38`
- `packages/client/ui-settings-models/src/index.ts:13-20`
- `packages/client/ui-settings-models/src/client/index.ts:67-80`
- `packages/client/ui-renderer/src/index.ts`
- `packages/client/ui-renderer/src/client/registry.ts:160`
- `packages/goal/goal/src/client.ts:1-5`
- `packages/attachment/attachment/src/index.ts:55`

**同名服务**
- `packages/client/connection/src/rpc-host.ts:80` 对应 `packages/client/connection/src/client/index.ts:310`
- `packages/extensions/cordis-host-runner/src/index.ts:145` 对应 `packages/extensions/cordis-client-runner/src/client/index.ts:291`
- `packages/typert/registry/src/service.ts:456` 对应 `packages/typert/registry/src/client/index.ts:4,14`

**动态包**
- `packages/extensions/cordis-client-runner/src/client/orchestrator.ts:333-342`
- `packages/extensions/cordis-client-runner/README.md:32`
- `packages/extensions/cordis-host-runner/README.md:46`

**规范文档**
- `packages/client/AGENTS.md:60-67,79,85-97,142-145`
- `packages/client/modules/README.md:34-46`
- `docs/subsystems/client-modules.md`：“The wire”“The scan”两节

**Web 组合配置**
- `packages/bundle/web-app/cordis.patch.yml:201-227,293-294,374-375`
- `packages/bundle/base/cordis.patch.yml:28-32`

**计数（推断）**
用 python 遍历 `packages/*/*/package.json`：带 `dsh.client` 的包 71 个，其中 44 个的 `src/index.ts` 是空 `apply()`；声明了 `external` 的有 5 个。
