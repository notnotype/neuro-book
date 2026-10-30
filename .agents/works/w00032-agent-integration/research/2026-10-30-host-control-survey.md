# Agent 操作宿主应用与网页界面（2026-10-30）

- 问题：[t16](../tasks/t16-command-bridge/README.md) 要定 Agent 怎样像用户一样操作 NeuroBook：执行命令、看懂并操作界面、截屏、高亮引导、改设置。开发者要求先查各家做法。
- 做法：3 个 Haiku 子代理分头调研（宿主命令与状态；网页界面的感知与操作；截图与高亮），主会话整理；没有另行核对原文。
- 证据等级：**源码** 为子代理读过源码；**文档** 为官方文档或 README（经抓取工具摘要，未逐字核对）；**检索** 为搜索摘要。

## 1. 宿主命令与状态

| 产品 | 执行宿主命令 | 列出命令 | 感知当前状态 | 多窗口 | 审批 | 证据 |
|---|---|---|---|---|---|---|
| VS Code Copilot | `runCommand`（`commandId`、`args`），通用入口 | 没有列表工具，模型猜 id，找不到时区分“不存在”与“前置条件不满足”回给模型 | `#selection`、`#file` 等显式附加；工具读文件与诊断 | 没有窗口参数，在发起会话的窗口执行（推断） | 每次确认，标题“Run Command name (id)?”，可记住到会话、工作区、全局；没有白名单 | 源码（`vscode-copilot-chat` 的 `vscodeCmdTool.tsx`，仓库 2026-05 已归档）、文档 |
| VS Code 扩展工具 | `vscode.lm.registerTool`，每个工具单独声明 | 由 `modelDescription` 与 `when` 决定可见 | 扩展自定 | — | 通用确认，`prepareInvocation` 改文案 | 文档 |
| JetBrains 内置 MCP | `execute_action_by_id`，另有大量单独工具 | `list_available_actions` | `get_open_in_editor_file_text`、`get_selected_in_editor_text` 等结构化接口 | 可选参数 `projectPath`；旧代理靠扫端口选 IDE 实例 | 每个工具可单独关；终端命令要确认 | 文档（两版工具表不一致）、源码（旧代理） |
| Obsidian 社区插件 | `POST /commands/{id}/`、`commands_execute` | `GET /commands/`、`commands_list` | `active_file_read` | 单实例 | API Key；配置目录默认拒绝访问 | 文档 |
| Cursor、Windsurf、Zed | 没有操作 IDE 本身的工具，只有文件、终端、浏览器 | — | `@` 引用、选区芯片 | — | 按工具允许、拒绝或确认 | 文档 |
| Notion、Figma MCP | 没有通用入口，按操作拆成几十个工具 | 工具列表 | Figma 有 `get_screenshot`；按选区提问只在桌面版 | 按 URL 或 id 指定 | Notion 删除要 `user_confirmed: true` | 文档 |
| Copilot Vision Highlights | 不操作，只在屏幕上指出点哪里 | — | 用户共享的应用画面 | 一次一个应用（检索） | 用户主动开启 | 文档（博客） |

- 没有一家提供通用的“改设置”工具；Obsidian 默认拒绝访问配置目录，Notion 只让改 Skill 启用项。

## 2. 看懂并操作网页界面

| 方案 | 感知 | 控件引用 | 动作与执行 | 权限 | 证据 |
|---|---|---|---|---|---|
| Playwright MCP | 无障碍树文本快照；截图只读，README 写明不能根据截图操作 | `[ref=e5]`，快照内有效，页面变了要重取 | 点击、输入、悬停、拖动、选择、按键、上传、对话框；经 Playwright | 自称不是安全边界；只有来源白名单与黑名单 | 文档 |
| Chrome DevTools MCP | 无障碍树快照（`uid`）、截图 | `uid`，跨快照稳定性未说明 | 点击、填写、悬停、拖动、按键；坐标点击要实验开关 | 无内置审批 | 文档 |
| Vercel agent-browser | 无障碍树快照；截图可叠加与引用对应的编号标签 | `@e1`，存活元素跨快照保留引用 | 动作最全，含滚动、选择、勾选；经 CDP | 域名白名单、动作策略文件、指定类别要确认、页面输出加边界标记 | 文档 |
| browser-use | DOM 序列化成一行一个元素的文本，去掉被遮挡、不可见、被包含的元素 | 索引取浏览器节点 id，跨步骤一般不变 | 约 31 个动作；经 CDP | 未查到 | 源码 |
| Stagehand | 裁剪过的无障碍树；自然语言 `observe`、`act` | `observe` 返回 XPath | 经 Playwright；首次动作可缓存，之后不调模型 | 未查到 | 文档 |
| 阿里 page-agent | 在页面里用脚本把 DOM 压成文本，不截图、不用多模态 | 未查到 | 页面内合成事件（未核实）；模型密钥会打进前端包 | 无 | 文档 |
| CopilotKit | 应用主动共享状态 | 按名字登记的前端工具 | 应用自己的处理函数，不模拟点击 | 执行前等人批准的钩子 | 文档 |
| WebMCP（WICG 草案，2026-10-27 版） | 页面自己登记工具，不看 DOM | 工具名 | `document.modelContext.registerTool({name, title, description, inputSchema, execute, annotations})`，注解有 `readOnlyHint`、`untrustedContentHint`、`consequentialHint` | 同源策略与双方声明；同意由实现定义 | 文档 |
| Anthropic computer use、OpenAI computer 工具 | 截图，每张约 1000 到 1800 token | 屏幕坐标 | 坐标点击、输入、滚动 | 建议隔离环境、白名单、后果性动作人工确认、屏幕内容不可信 | 文档 |
| Anthropic browser 工具 | `read_page` 返回无障碍树，带 `ref_N`；截图与放大 | 标签页内有效；页面树读不到（canvas、视频、跨域 iframe）才用坐标 | 执行器由应用提供 | 同上 | 文档 |
| Claude in Chrome | 截图与页面读取 | 未查到 | 扩展执行 | 每步确认或自动；下载、输入敏感信息仍要确认 | 文档、检索 |

- 页面里的脚本模拟的事件 `isTrusted` 为 false，浏览器不触发需要真实用户操作的默认行为，例如打开文件选择框（检索）。

## 3. 截图

| 做法 | 保真 | 用户操作 | 浏览器 | 证据 |
|---|---|---|---|---|
| DOM 重画成图：snapdom（MIT，无依赖，可排除指定元素）、html-to-image（MIT） | 按 DOM 与样式重画，不是屏幕像素：字体、`backdrop-filter`、canvas、视频、跨域图片与 iframe 可能有偏差；大 DOM 会慢或失败 | 无浏览器弹窗 | 全部 | 文档 |
| html2canvas | README 自称很实验、不建议生产 | — | — | 文档 |
| 屏幕共享 `getDisplayMedia` | 真实像素 | 需要用户点击触发；Chrome 每次都弹选择器、不能记住授权；共享期间一直显示提示 | Firefox、Safari 选项支持少 | 文档 |
| Element Capture（`RestrictionTarget`） | 只截某个元素，合成器像素 | 同上，还要先开屏幕共享 | Chrome 132 以上桌面版 | 文档 |
| 服务端无头浏览器截图 | 截的不是用户的窗口 | — | — | 推断 |

同意做法：Claude in Chrome 有“只这一步”与“总是允许此站点”；Copilot Vision 由用户主动共享、只看不动手、每次会话独立；Windows Recall 被批评后改为默认关闭。

## 4. 高亮与引导

| 库或产品 | 许可 | 指定目标 | 说明 | 证据 |
|---|---|---|---|---|
| driver.js | MIT | CSS 选择器、DOM 元素或返回元素的函数 | 遮罩加镂空，`highlight()` 单点高亮，`skipMissingElement`、`waitForElement`；滚动与隐藏元素的处理文档没写 | 文档 |
| shepherd.js、intro.js | AGPL 或商业授权 | 选择器、`data-intro` 属性 | 闭源产品要买授权 | 文档 |
| Floating UI | MIT | 只定位浮层 | 遮罩要自己写 | 文档 |
| Copilot Vision Highlights | — | 从屏幕图像判断（推断） | 只指路，用户自己点 | 文档（博客） |

控件怎样定位：Testing Library 的查询优先级是角色加可访问名第一、`data-testid` 最后；选择器随 DOM 结构失效，可见文字随语言与文案变化，应用自己登记的控件名最稳定，但要求每个控件都登记（文档、推断）。

## 未验证边界

- VS Code 的新版工具名与归档仓库不一致；JetBrains 两版工具表不一致，以运行中的服务列出的为准。
- page-agent 的元素索引与动作实现、browser-use 的动作清单、Stagehand 源码都没读到。
- driver.js 的滚动处理、vue-tour、CommandBar、Userpilot、Pendo 等引导产品的实际做法没有查到原文。
- Firefox、Safari 对 `getDisplayMedia` 的基础支持没有核实。

## 5. omp 的浏览器与 eval（第二轮，2026-10-30）

本机 omp 源码（`@oh-my-pi/pi-coding-agent`，路径基准 `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/`），子代理走查，主会话核对了标“核实”的几处。

- **浏览器不是工具，是 eval 的 prelude**（核实）：`src/eval/preludes.ts` 的注释写“Prelude definitions are capabilities, not tools: they have no parameter schema … and never enter a model tool inventory”。模型在 eval 的 JS 或 Python 里用全局对象 `browser`；`tool.browser` 不存在。电脑操作（`computer`）同样是 prelude，缺省关闭。
- **渐进式披露**（核实）：eval 的工具描述（`src/prompts/tools/eval.md`，约 2,300 字符）里，每个 prelude 只有一行摘要加一个地址，例如 `` `browser`: Drive real Chromium tabs … → xd://eval/browser ``，并写明“`read` the linked docs before first use”。完整文档（`src/prompts/tools/browser.md`，约 11,900 字符）只在模型 `read xd://eval/browser` 时进上下文；没有 `read` 工具时才内联进描述。prelude 的代码在内核第一次用到时才加载。
- **引擎**：puppeteer-core 驱动 Chromium，可以自己启动（缺省无头）、连接已有 CDP，或经 relay 驱动用户自己的 Chrome。暴露给模型的脚本接口是原始的 Puppeteer `page`、`browser`（`tab.run(fn)`），不是 Playwright。
- **感知**：两套。`tab.observe()` 返回 JSON，元素是数字 id 加角色、名字、值、状态，只列可交互元素，可只取视口内；`tab.ariaSnapshot()` 用钉住版本的 Playwright 注入脚本（Apache-2.0）生成文本树，引用 `[ref=eN]`，可取增量。两者每次都从头编号，页面变了旧编号报 stale，要重取。`tab.screenshot({annotate: true})` 在截图上叠加与 id 对应的编号；给模型的图最大 1024×1024、150 KiB，原图存盘。
- **eval 里调工具**：`await tool.<名>(args)`，参数照常校验，审批与直接调用相同。
- **审批**：浏览器的每次宿主操作都按 exec 档审批，用户可用 `tools.approval.browser` 设允许、询问或拒绝；omp 缺省审批模式是 `yolo`，所以缺省不弹确认。电脑操作另有 `control.acquire({reason})` 要用户当场确认。

## 6. CodeAct 的文档形式与“熟悉的 API”（第二轮，2026-10-30）

| 系统 | 模型面对的形态 | 怎样给模型看接口 | 名字是否沿用 Playwright | 证据 |
|---|---|---|---|---|
| Codex code mode | 在 V8 隔离环境里写 JS，`await tools.<名>(args)` | 每个工具的描述后附 TypeScript `declare const tools: {...}`（由参数 JSON Schema 生成，有字节预算）；延迟加载的工具用 `tools.tool_search({query})` 搜，返回完整声明 | 否 | 源码（核实 `code-mode-protocol/src/description.rs`） |
| Codex 浏览器 | 经 MCP 服务 `node_repl`、`cua_repl` 与应用连接器，接口不在开源仓库里 | — | 未知 | 源码、检索 |
| Claude in Chrome、桌面内置浏览器 | 固定的 JSON 工具：`read_page`（无障碍树，引用 `ref_N`）、`find`、`form_input`、`computer`；只有 `javascript_tool` 收代码 | 工具描述 | 否 | 本地 Skill、检索 |
| Playwright MCP | 固定工具，另有 `browser_run_code_unsafe(async (page) => …)`，标为等同远程执行 | README | run_code 里是 | 文档 |
| Cloudflare Code Mode | 只有 `search()`、`execute()` 两个工具，固定约 1,000 token | 在 search 沙箱里读 spec | 否 | 文档 |
| Anthropic“用代码执行调 MCP” | 工具变成 `./servers/<服务>/<工具>.ts` 文件树，按需列目录、读文件，或 `search_tools` | 文件 | 否 | 文档 |
| CodeAct 论文（ICML 2024） | Python 函数签名，如 `click_url(url: str) -> str` | 名字、描述、签名 | 不适用 | 文档：M3ToolEval 上代码动作 74.4%、JSON 52.4%，轮数 5.5 对 7.7；API-Bank 上 gpt-4 反而 JSON 更好 |
| browser-use actor | `page`、`element`、`mouse`，方法名接近 Playwright | 开发者 API，自称“不是 Playwright”，列出差异 | 部分 | 文档 |
| agent-browser | 自有命令行与 `@e2` 引用 | README | 否 | 文档 |

- 没有找到“同一任务用 Playwright 名字与自造名字比较准确率”的对照实验；“模型熟悉代码”是 CodeAct 论文与 smolagents 的解释，没有单独测量。
- 各家共同的做法：接口声明从真实的工具定义生成，不手写；启动时只给一个小入口，细节按需搜或读；动作以“快照加引用”为主键。

## 7. 页面内可复用的库（第二轮，2026-10-30）

| 对象 | 许可 | 能做什么 | 不能做什么 | 结论 | 证据 |
|---|---|---|---|---|---|
| Testing Library + user-event v14 | MIT | 在真实浏览器里跑；`pointer()` 按动作序列发 pointer 与 mouse 事件 | 不做命中测试（被遮挡也照发）；不支持 HTML5 原生拖拽；不调 `setPointerCapture`；会替换剪贴板 | 用来测试我们自己的快照与动作层，不作运行时 | 文档、源码 |
| Playwright 无障碍快照（`packages/injected/src/ariaSnapshot.ts`、`roleUtils.ts`） | Apache-2.0 | ref 缓存在元素上，角色与名字都没变才复用；`ai` 模式下要可见且通过命中测试才给 ref | 依赖 `domUtils`、`@isomorphic` 与缓存，没有独立 npm 包 | 参照规则；名字计算用 `dom-accessibility-api`（MIT） | 源码 |
| 阿里 page-agent 的 `page-controller` | MIT | 交互元素判定（cursor、标签、角色、可滚动、`elementFromPoint` 遮挡检查）；点击发完整 pointer/mouse 序列再 `click()`；输入用原生 value setter 加一个 `input` 事件；可见光标（`SimulatorMask`，rAF 缓动、点击波纹） | 编号每次重排，没有稳定名字；没有拖拽、触摸、悬停；光标隐藏时 rAF 不停 | 参照判定与事件序列；光标代码可借用（保留版权声明） | 源码 |
| browser-use、Nanobrowser | MIT、Apache-2.0 | — | 当前 browser-use 已无页面内脚本；Nanobrowser 经 `chrome.debugger` | 不用 | 源码、文档 |
| `@mcp-b/webmcp-polyfill` | MIT | WebMCP 的 `document.modelContext.registerTool` | 草案未定稿 | 作为长期对齐方向 | 检索 |
| driver.js v1.10.2 | MIT，gzip 约 8 kB | 遮罩、镂空、说明框，`onPopoverRender` 可改说明框内容，`disableActiveInteraction` | 文档里没有非阻塞模式、没有多元素同时高亮，同一时刻只能一个实例；跟随滚动未核实 | 第一版先试，不行再自建 | 文档 |
| `@floating-ui/dom` | MIT，gzip 约 8 kB | 浮层定位 | 不做遮罩 | 自建时用 | 文档 |

合成输入的限制（文档与检索，未在真实浏览器里验证）：

- `dispatchEvent` 发出的事件 `isTrusted` 为 false；`focus()` 引起的焦点事件是可信的。
- 对不在活动指针表里的 pointerId 调 `setPointerCapture` 抛 `NotFoundError`（MDN、WPT 有对应用例，Cesium 社区有 Chrome 实例），合成的 pointer 不进活动表。
- HTML5 原生拖拽：合成的 `dragstart`、`drop` 能到监听器，但浏览器不执行拖放。
- 合成的 `TouchEvent` 不触发滚动、不生成点击。

Vue 的组件身份：`__vueParentComponent` 只在开发模式或打开生产 devtools 标志时写到元素上；`<script setup>` 编译出的 `__name` 生产包里也有。稳定的控件名靠自定义指令显式声明（源码）。
