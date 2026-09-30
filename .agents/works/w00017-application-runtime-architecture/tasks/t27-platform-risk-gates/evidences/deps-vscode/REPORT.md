# VS Code 扩展运行位置与跨宿主依赖调研报告

证据基线：`microsoft/vscode` 主分支 **9666ca8**（2026-09-30），`microsoft/vscode-docs` 主分支 **250ea55**。另用了两个官方实例仓库：`vscode-js-debug` **bccbbaf**、`vscode-js-debug-companion` **da581f8**。正文用 `[E#]`、`[D#]`、`[X#]` 引用第 7 节的证据清单。证据等级分三种：【源码】【文档】【推断】。

## 1. 结论

1. **在一个窗口里，一个扩展只落在一个宿主上，VS Code 没有"一个扩展两端各跑一份"的模型。**【源码】
   - 运行位置表是"扩展 id → 单个位置"的映射。扩展在本地和远端都装了，也只挑一个位置运行 [E3 L21] [E7 L535-537]。
   - `main` 和 `browser` 是同一扩展面向 Node 与 WebWorker 两种运行时的**二选一入口**，不是同时运行的两部分 [E4] [D1 L54] [D4 L75]。
   - 所以 NeuroBook 的"一个插件同时有服务端和浏览器两部分"在 VS Code 里没有直接对应物。
2. **`extensionDependencies` 只是 `publisher.name` 字符串数组。**【源码】
   - 标识符正则只允许 `publisher.name`，没有版本范围 [E16]。
   - 没有端限定，也没有按宿主区分的写法 [E15 L476-484]。
3. **依赖只在依赖者所在的宿主里解析。**【源码】
   - 依赖在另一个宿主时，除非被依赖方声明了 `"api": "none"`，否则直接报错："Cannot activate the 'X' extension because it depends on unknown extension 'Y'"，依赖者不激活 [E8 L296-320]。
4. **跨宿主依赖只有一个官方通道：被依赖方声明 `"api": "none"`。**【源码+文档】
   - 这是被依赖方的整体属性，不是某条依赖边的属性。
   - 效果：依赖者的激活会经主线程等待另一个宿主里的依赖激活完成；代价是依赖方放弃导出 API，双方只能靠命令通信，参数经 JSON 序列化 [E8 L287-293] [E10 L191-195] [D2 L130-134, L396-406]。
5. **安装、启用、激活三层各自处理跨端问题。**【源码】
   - 安装：按**依赖自身**的 extensionKind 决定装到本地还是远端 [E14]。
   - 启用：只有"同一个管理服务器上的依赖"或"`api: none` 的依赖"被禁用时，才连带禁用依赖者 [E13 L606-640]。
   - 激活：按上面第 3、4 条处理。
6. **一个功能既要 UI 侧又要工作区侧代码时，官方做法是拆成多个扩展，用命令通信。**
   - 文档没有写"拆成两个扩展"这句话，但给了跨宿主依赖加命令通信的方法【文档】[D2]。
   - 官方实例：js-debug（`workspace`）配 js-debug-companion（`ui` + `api: none`），两者都内置随产品发布，靠命令通信【源码/实例】[X1][X2][X3]。
   - extension pack 只解决"一起安装"。文档明确说 pack 不应与成员有功能依赖 [D3 L282]。
7. **其他能细化依赖粒度的机制都是 proposed API，不能发布到市场。**【源码】
   - `extensionAffinity`：让扩展与指定扩展在同类宿主内同进程运行。
   - `extensionsAny`：`getExtension` 能看到其他宿主里的扩展，但 `exports` 恒为 `undefined`，`activate()` 直接抛错 [E3 L125-149] [E11] [E17] [E15 L244]。
   - `capabilities`、`targetPlatform` 与依赖粒度无关。
8. **远端扩展宿主也是每个窗口一个进程**：服务器按连接 fork 一个宿主【源码】[E18]。这与 NeuroBook"服务端一个内核实例、多个窗口共享"不同。

## 2. 运行位置模型

**宿主种类。**【源码+文档】
- `ExtensionHostKind` 有三种：`LocalProcess`（本地 Node）、`LocalWebWorker`（浏览器 WebWorker）、`Remote`（远端 Node）[E1 L9-13]。
- 运行位置在种类之外还带 `affinity` 编号。本地 Node 和 WebWorker 可以按 affinity 拆出多个同类宿主；远端固定为 affinity 0 [E2]。
- 文档里的可用组合是：桌面版有 local 和 web；桌面加远程有 local、web、remote；vscode.dev 只有 web [D1 L16-29]。

**`extensionKind` 的语义。**【源码+文档】
- 取值为 `ui`、`workspace`、`web`，数组顺序就是偏好顺序。
- 选择器按数组顺序逐项尝试，第一个可行位置立即返回。存在"开发中偏好"时，先收集候选再取第一个 [E4 L706-742]。
- 桌面端 `NativeExtensionHostKindPicker` 的规则：
  - `ui` 且装在本地 → LocalProcess。
  - `workspace` 且装在远端 → Remote。
  - `workspace` 且窗口没有远端 → LocalProcess。
  - `web` 且装在本地、WebWorker 宿主已启用 → LocalWebWorker。
- Web 端 `BrowserExtensionHostKindPicker` 的规则：`ui` 只作为最后手段跑远端，`web` 优先进 LocalWebWorker [E5 L322-356]。
- 以上都不满足时返回 `null`，扩展不运行。
- 文档的表述一致：`["ui","workspace"]` 表示优先本地；`["ui"]` 表示必须靠近 UI [D1 L45-50]。

**未声明 `extensionKind` 时的推导**（`deduceExtensionKind`）。【源码】[E6 L262-316]
- 有 `main` → `['workspace']`（纯 Web 端再加 `web`）。
- 只有 `browser` → `['web']`。
- 没有代码 → 所有 kind，再按贡献点过滤。
- 只有 `extensionPack` 或 `extensionDependencies` → `['workspace']`。
- 用户设置 `remote.extensionKind` 和 product.json 可以覆盖推导结果 [E6 L150-178]。
- 文档补充：能同时跑 Node 和浏览器的扩展，只要有 Node 宿主就选 Node 宿主 [D1 L54]。

**一个扩展只有一个运行位置。**【源码】
- `ExtensionRunningLocationTracker._runningLocation: ExtensionIdentifierMap<ExtensionRunningLocation | null>` 是 id 到单个值的映射 [E3 L21]。
- `determineExtensionHostKinds` 把本地和远端两份描述合并成一个 `ExtensionInfo`，每个 id 只调用一次选择器 [E1 L56-85]。
- 两侧 kind 不一致时，以本地 manifest 为准 [E1 L139-147]。
- 启动流程的注释原文是 "takes care of duplicates and picks a running location for each extension" [E7 L535-537]。
- 位置为 `null` 的扩展不进任何宿主，也不进全局注册表 [E7 L540-554]。

**依赖对位置的影响只在同类宿主内。**【源码】
- `_computeAffinity` 把有依赖关系的扩展并进同一组，保证它们在同一个 LocalProcess 或 WebWorker 进程里 [E3 L103-123]。
- 依赖不在同类候选集里时直接跳过，源码注释是 "probably can't execute, so it has no impact" [E3 L110-113]。
- 选择宿主种类（ui、workspace、web）时**完全不看依赖** [E1] [E4]。

**每个窗口一套宿主。**
- 【推断】`IExtensionService` 以工作台单例注册 [E4 L769]，所以每个窗口各自启动自己的宿主管理器。
- 【源码】远端服务器为每个连接 token 新建一个 `ExtensionHostConnection`，并 `cp.fork` 出一个宿主进程 [E18]。

## 3. 依赖的声明、解析与跨宿主激活

**声明。**【源码】
- `extensionDependencies: string[]`，元素正则为 `^publisher.name$` [E15 L476-484] [E16]。
- manifest 类型里没有任何按宿主区分的依赖字段 [E16 L351-373]。

**安装层。**【源码】
- 在远端安装一个扩展后，`installUIDependenciesAndPackedExtensions` 会递归收集依赖和 pack 成员。
- 其中 `prefersExecuteOnUI` 的装到本地，其余装到远端 [E14 L49-62, L152-213]。
- 也就是说，依赖装到哪里由依赖自己的 kind 决定，与依赖者无关。

**启用层。**【源码】
- `_isDisabledByExtensionDependency` 只把"同一个管理服务器上的依赖"或"有代码且 `api === 'none'` 的依赖"计入。
- 这些依赖被禁用时，依赖者被置为 `DisabledByExtensionDependency`。
- 依赖的状态是 `DisabledByExtensionKind`（只能在别处运行）时，不连带禁用依赖者 [E13 L606-640, 特别是 L612-615 和 L629]。
- 启用一个扩展时，会连带启用它的依赖，但同样跳过 `DisabledByExtensionKind` [E13 L373-376]。

**激活层（每个宿主内的 `ExtensionsActivator`）。**【源码】[E8 L250-343]

每个宿主持有两份注册表：`_registry`（本宿主内的扩展）和 `_globalRegistry`（所有宿主的扩展）。对依赖者的每个 `depId` 依次判断：

1. 依赖在全局注册表里存在，且没有 `main` 或 `browser` → 视为已解析，不等待（纯声明式依赖）[L276-279, L336-343]。
2. 已有对应的激活操作 → 等待它 [L281-285]。
3. 是 **host extension**：本宿主没有它，全局注册表有它，它有代码，且 `api === 'none'`（判定见 [E9 L31-45]）→ 为它建一个激活操作并等待 [L287-293]。
   - 这个操作最终调用 `actualActivateExtension`，经 RPC 调主线程 `$activateExtension` [E10 L191-195]。
   - 主线程 `_activateById` 向**所有**宿主管理器广播 `activate`；没有任何宿主认领时抛出 `Unknown extension` [E7 L1263-1271] [E12 L66-68]。
   - 目标宿主的 `$activate` 只激活自己注册表里有的扩展 [E10 L1040-1048]。
   - 等待结束后，依赖者宿主内得到一个 `HostExtension`（`activationFailed=false`）[E8 L147-151]。
4. 依赖在本宿主内 → 递归激活它 [L296-309]。
5. 以上都不是 → **错误条件 1**：`Cannot activate the '{X}' extension because it depends on unknown extension '{Y}'`，并带上 `MissingExtensionDependency(Y)` 上报；依赖者不激活 [L311-320]。

依赖激活失败时是**错误条件 2**：`Cannot activate the '{X}' extension because its dependency '{Y}' failed to activate`，依赖者不激活 [E8 L402-410]。

**失败语义汇总**

| 情形 | 依赖者宿主内的结果 | 主线程对用户的提示 [E12] |
|---|---|---|
| 依赖同宿主且激活成功 | 依赖先激活，依赖者后激活 | 无 |
| 依赖同宿主且激活抛错 | 错误条件 2，依赖者不激活 | 开发模式弹错，发布版只写 console [L99-105] |
| 依赖在另一宿主，且 `api:none` | 跨宿主等待后激活依赖者 | 无 |
| 同上，但依赖的 `activate()` 在它自己的宿主里抛错 | 【推断】依赖者仍会激活，见表后说明 | 无 |
| 依赖在另一宿主，没有 `api:none` | 错误条件 1，依赖者不激活 | 依赖已装且启用："…depends on the 'Y' extension, which is not loaded. Would you like to reload the window…"（跨宿主时这条提示有误导性）[L113-120] |
| 依赖被禁用 | 不在任何注册表中，走错误条件 1；若同服务器，启用层可能已先禁用依赖者 | "…which is disabled. Enable and Reload" / 受限模式 / 虚拟工作区等变体 [L121-155] |
| 依赖未安装 | 错误条件 1 | 市场能查到时："…which is not installed… Install and Reload"；否则 "depends on an unknown 'Y' extension" [L157-179] |
| 依赖只能在当前窗口没有的位置运行 | 运行位置为 `null`，不进注册表，走错误条件 1 | 同"已装"分支；启用层不连带禁用依赖者 |

表中【推断】一行的依据：目标宿主的 `activateById` 只等待激活操作的 barrier，失败时 barrier 同样会打开 [E8 L379-382, L441]；`$activate` 照常返回 true [E10 L1046-1047]；依赖者一侧拿到的 `HostExtension` 是 `activationFailed=false`。所以跨宿主依赖只保证"已尝试激活"的顺序，不传递失败。

**`vscode.extensions.getExtension(id)` 对其他宿主里的扩展返回什么。**
- 稳定 API 只查本宿主注册表，对另一宿主里的扩展返回 **`undefined`**；`extensions.all` 也只列本宿主的扩展【源码】[E11 L611-632]。
- 启用 proposed `extensionsAny` 后，`getExtension(id, true)` 返回一个 `isFromDifferentExtensionHost=true` 的对象。它的 `exports` 恒为 `undefined`，`activate()` 抛出 `Cannot activate foreign extension`【源码】[E10 L1200-1212] [E17]。
- 同宿主内声明了 `api: none` 的扩展，`exports` 同样是 `undefined` [E10 L1201]。
- 文档原话：exports "will not work between UI and Workspace Extensions" [D2 L398]。

## 4. 官方推荐的拆分模式

- **跨宿主依赖**【文档】[D2 L122-134]
  - 远端扩展依赖本地扩展时，建议仍然声明 `extensionDependencies`。
  - 但被依赖方"must give up entirely the ability to export any APIs by using `"api": "none"`"。
  - 双方通过 VS Code 命令异步通信；依赖者"can still take a dependency on them and will be activated"。
  - manifest schema 对 `api: none` 的说明是："This allows other extensions that depend on this extension to run in a separate extension host process or in a remote machine" [E15 L253-260]。
- **命令通信**【文档】[D2 L396-420]
  - 命令会被自动路由到提供它的扩展所在的宿主。
  - 需要互相调用的一组扩展，建议用私有命令暴露功能。
  - 参数会被 `JSON.stringify`，不能有循环引用，到对端变成普通对象。
- **官方实例：js-debug 配 companion**【源码/实例】
  - js-debug-companion：`extensionKind: ["ui"]`、`"api": "none"`，用 `onCommand:js-debug-companion.*` 作为激活事件 [X1 package.json L31-41]。
  - README 说明：js-debug 是跑在远端的 workspace 扩展，本地浏览器由这个 UI 伴生扩展负责启动。
  - js-debug（`extensionKind: ["workspace"]`）通过 `executeCommand('js-debug-companion.launchAndAttach')` 调用它 [X2]。
  - js-debug 的 manifest 里**没有**对 companion 声明 `extensionDependencies`；两者都作为 VS Code 内置扩展随产品发布 [X3]。
  - 【推断】这说明官方自己在这个场景下是靠"命令加按命令激活"，而不是依赖边来把两端连起来。
- **extension pack**【文档】[D3 L255-282]
  - pack 是"a set of extensions that will be installed together"。
  - 文档要求 pack "should not have any functional dependencies with its bundled extensions"，功能依赖应另用 `extensionDependencies` 声明。
- **同一扩展兼容 Node 和浏览器**【文档】[D4 L75, L463-465]
  - 建议把代码分成 browser、node、common 三部分，由同一份源码构建两个入口。
  - 这是为了在不同运行时二选一，不是两端协作。

## 5. 其他与依赖粒度有关的机制

- **`api: "none"`**：唯一影响跨宿主依赖语义的正式字段。它是被依赖方的整体声明，取值只有 `none` 一个 [E15 L253-260]。【源码】
- **`extensionAffinity`**（proposed）：声明希望与哪些扩展同进程。只在同类宿主内合并分组，未启用 proposal 时会告警并忽略 [E3 L125-149] [E15 L485-493]。它不能跨种类。【源码】
- **`extensionsAny`**（proposed）：跨宿主可见，但不能拿 API，也不能激活 [E17] [E11]。【源码】
- **`enabledApiProposals`**：只是上面两个 proposal 的开关；schema 注明"Extensions cannot be published with this property" [E15 L244]。【源码】
- **`capabilities`**（`virtualWorkspaces`、`untrustedWorkspaces`、`agentsWindow`）：影响扩展自身的启用状态 [E16 L289-293]。经启用层会间接连带依赖者，并有对应的专门提示 [E12 L121-135]。它不是依赖粒度机制。【源码】
- **`targetPlatform`**：按平台发布不同的 VSIX [D5 L578-590]。文档建议 web 平台用 `when` 子句，不要为 web 另发一份 `package.json` [D5 L590]。【推断】理论上每个平台包的 manifest 可以写不同的依赖，但官方没有把它作为依赖细分手段，也没有相关文档。
- **按命令激活（`onCommand:`）加命令调用**：【推断】从 js-debug 实例看，这实际上充当了"依赖某项能力而非某个扩展"的粒度。调用方只依赖命令 id，提供方在哪个宿主由它自己的 kind 决定 [X1][X2]。

## 6. 对 NeuroBook 问题的启示

**VS Code 的做法能直接说明的：**
- VS Code 遇到过"依赖边跨越执行位置"的问题。它的选择是依赖边不带端信息，把跨端依赖降级为"安装与启用关系加激活顺序"，把"拿到对方 API"限制在同一宿主内（`exports` 只在同宿主有效）。
- 这相当于把依赖拆成两层语义：存在与激活顺序可以跨端；API 引用不能跨端。
- 跨端依赖的放行条件挂在**被依赖方**（`api: none`），不挂在依赖边上。VS Code 从来没有 `{"id": {"side": ...}}` 这类写法。
- 安装、启用、激活三层分别处理跨端：安装按依赖自己的 kind 放置；启用只在同服务器或 `api:none` 时连带禁用；激活才真正按宿主解析。
- 如果按整体解析、又没有逃生口，失败形态就是"unknown extension"加误导性的"not loaded, reload window"提示。这正是开发者担心的"两端都判缺失"的同类现象，可以当作反例。
- 若照搬 VS Code 规则【推断】：文生图作为一个扩展只能落在一端。落在服务端时，对只在浏览器的 editor 的依赖，要求 editor 声明 `api:none`，文生图拿不到 editor 的 API，只能用命令通信。

**VS Code 的做法不能说明的：**
- VS Code 的"单元"是扩展，需要两端代码的功能被拆成两个扩展，两个身份可以分别启用和卸载。这与 NeuroBook"单身份、两部分同时运行"的前提不同，所以"每一端分别解析同一插件的依赖"没有直接先例。
- VS Code 从未提供"依赖某插件的某一端"的语法，因此无法从 VS Code 得出这种细分方案的代价或收益。
- VS Code 的远端宿主按窗口 fork，没有"一个服务端实例被多个窗口共享"的情形。服务端依赖在多个浏览器实例之间的等待和生命周期语义，在 VS Code 里没有对应物。
- VS Code 跨端只能靠命令（JSON 序列化）通信，`api:none` 的取舍建立在这个前提上。NeuroBook 两端之间有什么通信通道、要不要跨端的类型化 API，决定了这条经验能迁移多少，VS Code 本身回答不了。
- js-debug 靠"内置随产品发布"来保证两个扩展一起存在。第三方插件生态下怎么保证成对安装，VS Code 只有 pack，而 pack 明确不承诺功能依赖。

## 7. 证据清单

vscode @ 9666ca8。S = `src/vs/workbench/services/extensions/`，A = `src/vs/workbench/api/`，M = `src/vs/workbench/services/extensionManagement/`。

- E1 `S/common/extensionHostKind.ts` L9-13, L47-88, L139-147
- E2 `S/common/extensionRunningLocation.ts` L8-51
- E3 `S/common/extensionRunningLocationTracker.ts` L21, L70-149, L229-293
- E4 `S/electron-browser/nativeExtensionService.ts` L685-743（`NativeExtensionHostKindPicker`），L769
- E5 `S/browser/extensionService.ts` L312-357（`BrowserExtensionHostKindPicker`）
- E6 `S/common/extensionManifestPropertiesService.ts` L150-178, L262-316
- E7 `S/common/abstractExtensionService.ts` L535-554, L1263-1271
- E8 `A/common/extHostExtensionActivator.ts` L147-162, L250-343, L379-454
- E9 `S/common/extensionDescriptionRegistry.ts` L31-45（`isHostExtension`）
- E10 `A/common/extHostExtensionService.ts` L183-199, L302-315, L1040-1048, L1170-1212
- E11 `A/common/extHost.api.impl.ts` L611-648
- E12 `A/browser/mainThreadExtensionService.ts` L63-68, L81-108, L111-179
- E13 `M/browser/extensionEnablementService.ts` L373-376, L492-501, L561-592, L606-640
- E14 `M/electron-browser/remoteExtensionManagementService.ts` L49-62, L95-105, L152-213
- E15 `S/common/extensionsRegistry.ts` L244, L253-260, L476-507
- E16 `src/vs/platform/extensions/common/extensions.ts` L289-293, L351-373；`src/vs/platform/extensionManagement/common/extensionManagement.ts` L22
- E17 `src/vscode-dts/vscode.proposed.extensionsAny.d.ts` L10-40；`vscode.proposed.extensionAffinity.d.ts`（空占位，只启用 manifest 字段）；`vscode.d.ts` L17430-17483
- E18 `src/vs/server/node/remoteExtensionHostAgentServer.ts` L480-497；`src/vs/server/node/extensionHostConnection.ts` L290

vscode-docs @ 250ea55：

- D1 https://code.visualstudio.com/api/advanced-topics/extension-host（md L14-56）
- D2 https://code.visualstudio.com/api/advanced-topics/remote-extensions（L16-28 架构，L122-134 依赖，L396-420 命令通信）
- D3 https://code.visualstudio.com/api/references/extension-manifest（L29-41 字段，L255-282 Extension Packs）
- D4 https://code.visualstudio.com/api/extension-guides/web-extensions（L75, L463-465）
- D5 https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions（L578-590）

实例：

- X1 microsoft/vscode-js-debug-companion @ da581f8：`package.json` L31-41，README
- X2 microsoft/vscode-js-debug @ bccbbaf：`package.json` L161-163，`src/ui/companionBrowserLaunch.ts` L75，`src/common/defaultBrowserProvider.ts` L45
- X3 microsoft/vscode 主分支 `product.json` 的 `builtInExtensions`，L42（`ms-vscode.js-debug-companion`）、L58（`ms-vscode.js-debug`）

说明：NeuroBook 仓库没有任何改动。临时克隆放在草稿目录 `/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/` 下的 `vscode-src`、`vscode-docs`、`jsdebug-src`。表中标【推断】的两处（跨宿主依赖激活失败不传递；按命令激活充当能力级依赖）只做了源码链路分析，没有实际运行验证。
