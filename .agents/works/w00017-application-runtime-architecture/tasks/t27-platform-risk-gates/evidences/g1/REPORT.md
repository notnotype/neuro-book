# G1 风险门验证报告（运行时加载的插件组件共享宿主 Vue 与 nb-ui）

> 由 G1 验证子代理撰写；子代理的写入工具不允许创建报告类 `.md` 文件，正文由主会话按其交回的内容原样保存。

## 结论

- **G1 成立。** 两种做法各测了 2 种构建 × 4 个引擎，共 16 个组合。响应式、i18n/主题/inject、nb-ui 浮层、卸载后 DOM 与监听器、抛错隔离，全部成立（实测）。
- **差别只在卸载时能否回收代码。** ESM 模块被浏览器的模块映射永久持有，宿主模块表做法可以回收（实测，Chromium/Electron）。
- **倾向做法 2（宿主模块表）**，依据见第 5 节。

测试环境：

- 开发构建：`nuxt dev`，端口 3431。
- 生产构建：`nuxt build --preset node-server` 后用 `bun .nuxt/product-raw/server/index.mjs` 运行，端口 3432。
- 四个引擎：
  - Chromium：google-chrome-stable 151（headless）
  - WebKit：Playwright WPE WebKit 26.5
  - Electron：43.2.0（内核 Chromium 150），BrowserWindow 选项与 desktop/electron 相同，只是没有 preload
  - WebKitGTK：系统 webkit2gtk-4.1 2.52.6，经 PyGObject 驱动。这是 Tauri 在 Linux 上的同一引擎，但没有跑 Tauri 本身

## 1. 结论矩阵

**记号：**

- 成立 = 实测成立；不成立 = 实测不成立；未验证 = 没有测到（原因见第 6 节）。
- 除特别注明外，证据等级都是**实测**。
- 表中数字对应任务的 7 个验证项；④拆成 ④a 与 ④b 两列。
- ④a：卸载后 DOM、全局监听器、插件 CSS 都恢复到加载前的基线；做法 2 还检查表项已删除。
- ④b：卸载并强制 GC 后，插件组件对象（做法 2 还有工厂函数）能否被回收。

### 做法 1：import map（ESM）

| 构建 | 引擎 | ①响应式 | ②i18n/主题/inject | ③nb-ui 浮层 | ④a 卸载无残留 | ④b 代码可回收 | ⑤抛错隔离 |
|---|---|---|---|---|---|---|---|
| dev | Chromium 151 | 成立 | 成立 | 成立 | 成立 | **不成立**（堆快照显示被模块映射持有） | 成立 |
| dev | WebKit 26.5 | 成立 | 成立 | 成立 | 成立 | 未验证 | 成立 |
| dev | Electron 43 | 成立 | 成立 | 成立 | 成立 | **不成立**（堆快照） | 成立 |
| dev | WebKitGTK 2.52.6 | 成立 | 成立 | 成立 | 成立 | 未验证 | 成立 |
| prod | Chromium 151 | 成立 | 成立 | 成立 | 成立 | **不成立**（堆快照） | 成立 |
| prod | WebKit 26.5 | 成立 | 成立 | 成立 | 成立 | 未验证 | 成立 |
| prod | Electron 43 | 成立 | 成立 | 成立 | 成立 | **不成立**（堆快照） | 成立 |
| prod | WebKitGTK 2.52.6 | 成立 | 成立 | 成立 | 成立 | 未验证 | 成立 |

### 做法 2：宿主模块表（登记工厂式 CJS）

| 构建 | 引擎 | ① | ② | ③ | ④a（含表项删除） | ④b 代码可回收 | ⑤ |
|---|---|---|---|---|---|---|---|
| dev | Chromium 151 | 成立 | 成立 | 成立 | 成立 | 成立（组件与工厂都已回收，堆快照中 0 个目标） | 成立 |
| dev | WebKit 26.5 | 成立 | 成立 | 成立 | 成立 | 未验证 | 成立 |
| dev | Electron 43 | 成立 | 成立 | 成立 | 成立 | 成立 | 成立 |
| dev | WebKitGTK 2.52.6 | 成立 | 成立 | 成立 | 成立 | 未验证 | 成立 |
| prod | Chromium 151 | 成立 | 成立 | 成立 | 成立 | 成立 | 成立 |
| prod | WebKit 26.5 | 成立 | 成立 | 成立 | 成立 | 未验证 | 成立 |
| prod | Electron 43 | 成立 | 成立 | 成立 | 成立 | 成立 | 成立 |
| prod | WebKitGTK 2.52.6 | 成立 | 成立 | 成立 | 成立 | 未验证 | 成立 |

### 各验证项的具体判据（两种做法相同）

- **身份探针。** 插件重新导出自己拿到的 `vue.ref`、nb-ui 的 `Button` 和 SDK 的 key，宿主逐一比较，三项都与宿主的对象全等。
- **①响应式。** 插件内原生按钮与 nb-ui 按钮各点一次，计数变为 2。
- **②i18n。** 显示 `t("common.cancel")`：默认是“取消”，宿主切到 en-US 后变为“Cancel”，切回后还原。
- **②主题。** 插件拿到的 color-mode 值随宿主在 dark 与 light 之间切换。插件内 nb-ui 按钮（primary 与 secondary）的计算样式，与宿主页面上同款 nb-ui 按钮在两种模式下完全一致。
- **②inject。** 插件用 SDK 的 Symbol 取宿主 provide 的值，取到 `g1-host:<做法>`。
- **③浮层。**
  - Tooltip（放在上方）：与触发按钮的间距为 5.7–6px，水平居中偏差不超过 0.42px。
  - Popover（放在下方）：间距为 6px，浮层中心点上最上层的元素属于浮层自身。
  - 两者都被传送到 body 下，不在插槽之内。
  - 两者的 z-index 都是 4321。这个值是宿主插槽 `provide(NB_POPOVER_Z_INDEX, 4321)` 提供的，说明插件树里的 nb-ui 用宿主那一份 Symbol 成功 inject。
- **④a 卸载。**
  - 插件节点、tooltip/popover 浮层、插件 CSS link、插件脚本元素都归零。
  - body 的子元素和 body 的 style 与加载前一致。
  - window/document/html/body 上的全局监听器回到基线：挂载期间插件自己的 `window:resize` 为 +1，卸载后为 0。
  - 做法 2 的 `__NB_MODULES__.has("example.g1")` 返回 false，`ids()` 为空。
- **⑤抛错隔离。**
  - ESM 视图在渲染期抛错、CJS 视图在事件处理函数里抛错，两者都被插槽的 `onErrorCaptured` 截获并显示原因。
  - 另一个插件视图和宿主计数器仍然正常。
  - pageerror 为 0。
  - 卸载后重新加载可以恢复。
- **控制台。** Chromium 与 WebKit 在开发和生产构建中都是 0 条 error/warning。Electron 只有 3 条通用的“Insecure Content-Security-Policy”警告，与插件无关。

## 2. 关键发现

1. **import map 做法可以成立（实测）。**
   - Nitro 的 `render:html` 钩子执行 `html.head.unshift(...)` 后，开发和生产构建的 HTML 中 import map 都是 head 的第一个元素，排在 modulepreload 和 Nuxt 入口模块之前。证据：`raw/dev-g1.html`、`raw/prod-g1.html`。
   - 转发模块写成 `export const {...} = globalThis.__NB_SHARED__[spec]`，导出名单在宿主构建时生成：Vue 171 个、`@notnotype/nb-ui/components` 96 个、SDK 3 个。运行时与真实命名空间对账，没有差异。
2. **“import map 必须早于首个模块脚本”在当前引擎上已经不是硬约束（实测）。**
   - 测法：HTML 里去掉 import map，等 Nuxt 启动完成后再动态插入，然后加载 ESM 插件。
   - 结果：Chromium 151、WebKit 26.5、WebKitGTK 2.52.6 都能正常挂载。
   - 旧版引擎（尤其是旧发行版的 WebKitGTK）未验证。在服务端注入仍然是各引擎都成立的写法。
3. **做法 1 不能卸载代码（实测）。**
   - 卸载并强制 GC 后，组件对象仍然存活。堆快照中的保留路径是：Blink `Modulator → ModuleRecordResolverImpl → BoxedV8Module → SourceTextModule → Cell → 组件对象`。
   - 同一 URL 再次 `import()` 会返回同一个模块对象（`sameModuleOnReload.esm = true`）。
   - 因此禁用后代码要留到刷新页面才释放；升级必须换 URL（例如把版本号放进路径），旧代码仍会并存。
4. **做法 2 可以卸载代码（实测，Chromium 与 Electron 的开发和生产构建）。**
   - 执行 `unregister` 并强制 GC 后，组件与工厂都被回收，堆快照中找不到该组件。
   - 重新加载时脚本会重新执行，得到新的模块对象（`sameModuleOnReload.cjs = false`）。
5. **对照组：插件自带一份 Vue 时是静默失败（实测，开发/生产 × Chromium/WebKit/WebKitGTK）。**
   - 身份探针 `vueRef = false`；点击后计数一直是 0；没有任何报错或警告。
   - `inject` 却能取到宿主上下文（显示 `g1-host:selfvue`）。原因是 Vue 3.5 通过 `globalThis.__VUE_INSTANCE_SETTERS__` 让多份 Vue 共享“当前实例”（实测，堆快照中可见该全局；具体机制属源码推断）。
   - 结论：“inject 取到了”不能证明共享成立，这个失败只能在构建或加载时拦截。
6. **错误边界（实测）。**
   - `onErrorCaptured` 返回 false 可以同时隔离渲染错误和原生事件处理函数里的错误，也不会上报到应用级 errorHandler。
   - 生产构建的 Vue 给出的 `info` 是 `https://vuejs.org/error-reference/#runtime-15` 这样的链接，不是可读文字；诊断记录需要另存组件名与错误信息。
   - 插件自己在 setTimeout 或未被 Vue 接管的 Promise 里抛的错，errorCaptured 截不到（推断，依据 Vue 的错误处理语义；未测）。
7. **开发模式的差异（实测）。**
   - Vite 开发服务器提供的 Vue 地址是 `/_nuxt/@fs/.../vue.runtime.esm-bundler.js?v=757ca2d3`，生产构建中则是带哈希的 chunk。import map 没有一个稳定地址可以直接指向宿主真正在用的那份 Vue，所以需要经全局对象转发。
   - 开发模式下 Vite 会把 `import(url)` 改写成 `import(__vite__injectQuery(url,'import'))`。以 `/` 开头的路径会被追加 `?import`，用绝对 URL 可以绕开。
8. **主题的实际来源（实测）。**
   - NeuroBook 页面的配色来自宿主主题会话写在 body 上的内联 CSS 变量，color-mode 只提供一个取值。
   - 插件节点位于宿主 DOM 中，通过层叠继承这些变量；验证依据是插件与宿主的 nb-ui 按钮计算样式相等。
   - 在这个非产品宿主页面上，切换 dark/light 并不会改变按钮颜色：两种模式下 secondary 按钮的背景都相同。

## 3. 两种做法的改动量与坑

改动完整见 `changes.diff`：12 个文件，共 501 行，其中包含实验页面和测试用的界面。

**两种做法共用的宿主部分：**

| 文件 | 行数 | 作用 |
|---|---|---|
| `shared-modules.ts` | 15 | 冻结的共享表，内容是 vue、nb-ui/components、SDK 的命名空间 |
| `plugin-sdk.ts` | 22 | 宿主实现的 SDK：`PLUGIN_HOST_CONTEXT`、`useHostI18n`、`useHostColorMode` |
| `G1PluginSlot.vue` | 173 | workbench 视图容器的替身：错误边界、provide、插件 CSS link 管理、两种加载分支 |
| `g1-plugins/[...path].get.ts` | 30 | 从源码树外的目录提供插件文件，模拟 `/plugins/<id>/<version>/` |
| client plugin | 22 | 在根组件挂载前交出 `__NB_SHARED__` 与 `__NB_MODULES__` |

### 做法 1：import map

**宿主需要做的：**

- `server/plugins/g1-importmap.ts`（19 行，其中 4 行是本次实验用的开关）。
- 导出名单生成器 `generate-shared-forwarders.ts`（44 行），外加 3 个生成出来的转发模块。
- 加载分支约 4 行。

**插件侧：** 标准 lib ESM，把共享模块列为外部依赖即可（6.11 kB）。

**坑：**

- import map 必须内联在 HTML 中，不能用外部文件。严格 CSP 下需要 `'unsafe-inline'` 或哈希（源码与规范推断）。目前 Tauri 配置的 CSP 含 `'unsafe-inline'`，页面按 External URL 加载 `http://127.0.0.1:<port>/`（源码）。
- 导出名单必须随宿主构建生成并保持同步。名单缺名时，整个插件模块会在链接阶段失败，报 SyntaxError（推断，未测）。
- 转发导出是取值拷贝，不是活绑定。Vue 与 nb-ui 的导出都是常量，所以没有影响（推断）。
- 代码无法卸载，升级必须换 URL。
- 开发模式要用绝对 URL 加载插件。

**优点：**

- 插件是标准 ESM，可以原生使用 `import()` 分包和 `import.meta`（推断）。
- 与设计 P2 当前写的“入口必须是预构建的 ESM”一致。

### 做法 2：宿主模块表

**宿主需要做的：**

- `module-table.ts`（92 行），其中 register/materialize/unregister/require 为核心；另有经典脚本加载约 18 行、G1 取证用的 `factoryOf` 约 5 行。
- 加载与卸载分支约 13 行。

**插件侧：**

- Vite 配置多 3 行：`format: cjs` 加 `banner`/`footer` 登记包装。产物 7.29 kB。
- DeepSeek Harness 的 tsdown 预设还包含三项：纯度门（没登记的依赖一律打包，禁止 require 表外模块）、CSS 在工厂执行时注入、`require.async` 分包协议（源码：`packages/client/tsdown.client.ts`、`modules/src/client/system.ts`）。

**坑（源码，来自 DeepSeek 的注释）：**

- CJS 产物不能携带顶层 await 与 `import.meta`。
- 分包需要宿主自建协议。
- 同一 id 重复登记必须拒绝；本实验在注销后重新登记。

**优点（实测）：**

- 不改 HTML，不需要导出名单，开发和生产构建路径完全相同。
- 宿主能看到插件的每一次 `require`：可以拒绝表外模块并给出明确错误，也可以拦截“自带 Vue”。
- 注销后代码可以回收。

### 验证过程中遇到的测量陷阱（对设计 P1 第 9 项“开发模式检查”有参考价值）

- Playwright 的 `waitForSelector` 返回的 ElementHandle 会一直持有 DOM，造成假泄漏。已改用 locator。
- Vue 开发构建在没有 devtools 时，会缓冲页面加载后前 3 秒的组件事件（含组件实例）。在这段时间内做 GC 检查会得到假泄漏（实测，保留路径经 `__VUE_INSTANCE_SETTERS__` 的闭包上下文到 `buffer`）。
- 堆快照中 WeakMap 的 ephemeron 边如果按强引用计算，会得到假路径（`optionsCache`）。
- 应对办法：GC 检查要等 3 秒以上，并排除 WeakMap 表项。

## 4. 对设计 P7 的修改建议

1. 风险门 G1 可以记为通过：
   - 实测：Chromium、WebKit(WPE)、Electron 43、WebKitGTK 2.52.6，各覆盖开发与生产构建。
   - Tauri 本体与 WebView2 仍未验证。WebView2 是 Chromium 内核，按推断同样成立。
2. 确认采用做法 2，并同步修改 P2 “入口必须是预构建的 ESM”：浏览器入口改为“由 SDK 构建预设生成的登记工厂式 CJS”。预设要包含纯度门，一旦把 `vue`、`@notnotype/nb-ui/*` 或 SDK 打进插件就让构建失败。理由是自带 Vue 属于静默失败（发现 5）。
3. 明确模块表的内容和语义：
   - 表内包含哪些 nb-ui 子路径（components、layout、theme、composables 等）；每一个子路径都是对外的 API 承诺，应纳入 `engines.neurobook` 兼容范围。
   - require 表外模块时，在物化阶段返回结构化错误。
   - 禁用时执行三步：注销表项、移除插件样式、释放视图。
4. 插件 CSS 的加载与移除由加载器负责，两种做法都需要这一点。
5. 错误边界只能覆盖 Vue 调用路径上的错误（渲染、生命周期、事件处理函数）。插件自己排出的异步回调需要另行说明：要么由 SDK 提供登记在激活作用域上的计时器与异步包装，要么在文档中写明属于插件责任。
6. 浏览器侧的“卸载后仍被引用”开发检查可以沿用本次方法：弱引用加强制 GC，等 Vue 开发缓冲清空后再检查；也可以只在生产构建上检查。
7. 共享表以 `import * as` 交出 Vue 与 nb-ui，宿主包会失去对这两者的 tree-shaking。这属于推断，体积影响未测，需要评估是否可以接受。

## 5. 倾向：做法 2，依据

- **两种做法在已测环境中功能上都成立（实测），能区分二者的是卸载。** P1 第 8 项与 P8 要求运行期禁用、卸载、升级。只有做法 2 能在注销后回收代码，并在重新加载时得到新代码（实测，Chromium/Electron 堆快照）。做法 1 的代码会留到页面刷新，升级必须换 URL。
- **宿主需要做的事（源码与实测）：**
  - 做法 2 不依赖 HTML 注入、CSP 的内联许可、导出名单生成，也不需要处理开发与生产环境的 URL 差异。
  - 做法 1 在这四点上都需要宿主维护。
- **做法 2 的代价（源码）：** 需要提供构建预设（CJS 包装、纯度门、CSS、分包协议）；插件失去 ESM 原生的 `import.meta` 与顶层 await。

## 6. 未验证边界

- **Tauri 本体（wry 的自定义协议、IPC、CSP 注入）没有运行。** 只在隔离的无头 KWin 中用系统 WebKitGTK 2.52.6 跑了同一组页内检查。Windows 的 WebView2 未测。
- **旧版 WebKitGTK 未测。** 包括它们对 import map、迟到插入的 import map、Vue 3.5 的支持。
- **WebKit/WebKitGTK 上的代码回收（④b）未验证。** 原因是没有强制 GC 的接口。
- **没有在产品主页面（workbench/index.vue）中测试。** 实验页面设置了 `productHost: false`。
- **生产构建没有走 Product Runtime Image Builder 与 Manager 启动流程。** 用的是 raw 的 `nuxt build --preset node-server` 加 bun 运行产物。
- **以下项目未测：**
  - 插件内部分包（ESM 的 `import()`、做法 2 的 `require.async`）
  - 宿主 HMR 时插件的行为
  - 转发名单缺名时的具体报错
  - 插件在 Vue 调用路径之外的异步抛错
  - source map 与调试体验
  - 共享命名空间对宿主包体积的影响

## 7. 执行说明与副作用

1. **KWin 首次启动崩溃，触发了开发者桌面上的崩溃报告器。**
   - 原因：Electron 需要显示环境，而本机没有 xvfb-run；`--ozone-platform=headless` 在 Electron 43 上会段错误。改用 `dbus-run-session -- kwin_wayland --virtual`：私有 DBus、私有 `XDG_CONFIG_HOME`、`KDE_DEBUG=1`，runtime 目录为 `/tmp/claude-1000/g1x`。
   - 第一次启动因为 socket 路径过长而崩溃，systemd-coredump 在开发者的桌面会话里拉起了 drkonqi。约 1 分钟内已停止，但桌面上可能短暂出现过 KWin 崩溃提示。
   - 同一次尝试还在私有会话里拉起过一个 fcitx5，已停止；开发者自己的 fcitx5（pid 11561）没有动。
2. **下载的东西都放在会话临时目录。**
   - Playwright WebKit（`pw-browsers`），以及它缺的 Ubuntu noble 库：libicu74、libxml2、libflite1。
   - Electron 43.2.0：经 `prox curl` 下载。`@electron/get` 走 prox 很慢，最初那次下载已中止。
   - 已删除 `/tmp/electron-download-*` 和 `/tmp/claude-1000/g1x`。
3. **启动的进程都已停止**，包括开发服务、生产服务、KWin、Electron 和浏览器；3431、3432、9431 端口已释放。
4. **临时 worktree 需要强制删除。** 为了生成 diff，对新文件执行过 `git add -N`，清理时用 `/usr/bin/git worktree remove --force`。没有 commit，也没有修改主工作区和 w00017 worktree 中证据目录以外的任何文件。
5. **旁注（未分析原因，可能与 G0 有关）：** 两次用 SIGTERM 停止 Source Dev 时，日志都显示“Product graceful shutdown 失败，转为强制收口：Product shutdown 在 30000ms 内未退出”。
6. **证据中的脚本含会话临时目录的绝对路径**，复现时需要改成新的路径。

## 8. 证据文件（均在本目录下）

- `changes.diff`：宿主侧的改动。
- `plugin/`：示例插件的源码、Vite 配置（esm / cjs / selfvue 三种模式），以及 esm 与 cjs 两种构建产物。
- `scripts/`：
  - `g1-verify.mjs`：Playwright 与 CDP 版的主检查。
  - `g1-heap.mjs`：堆快照保留路径分析。
  - `g1-negative-control.mjs`：对照组。
  - `g1-late-importmap.mjs`：迟到 import map 测试。
  - `g1-inpage.js`、`listener-probe.js`、`webkitgtk-run.py`、`webkitgtk-run.sh`：WebKitGTK 页内检查及驱动。
  - `electron-run.sh`、`electron-main.cjs`：Electron 运行器。
- `raw/results/*.json`：每个组合的逐项结果。
- `raw/heap/*.json`：堆快照中的保留路径。
- `raw/logs/`：测试输出、构建日志与服务日志。
- `raw/dev-g1.html`、`raw/prod-g1.html`：两种构建下服务端返回的 HTML，可核对 import map 的位置。
- `screenshots/`：Chromium、WebKit、Electron 在开发与生产构建下 popover 打开时和最终状态的截图，以及对照组截图。
