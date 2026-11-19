# 调研：把 Agent 会话挂进面板（前提：面板 = herdr 的网页前端）

2026-10-12 由子代理调研，主 Agent 抽查后入库。抽查属实：herdr 的 socket `~/.config/herdr/herdr.sock` 权限 `srw-------`、没有协议层鉴权；`herdr terminal session observe`、`control` 两个命令存在；默认 server 是 0.9.1（客户端 0.9.3）；本机有 `tailscale0`、`wlan0`、`docker0`。

标注：【实测】调研者自己跑出的结果；【文档】herdr 官方文档、`--help` 或 omp 源码注释；【推断】未验证的判断。实测都在一个自建的隔离 herdr 会话 `nbdev-probe` 里做，里面只有 `bash` 与一个假 Agent 脚本，做完已停止并删除；对默认会话只做了只读操作。

## 结论先行

1. **只用 herdr 现有接口，第一版要的四件事都能做**：会话列表（状态实时推送）、看实时终端、发消息、等会话空闲再发。几处缺口都有绕法，见第一节末。
2. **看终端用 herdr 给第三方准备的终端流 `herdr terminal session observe`**：每行一条 JSON，屏幕内容是 base64 的 ANSI 字节；第一帧整屏、之后只发变化；多个浏览器同时看互不干扰，也不改终端尺寸。发消息走 socket 接口的 `agent.prompt`。真要在网页里长时间打字，再用同一族的 `terminal session control`：同一终端同时只能有一个控制者，而且会改真实终端的尺寸。在 pty 里跑 `herdr agent attach` 能跑通，但只是同一条通道外面套一层 TUI，多出 `ctrl+b` 前缀拦截、需要 pty、不能只读，不选。
3. **通知会话一律用 `agent.prompt`，不用 `pane.send_text` 或 `pane.run`**：`agent.prompt` 在 pane 上没有 herdr 认得的 Agent、或会话在等确认时拒绝，文字按粘贴送进去再按 Enter；后两者原样打字，pane 回到 shell 时文字会被当命令执行。
4. **会话身份以 herdr 的 `agent_session.value` 为准**（Claude 是会话 id，omp 是会话文件路径），pane id 只当线索。发送前核对身份；会话在工作就排队，等空闲再发（omp 工作中收到回车会 steer，打断当前这一轮）。
5. **herdr 的 socket 没有鉴权，只靠文件权限**。面板开到局域网，等于开放一个用户级远程 shell。最小保护：默认只绑 127.0.0.1；跨设备优先 Tailscale Serve（本机已装、在线）或 SSH 隧道拿 HTTPS；面板自己做设备配对登录、Host 与 Origin 与 CSRF 校验、herdr 方法白名单；产物页必须放到另一个来源（另一个端口）。
6. **版本**：默认 server 0.9.1，observe 与 control 从 0.7.2 起就有，够用；只有 control 的鼠标事件要 0.9.2 以上。升级 server 要重启，会结束所有 pane 里的进程，除非用实验性的 `--handoff`。

## 一、herdr 能给面板什么

### socket 位置、协议、鉴权

- **位置**：默认 `~/.config/herdr/herdr.sock`；命名会话在 `~/.config/herdr/sessions/<名>/herdr.sock`；解析顺序 `--session` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > 默认【文档】。
- **协议**：一行一个 JSON。请求 `{"id","method","params"}`，响应 `{"id","result"}` 或 `{"id","error":{code,message}}`；订阅连接在第一条应答之后持续推送【文档】。`ping` 返回 version 0.9.1、protocol 22 与 capabilities；`herdr api schema --json` 给出约 100 个方法的 JSON Schema；CLI 本身就是这个 socket 的客户端【实测】。
- **鉴权**：协议里没有。同一用户的任何进程连上 socket 就有全部能力，包括 `server.stop`、`pane.run`、`plugin.link`【文档】，面板后端必须自己设方法白名单。
- **另一个 socket** `herdr-client.sock` 是 TUI、直连 attach 与热交接用的私有二进制协议，不对外【文档】。
- **日志**：server 把每个 API 请求写进 `herdr-server.log`（已 2.1 MB）【实测】，面板应订阅，不要高频轮询【推断】。

### 能拿到什么

| 需要 | 接口 | 要点 |
|---|---|---|
| 会话列表 | `agent.list`、`session.snapshot` | 每项有 pane_id、terminal_id、agent（claude 或 omp）、agent_status、agent_session、cwd、foreground_cwd、terminal_title、state_change_seq、completion_seq、tokens；当天默认会话 9 个 Agent：8 个 Claude、1 个 omp【实测】 |
| 状态推送 | `events.subscribe`：`pane.agent_status_changed`、`pane.created`、`pane.closed`、`pane.updated`、`pane.agent_detected`、`pane.exited` | 状态变化不到 1 秒推到订阅端【实测】；事件历史不保存，读得太慢会收到 `events_lost` 并被断开，要重订并用 `session.snapshot` 对账【文档】 |
| 一次性等待 | `agent.wait` | server 端按事件等待并锁定当前 Agent；等待中 Agent 退出返回 `agent_not_running`，不会被 pane 里新起的进程满足【实测】。`events.wait` 只支持 Agent 状态，传 `pane_output_changed` 报 `unsupported_event_wait_match`，虽然 schema 里列了它【实测】 |
| 读输出 | `agent.read`、`pane.read`（visible、recent、recent_unwrapped、detection；text 或 ansi） | 只是快照，不是流 |
| 实时终端流 | CLI 的 `herdr terminal session observe`、`control` | 不在 JSON 接口里，见第二节 |
| 发消息 | `agent.prompt`（可带 wait） | 文字按 bracketed paste 包好再加 Enter；等确认时返回 `agent_blocked`、一个字节都不写；只靠自报状态、herdr 认不出进程的 Agent 返回 `agent_not_ready`【实测】 |
| 发按键 | `agent.send_keys`、`pane.send_keys`（逻辑键名）、`pane.send_text`（原样字节） | 逻辑键按应用当前模式编码（应用光标键模式下 `up` 发 `ESC O A`）；`send_text` 原样写入；`pane.send_input` 的 text 在应用开着 bracketed paste 时按粘贴处理【实测】 |
| 启动 Agent | `agent.start --kind claude\|omp …` | 要求 pane 停在 shell 提示符，建 pane 另调 `pane.split` 或 `tab.create`【文档】；第一版不开放 |
| worktree 与 workspace | `worktree.*`、`workspace.*` | 列出 11 个 checkout，全部 `open_workspace_id: null`；开发者的会话都在同一个 workspace、cwd 都是仓库根，“一个 worktree 一个 workspace”这层用不上【实测】 |
| 给会话贴标签 | `pane.report_metadata` 的 tokens | 写入 `--token work=w00022 --token task=t03` 后 `pane.get` 能读回，herdr 侧栏也显示【实测】；只用于展示，server 重启后不保留【文档】 |

**读输出的限制**：Claude Code 跑在备用屏上，工作时只能读当前可见的行，多读报 `agent_not_idle`；空闲时 herdr 会滚动应用界面收集历史，会动到界面【实测、文档】。omp 有普通回滚，测到 443 行【实测】。

### 怎么认出 Claude Code 与 omp、怎么拿到会话 id

- herdr 看 pane 的前台进程，再用该种类的“屏幕检测规则”判断 idle、working、blocked【文档】。
- **Claude Code**：herdr 集成装了一个 SessionStart 钩子（startup、resume、clear、compact、fork 时触发），调用 `pane.report_agent_session` 报会话 id，子代理不报【实测】。状态仍靠读屏，herdr 没学过的确认界面会先显示成 idle【文档】。
- **omp**：集成扩展主动用 `pane.report_agent` 报状态与会话文件路径，`screen_detection_skipped` 为 true【实测】。
- **结果**：Claude 是 `agent_session = {source:"herdr:claude", kind:"id", value:<会话 id>}`；omp 是 `kind:"path"`、value 为会话 jsonl 路径【实测】。
- **用会话 id 当主键**：pane 跨 workspace 移动时 pane id 会变、terminal_id 不变【文档】；server 重启后靠 `claude --resume <id>` 或 `omp --resume=<path>` 恢复，pane id 与 terminal id 可能都变【推断】。

### 远程机器

`--machine <已保存的机器>` 把 API 类命令经非交互 SSH 转发到远端 server，鉴权全交给 OpenSSH，不会安装或启动远端 server【文档】；`agent attach` 与 `terminal session` 不转发（实测报 “not an API-backed machine command”）。`--remote <ssh 目标>` 是本地 TUI 经 SSH 挂到远端【文档】。本机没有保存的机器【实测】。面板管远端会话时，列表、读输出、发消息可以经 `--machine`，实时终端流做不了【推断】。

### 缺口（都不挡第一版；前三条值得向 herdr 提）

1. 拿不到终端列数：PaneInfo 只有 `scroll.viewport_rows`；observe 的视口比真实终端小时只截左上角，更大时补空白【实测】。绕法：TUI 挂着时取 `pane.layout` 的矩形，或开足够大的视口再裁【推断】。
2. `agent.prompt` 不能带条件（“会话 id 仍为 X、状态为 idle 才发”），只能先 `agent.get` 再发，中间有毫秒级的竞争窗口【推断】。
3. control 一定会改真实终端尺寸，没有“只输入不改尺寸”的模式【实测】。绕法：看用 observe，输入走 API。
4. 帧里不带应用的终端模式（应用光标键、bracketed paste、鼠标模式）【实测】，xterm.js 没法同步这些模式。
5. 终端流只能经 CLI 子进程拿到，不能经 `--machine` 转发【实测】。
6. 没有“输入框里还有半截文字”的信号【推断】。

### 需要开发者决定的问题

1. 默认 server 要不要从 0.9.1 升到 0.9.3？只影响 control 的鼠标事件；普通重启会结束所有 pane 里的进程，`herdr update --handoff` 能保住进程但是实验功能。
2. 会话与 Work、Task 的对应关系，要不要用 herdr 的 pane tokens 登记（命令行在 `page publish` 等时候顺手写，herdr 侧栏也能看到），还是只记在 `.local/agent/` 里？

## 二、在网页里显示终端

### A：经 herdr 的接口，前端用 xterm.js（推荐）

不轮询 `pane.read` 拼画面（只是快照）。用 herdr 给第三方桥接程序的两条流（0.7.2 起）【文档】：

- **看**：`herdr terminal session observe <pane> --cols N --rows M`，stdout 每行一条 `terminal.frame {seq, full, width, height, encoding:"ansi", bytes:<base64>}`，第一帧 `full: true`，结束时 `terminal.closed {reason}`【实测】；字节直接交给 `xterm.write()`。
- **控**：`herdr terminal session control <pane> [--takeover]`，输出同上；stdin 每行一条 `terminal.input`（文本或 base64 字节）、`terminal.resize`、`terminal.scroll`、`terminal.mouse`（0.9.2 起）、`terminal.release`；实测了 input、resize、release。
- **Bun 下不需要 pty**：`Bun.spawn` 用管道就能驱动 control【实测，Bun 1.4.2】；每个浏览器连接一个子进程，WebSocket 两头转发。

实测行为：

- **多人同看**：两个 observe 加一个 control 同时连着，变化帧同时到达；observe 不改尺寸。
- **只能一个控制者**：第二个 control 不带 takeover 会立刻收到 `terminal.closed`（“already has an attached client; retry with --takeover”）；带 takeover 时前一个收到 “terminal attach taken over”；control 被 kill -9 后控制权自动释放；herdr 的 TUI 客户端不占这个名额。
- **control 会改真实尺寸**：resize 后 `stty size` 立刻变，control 退出后保持；挂上 TUI 后尺寸回到 TUI 的布局。TUI 与网页同时看同一 pane 时尺寸会来回改，Agent 跟着重排【推断，依据文档 “the last one to focus, select, or interact with it controls that tab's pane sizes”】。
- **延迟**：输入后 2 到 20 毫秒收到对应的帧。
- **中文**：帧里每个宽字符前带绝对定位（`ESC[5;40H中ESC[5;42H文`）【实测】，xterm.js 与 herdr 字宽表不一致也不会错位【推断】；`terminal.input` 与 `agent.prompt` 传中文正常【实测】。

输入两种做法：

- **不抢控制权（建议默认）**：屏幕用 observe，输入走 API：普通字符 `pane.send_text`；Esc、Ctrl+C、Shift+Tab、方向键用 `agent.send_keys` 的逻辑键名；整段消息 `agent.prompt`。不改尺寸、不和 TUI 抢；多个浏览器都能发，但输入可能交错。
- **接管键盘**：control 加 takeover，按真实尺寸 resize，输入原样转发，离开时 release。

其余：断线重连就重起一个 observe，第一帧就是整屏【实测】，面板不用缓存屏幕；面板重启不影响 herdr 里的会话，转发子进程随面板退出、控制权自动释放【实测】；浏览器会吃掉 Ctrl+W、Ctrl+T、Ctrl+N，Ctrl+C 和复制冲突，帧里不带应用终端模式，建议页面上提供 Esc、Ctrl+C、Shift+Tab、上、下、y、n、Enter 按钮走逻辑键；手机上 44×105 的屏幕难读、xterm.js 上中文输入法不稳，应以“输入框 + `agent.read --source recent-unwrapped` 的纯文本视图”为主【推断】。

### B：面板后端在 pty 里跑 `herdr agent attach`（不选）

能跑通（`Bun.spawn({terminal:…})` 跑 `herdr terminal attach <terminal_id>`，`ctrl+b q` 退出）【实测】，但和 control 抢同一个名额、没有只读模式；attach 客户端会接管外层终端（备用屏、全部鼠标跟踪、bracketed paste），把 `ctrl+b` 当前缀键；需要 pty、每连接一个进程、不能经 `--machine` 转发。等于 A 里的 control 外面套一层 TUI，没换来什么。

### C：面板自己托管终端（不选）

会话跟着面板进程走，面板一重启 Agent 就没了；丢掉 herdr 的 Agent 识别、状态、通知与开发者已有的 pane，与“面板只做 herdr 的网页前端”相反。

### 需要开发者决定的问题

1. 网页端要不要提供“接管键盘”（control 加 takeover，终端改成网页尺寸、TUI 那边重排）？还是第一版只做观看加 API 输入？
2. 手机上以哪种为主：输入框加纯文本视图，还是缩小的终端画面？

## 三、结构化会话（只说差距）

两种 Agent 都有结构化入口：Claude Code 的 `claude -p --input-format stream-json --output-format stream-json` 与 Agent SDK（权限可由宿主回答），omp 的 `--mode rpc`、`rpc-ui`【实测 `--help`】。能把消息、工具调用、diff 渲染成对话界面，但那是另一种会话，不在 herdr 的 pane 里，开发者现在的 TUI 用法都用不上；两种 Agent 各要一套适配；权限交互要面板自己做；同一会话不能同时由 TUI 与结构化进程驱动【推断】。与“面板 = herdr 前端”不符，不做。

折中：面板可以只读地渲染 Claude 的 `~/.claude/projects/<项目>/<id>.jsonl` 与 omp 的会话 jsonl 当“完整历史”视图（文件都在），输入仍走 herdr；单个 Claude 会话文件最大见到 390 MB、只能读尾部【实测】；这与需求第六节“不读会话内容”冲突。

### 需要开发者决定的问题

1. 要不要允许面板只读会话的 jsonl，显示完整历史？（Claude 工作时终端里只能看到当前一屏。）

## 四、给会话发消息的语义

### 发布时记下“谁在等”

命令行 `page publish`（以及 `answers --wait` 等）在 `HERDR_ENV=1` 时调用 `herdr agent get $HERDR_PANE_ID`，把 agent、`agent_session.value`、pane_id、terminal_id 写进页面的版本记录【推断】。子代理继承父会话的 `HERDR_PANE_ID` 与会话 id【实测】，通知会落到父会话，正好是能接收消息的那个。不在 herdr 里的会话（例如 `omp -p` 后台任务）记为空，面板显示“没有可通知的会话”。

### 发送前核对

1. **找会话**：在 `agent.list` 里按 `agent_session.value` 找，pane_id 只当线索；找不到就提示“会话已结束或已更换”，不发。
2. **会话被换过**：Claude 执行 `/clear` 时钩子会重新报会话，id 会不会变【推断】；面板显示“pane 上已是新会话”，开发者确认后再发。
3. **看状态**：`idle` 或 `done` 发送；`working` 排队，订阅 `pane.agent_status_changed` 等到 idle 或 done、再核对一次身份后发（omp 工作中回车是 steer【文档：omp 源码 `src/modes/types.ts`】；Claude Code 工作中的输入会排队【推断】；`agent.prompt` 本身允许工作中发送，“等空闲”只能由面板保证）；`blocked` 不发（`agent.prompt` 也会拒绝），提示“会话在等确认”，继续排队；`unknown` 不自动发。
4. **发送**：`agent.prompt` 带 `wait:{until:["working","blocked"], timeout_ms:10000}` 确认会话开始干活【推断用法；文档：从非工作状态发送后 5 秒内看不到 working 或 blocked 返回 `agent_prompt_stalled`】。
5. **永远不用 `pane.send_text` 或 `pane.run` 发通知。**

### 消息里放什么

只放一行指针，不放答案正文，例如：`[nbdev] w00022/t03 讲解页 settings-board v2 有开发者答复（3 题）。请运行 nbdev answers w00022 t03 settings-board --json 读取，写进 Task README 后 --ack。` 理由：答案唯一来源是 `answers/` 下的文件；正文一长 Claude Code 会把粘贴折叠成 “[Pasted text]”；固定模板方便在 Agent 规则里写“收到 `[nbdev]` 开头的消息就跑这条命令”。`agent.prompt` 把引号、`$HOME`、`;` 原样送达，不经 shell【实测】。

### 失败提示

| 情况 | 面板提示 | 处理 |
|---|---|---|
| `agent_blocked` | 会话在等确认 | 留在队列里 |
| 会话 id 对不上、`agent_not_running`、`not_found` | 会话已结束或已更换 | 不发；开发者可手动选别的会话 |
| `agent_prompt_stalled` 或 `timeout` | 已写入，但没看到会话开始工作，请查看终端，不要重发 | 文档明确：超时不代表没送达 |
| socket 连不上 | herdr 没在运行 | 答案照常落盘，Agent 仍可用 `answers --wait` 自己取 |

每次尝试追加一条记录（例如 `answers/<页面>/notify-<时间>.json`：时间、会话、结果码）；待发队列由“有未读答案、且没有成功通知记录”现算，面板重启不丢【推断】。

### 风险

- **打进半截输入**：开发者正在 TUI 里打字时，`agent.prompt` 会把指针消息接在半截文字后面一起提交，herdr 没有这个信号。缓解：空闲后再延迟几秒，并用 `agent.read --source detection` 看输入行是否为空【未实测】。（第二轮静态稿实际读到两个会话的输入框里各有一句没发出的话。）
- **Claude 状态误判**：没学过的问答界面会显示成 idle【文档】，消息会打进那个界面。缓解：发送后确认进入 working，没进入就提醒开发者。
- **竞争窗口**：先查后发之间很短的窗口（第一节缺口 2）。

### 需要开发者决定的问题

1. 表单提交后自动通知会话，还是开发者再点一下“通知会话”？建议自动通知，排队等空闲。
2. 会话 id 变了（例如执行过 `/clear`）时，默认不发、等开发者确认（建议），还是直接发给 pane 上的新会话？
3. 除了指针模板，面板要不要提供输入框给会话发任意文字？这是比“通知”大得多的权限，见第五节。

## 五、局域网访问的安全

**威胁**：面板能往 Agent 输入框里打字；Claude Code 的 `!` 前缀直接跑 shell 命令，按 Esc 或 Ctrl+C 退出 Agent 后就是 shell；面板还能看到所有终端内容。面板的登录等同于这台机器的 SSH 登录【推断】。herdr 自己从不监听网络端口，远程一律走 OpenSSH【文档】；面板开端口，正是 herdr 刻意避开的那一面。

最小可行的保护（除注明外均为【推断】的建议）：

1. **绑定**：默认只监听 127.0.0.1；需要局域网时只绑指定地址（例如 wlan0 的 <局域网 IP>），拒绝 0.0.0.0（本机有 docker0 与多个 docker 网桥【实测】，绑 0.0.0.0 会对容器开放）。
2. **传输**：非回环一律 HTTPS。三条路：
   - **Tailscale Serve**：面板仍只绑 127.0.0.1，由 `tailscale serve` 提供带有效证书的 HTTPS，只有自己 tailnet 里的设备能连，附带登录身份；本机已装、tailscale0 在线【实测】；改动最小，手机上方便；依赖 Tailscale 账号与服务。
   - **SSH 隧道**（herdr 的做法）：`ssh -L`，不新增鉴权面；手机上要支持端口转发的 SSH 应用，不顺手。VS Code Remote 的端口转发也算这一类。
   - **面板自带 TLS**：mkcert 签本地 CA（本机未装【实测】），每台设备装 CA，iOS 还要手动信任；或自签证书每台设备点一次警告。维护量最大。
3. **登录用设备配对**：`nbdev panel pair` 打印一次性码或二维码（5 分钟有效、只能用一次）；配对后发随机设备令牌放进 cookie（`HttpOnly; Secure; SameSite=Strict`）；服务端只存令牌哈希、设备名与最近使用时间，可列出、可吊销。要用密码就用 `Bun.password`（argon2id）并限速。
4. **有效期**：设备令牌按空闲时间滑动（例如 14 天），另设绝对上限（例如 90 天）。
5. **请求校验**：Host 白名单防 DNS 重绑定；所有写操作与 WebSocket 升级校验 Origin、拒绝 `Origin: null`（防跨站劫持 WebSocket）；fetch 写请求另带与 cookie 分开的 CSRF 令牌头；回环上同样要做。
6. **产物页换源**：产物页放到另一个源（另一个端口）的沙箱 iframe 里，答案用 postMessage 交给外壳；面板所在源上一个 XSS 就等于一个远程 shell。
7. **herdr 方法白名单**：只开放 list、get、snapshot、subscribe、read、observe、`agent.prompt`、`agent.send_keys`，可选 control；不开放 `pane.run`、`pane.split`、`pane.send_input`、`agent.start`、`workspace.create`、`worktree.*`、`plugin.*`、`server.*`、`layout.apply`、`integration.*`。
8. **分权**：设备分“只看”与“可操作”两级，接管键盘与自由输入只给“可操作”。
9. **审计**：每次发消息、发按键、接管键盘，追加一条记录：设备、会话、动作、文字或长度。

和 herdr 的远程方式比：SSH 或 Tailscale 把鉴权与加密交给成熟组件，面板只需在回环上做配对登录与 Origin 校验；面板自己开局域网端口，TLS 与鉴权的代码和维护都要自己担。建议第一版只绑回环，跨设备走 Tailscale Serve（或 SSH 隧道）；面板自带 TLS 的局域网直连等确实需要时再做。

### 需要开发者决定的问题

1. 跨设备走哪条路：Tailscale Serve（建议）、SSH 隧道，还是面板直接绑 wlan0 并自带 TLS？
2. 登录用设备配对（建议）还是密码？设备令牌有效期多长？
3. 设备要不要分“只看”和“可操作”两级？手机默认哪一级？
4. 设备令牌与审计记录放哪里：建议用户级目录（例如 `~/.config/nbdev/`），凭据不应放在 Agent 可读写的 `.local/agent/`。

## 六、推荐的分期

### 第一版：能看到会话、能通知会话

- **herdr 适配层**（核心库里）：socket JSON 客户端加方法白名单；管理 observe 子进程；启动时 `ping`，检查协议版本与 capabilities，不认识就降级显示。
- **会话列表**：`session.snapshot` 起步，订阅状态与 pane 事件，`events_lost` 时重订并对账；按 tokens 或登记信息关联 Work 与 Task。
- **会话页**：observe 只读实时终端，按真实尺寸渲染、缩放字体；手机上加纯文本视图；输入框走 `agent.prompt`，快捷键按钮走 `agent.send_keys`。
- **回复通道**：表单提交后按第四节自动通知：核对身份、等空闲、发指针消息、记录结果。
- **访问**：只绑 127.0.0.1；设备配对登录；Host、Origin、CSRF 校验；跨设备走 Tailscale Serve 或 SSH 隧道；产物页放到另一个源。
- **主要风险**：Claude 读屏误判成 idle；消息接在开发者的半截输入后面；先查后发的竞争窗口；访问配置出错（比如绑到 0.0.0.0）；herdr 接口变化（当前协议 22，适配层集中处理）。

### 第二版：能在网页里交互

接管键盘（control 加 takeover，提示 TUI 那边会重排）；鼠标事件（server ≥ 0.9.2）；只读的完整历史视图（前提是开发者同意读 jsonl）；远端机器经 `--machine` 列会话、发消息；按需再做面板自带 TLS 的局域网直连、在面板里起新会话（`agent.start` 加建 pane，需要单独授权）。主要风险：尺寸来回争夺、浏览器与终端的键位冲突、手机输入法、jsonl 的体积与隐私边界。

### 可以向 herdr 提的需求（都不阻塞）

PaneInfo 暴露终端列数与行数；`agent.prompt` 支持“会话 id 与状态都匹配才发”；control 提供只输入不改尺寸的模式；帧里带上应用的终端模式。

### 需要开发者决定的问题

1. 接不接受这个分期：第一版只做观看、API 输入与自动通知，接管键盘放到第二版？
