---
标签: ["state:local", "env:timer"]
---

# TerminalView

会话的实时终端（t12）：用 xterm.js 画 herdr 终端流的帧，观看时只读，接管时把键盘原样交给会话。帧由页面经 `source` 交进来（页面管连接与心跳，见 `host/terminal-socket.ts`）；零件只画、只发意图（接管、释放、输入、尺寸）。终端块一律暗色，颜色在运行时从 nb-ui 的暗色配色读，不写字面颜色；nb-ui 没有的 ANSI 色（品红、亮色等）用 xterm.js 的缺省值。

字体：xterm 用 canvas 量字宽，canvas 不认 CSS 变量，字体串里有 `var()` 就整串作废、格宽退回 `10px sans-serif`（字被撑开、缩放失效）。所以挂载时读 `--font-mono` 的计算值拼成具体的字体串（`host/terminal-font.ts`），canvas 仍不接受时换成缺省的等宽字体；同时量出格宽与字号之比，观看时按它缩字号。

## 布局

上面一条模式条，下面是终端；零件占满父容器剩下的高度（会话页是铺满页，t15 阶段 4 第 3 批），观看与接管时终端框一样高。根与框都不设最小高度、根不让内容溢出：放不下时终端变矮，不会盖到后面的输入区上，接管时量出的行数就是看得见的行数（第 3 批审查重要 2）。

- 观看：浅底，“观看中 · 实时画面，只读；键盘在 herdr 那边”，右边是 `actions` 插槽、“接管后按 Ctrl+] 退出”与主按钮“接管键盘”（`canTakeover` 为假时不给，写原因）。`readOnly` 有值时（非 Agent 的 pane）写“实时画面，只读（<原因>）”，不给接管。字号按框的宽、高两个方向缩放，取放得下整屏（列数乘格宽、行数乘格高）的较小值，10 到 14px（窄而高的 pane 也尽量放下整屏；第 3 批审查重要 1。下限原来是 5px，t22 开发者定改成 10px：字小到 6、7px 读不出内容），按比例估的放不下就再小一号，容器尺寸变了就重算；到 10px 仍放不下时在终端框里横竖滚动，并贴着底（最新的几行与输入行在最下面；开发者往上翻过就不动）。
- 接管：整条换成强调色实底，“你在接管键盘 · 你打的字直接进这一格……终端按网页尺寸 C×R；切到别的标签页或离开会自动释放”、“按 Ctrl+] 退出”、“释放”；下面一行小字写浏览器拦得住与拦不住的键。字号固定 13px，容器尺寸变了（去抖 150 毫秒）就按新的列数与行数发 `resize`。
- 点“接管键盘”时发出的 `takeover` 尺寸按接管后的样子量：字号换成 13px，量完同步改回，接上之后不必再改一次尺寸。框高观看与接管时一样，所以不再临时套高度。量这个尺寸与接管中窗口变化时用同一个算法，结果只取决于框的尺寸与字号，所以切到接管模式时 ResizeObserver 再量一次也是同一个数，不会再 resize：
  - 一格的宽高取 xterm 的 `device.cell`（设备像素）除以 dpr，不用 `@xterm/addon-fit` 用的 `css.cell`。xterm 的 DOM 渲染器先把整屏宽度取整再除回列数，`css.cell` 随当前列数变：13px 时字宽 6.5，当前列数是奇数时格宽进位、量出的列数少 1，接上之后变成偶数列再量又多 1（1280 宽 138 变 139，1592×900 下 186 变 187）。`_core._renderService.dimensions` 是 xterm 的私有字段（fit 插件读的也是它），升级 xterm 时要核对 `device.cell` 的含义没变；不再用 fit 插件。
  - 先把框的溢出藏起来：框里还是旧尺寸的画面（例如从更大的窗口“抢过来”）时会出滚动条，桌面浏览器的滚动条占位，把内容区挤掉一行几列，接上之后滚动条消失、又会 resize 一次。无头 Chrome 缺省带 `--hide-scrollbars`，验收时要去掉它才看得出。
- 尺寸读不到时状态条加一句“尺寸不确定，可能裁切”。
- 回滚与滚动条（t15，决定点 23）：不开回滚（`scrollback: 0`）。2026-10-14 实测 herdr 0.9.3 的观察流在增量帧里按光标定位逐行改写整屏、不用换行滚屏，xterm 开着回滚也攒不下（第 3 批审查第 6 条），所以往回翻不靠终端：读得到更早输出的会话（omp）与没有会话键的 pane 由页面给“更早的输出”，读不到的（Claude 这类在备用屏上的会话）页面写“只能看当前屏；更早的输出去 herdr 里翻”。没有回滚就没有 xterm 自绘的滑块，量列数与观看的字号都不给它让宽度；空的 `.xterm-viewport` 也不画原生轨道（`app.css`，不影响列数）。以后 herdr 的帧改成滚屏、要开回滚时注意：自绘条宽 14px，盖在终端右缘，量列数要先减掉它，否则最后一列落在滑块下面，点不中也选不中（2026-10-14 实测）。

## 交互

- 接管期间键盘输入原样发出（`input`）；粘贴先清洗（去掉 Esc 等控制字符、换行转 `\r`），`bracketedPaste` 为真时在 xterm 本地打开 bracketed paste，粘贴被 `\e[200~ … \e[201~` 包住（实测 Claude、omp 都开着它；帧里不带应用的终端模式）。
- Ctrl+]：接管中由零件截下，当“释放”（发 `release`），不发给会话。接管中 Tab、Esc 都交给终端，没有它就是键盘陷阱；观看时不截。
- Ctrl+C：有选中的文字时交给浏览器复制，不发；没有时发 `\x03`。Ctrl+W、Ctrl+T、Ctrl+N 浏览器拦不住，提示用 Alt+Backspace 删词。
- 帧里的超链接（OSC 8）只放行 `http`、`https`，点了发 `open-link`，由页面在新标签页打开。
- 不做鼠标事件（要 herdr server 0.9.2 以上）。

## 数据

```ts
interface TerminalViewProps {
    /** 帧的来源（页面的终端连接）；必填，在零件实例的一生里不变（宿主换连接时用 key 重建零件，t15） */
    source: TerminalSource;
    /** 观看还是接管；必填、受控 */
    mode: "watch" | "control";
    /** 服务端给的尺寸（接管时是网页的尺寸）与是否读到了真实尺寸；必填 */
    cols: number;
    rows: number;
    sizeKnown: boolean;
    /** 这个 pane 的应用开着 bracketed paste（Claude、omp）；必填 */
    bracketedPaste: boolean;
    /** 能不能接管（手机上不给）；为 false 时用 `takeoverBlocked` 写原因；必填 */
    canTakeover: boolean;
    takeoverBlocked: string | null;
    /** 另一个浏览器正在接管时的说明；可选，默认 null */
    controllerNote?: string | null;
    /** 接管或释放的请求在途；可选，默认 false */
    pending?: boolean;
    /** 只读观看的原因（非 Agent 的 pane，D2）：有值时模式条在“只读”后面括号里写它，不给接管；可选，默认 null */
    readOnly?: string | null;
}
interface TerminalViewEmits {
    /** 点了“接管键盘”：按 13px 字号算出的列数与行数 */
    (event: "takeover", cols: number, rows: number): void;
    /** 点了“释放”，或接管中按了 Ctrl+] */
    (event: "release"): void;
    /** 接管时的键盘输入；`paste` 为真表示是一次粘贴 */
    (event: "input", data: string, paste: boolean): void;
    (event: "resize", cols: number, rows: number): void;
    (event: "open-link", url: string): void;
}
```

xterm 实例是零件自己的（`state:local`），容器尺寸变了的去抖用定时器（`env:timer`），卸载时一起销毁。插槽 `actions`：观看时模式条右边、接管按钮之前的额外操作（会话页放“更早的输出”“回到文字视图”）。没有 expose。
