<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {Terminal} from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {letBrowserCopy, sanitizePaste} from "../host/terminal-input.js";
import {TERMINAL_FONT_FALLBACK} from "../host/terminal-font.js";
import type {TerminalFrame, TerminalSource} from "../host/terminal-socket.js";
import {applyTerminalScope, measureCellRatio, readTerminalFont, readTerminalTheme} from "../host/terminal-theme.js";

/** 会话的实时终端：观看只读，接管时键盘直通；契约见同名 .md。 */
const props = withDefaults(defineProps<{
    source: TerminalSource;
    mode: "watch" | "control";
    cols: number;
    rows: number;
    sizeKnown: boolean;
    bracketedPaste: boolean;
    canTakeover: boolean;
    takeoverBlocked: string | null;
    controllerNote?: string | null;
    pending?: boolean;
    /** 只读观看的原因（非 Agent 的 pane）：有值时模式条在“只读”后面括号里写这句，不给接管（t15 阶段 4 第 3 批，D2）。 */
    readOnly?: string | null;
}>(), {controllerNote: null, pending: false, readOnly: null});
const emit = defineEmits<{takeover: [cols: number, rows: number]; release: []; input: [data: string, paste: boolean]; resize: [cols: number, rows: number]; "open-link": [url: string]}>();

const CONTROL_FONT = 13;
/**
 * 观看时字号的范围：放得下整屏就放下，放不下就在框里横竖滚动。下限 10px（t22，开发者定）：原来是 5px，
 * 桌面右栏约 760px 宽、会话 160 多列时字只有 6 到 7px，读不出内容，只能接管才看得清。代价是宽的会话一眼看不到右半边。
 */
const WATCH_FONT_MIN = 10;
const WATCH_FONT_MAX = 14;
/**
 * 不开回滚（决定点 23）：herdr 的观察流在增量帧里按光标定位逐行改写整屏、不换行滚屏，xterm 攒不下回滚（2026-10-14 实测）。
 * 没有回滚 xterm 就不画自绘滑块，量列数不用给它让 14px。以后 herdr 的帧改成滚屏、要开回滚时，量列数要先减掉滑块的宽度，
 * 否则最后一列落在滑块下面、选不中（阶段 2 实测）。
 */
const SCROLLBACK = 0;
const host = ref<HTMLDivElement | null>(null);
const frameBox = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let unsubscribe: (() => void) | null = null;
let observer: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let pasting = false;
/** 一格的宽度与字号之比，挂载时按实际字体量（拿不到时按等宽字常见的 0.6）。 */
let cellRatio = 0.6;
/** 一行的高度与字号之比：挂载后按 xterm 量出的格高算（拿不到时按 1.2）。 */
let rowRatio = 1.2;
/** 框的内边距（`p-2`）两边加起来。 */
const BOX_PADDING = 16;

/** 一格的宽高（CSS 像素），取 xterm 不随列数变的 `device.cell`；还没量出来时为 null。 */
function cellSize(): {width: number; height: number} | null {
    if (!term) return null;
    const cell = (term as unknown as XtermRenderDimensions)._core._renderService.dimensions.device.cell;
    const dpr = window.devicePixelRatio || 1;
    return cell.width > 0 && cell.height > 0 ? {width: cell.width / dpr, height: cell.height / dpr} : null;
}

/**
 * 观看时字号按框的宽、高两个方向缩放，取放得下整屏的较小值，控制在 `WATCH_FONT_MIN` 到 `WATCH_FONT_MAX`（第 3 批审查重要 1）：
 * 铺满页里框高是布局给的，只按宽度算时窄而高的 pane（左右分屏）下半屏落在框外，最新的输出与输入行默认看不到。
 * 按比例估的字号放不下（行高取整）就再小一号；到最小字号仍放不下，框里滚动并贴着底。
 */
function fitWatchFont(): void {
    const box = frameBox.value;
    if (!term || !box || props.mode !== "watch") return;
    const width = box.clientWidth - BOX_PADDING;
    const height = box.clientHeight - BOX_PADDING;
    let size = Math.max(WATCH_FONT_MIN, Math.min(WATCH_FONT_MAX, Math.floor(width / (term.cols * cellRatio)), Math.floor(height / (term.rows * rowRatio))));
    if (term.options.fontSize !== size) term.options.fontSize = size;
    let cell = cellSize();
    while (cell && size > WATCH_FONT_MIN && (cell.height * term.rows > height || cell.width * term.cols > width)) {
        size -= 1;
        term.options.fontSize = size;
        const next = cellSize();
        // xterm 改字号时同步重量格子；没量（格子没变）就不往下减，等下一帧或下一次尺寸变化再算。
        if (!next || (next.width === cell.width && next.height === cell.height)) break;
        cell = next;
    }
    stickToBottom();
}

/** 框放不下整屏时（最小字号）滚到底：最新的几行与输入行在最下面。开发者自己往上翻过就不动。 */
let followBottom = true;
function stickToBottom(): void {
    const box = frameBox.value;
    if (box && followBottom) box.scrollTop = box.scrollHeight;
}
function onBoxScroll(): void {
    const box = frameBox.value;
    if (box) followBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
}

function onFrame(frame: TerminalFrame): void {
    if (!term) return;
    if (term.cols !== frame.w || term.rows !== frame.h) term.resize(frame.w, frame.h);
    fitWatchFont();
    term.write(frame.bytes, stickToBottom);
}

/**
 * xterm 的渲染尺寸（私有字段）。`@xterm/addon-fit` 读的也是这个对象，不过它读 `css.cell`；这里读 `device.cell`。
 * 升级 xterm 时要核对：`device.cell` 仍是不随列数变的一格（设备像素），见同名 .md。
 */
type XtermRenderDimensions = {_core: {_renderService: {dimensions: {device: {cell: {width: number; height: number}}}}}};

/**
 * 按框量终端放得下多少列、多少行，结果只取决于框的尺寸与字号，量几次都一样：
 * - 一格的宽高用 `device.cell` 除以 dpr，不用 fit 的 `css.cell`。xterm 的 DOM 渲染器先把整屏宽度取整再除回列数，`css.cell` 随当前列数变：
 *   13px 时字宽 6.5，当前列数是奇数时格宽进位、量出的列数少 1，接上之后变成偶数列，再量又多 1，于是又 resize 一次；
 * - 量的时候先把框的溢出藏起来：框里还是旧尺寸的画面时，13px 下可能溢出、出滚动条，桌面浏览器的滚动条占位，把内容区挤掉一行几列
 *   （无头 Chrome 缺省不画滚动条，验收时要带上它才看得出）。
 * 改动都在同一个同步块里改回，中间不会画到屏幕上。
 */
function proposeSize(box: HTMLElement): {cols: number; rows: number} | null {
    const element = term?.element;
    const parent = element?.parentElement;
    const cell = cellSize();
    if (!term || !element || !parent || !cell) return null;
    const overflow = box.style.overflow;
    box.style.overflow = "hidden";
    const outer = getComputedStyle(parent);
    const inner = getComputedStyle(element);
    const width = parseInt(outer.width) - parseInt(inner.paddingLeft) - parseInt(inner.paddingRight);
    const height = parseInt(outer.height) - parseInt(inner.paddingTop) - parseInt(inner.paddingBottom);
    box.style.overflow = overflow;
    return {cols: Math.max(2, Math.floor(width / cell.width)), rows: Math.max(1, Math.floor(height / cell.height))};
}

/**
 * 按接管后的样子量：字号换成 13px，量完同步改回（中间不会画到屏幕上）。框的高度由会话页的布局给定（铺满页里占满剩下的高度），
 * 观看与接管时一样，所以不再临时套高度（以前观看时框高随行数，要先套上接管时的 70vh）。
 */
function proposeControlSize(): {cols: number; rows: number} | null {
    const box = frameBox.value;
    if (!term || !box) return null;
    const before = term.options.fontSize;
    term.options.fontSize = CONTROL_FONT;
    const proposed = proposeSize(box);
    term.options.fontSize = before;
    return proposed;
}

function requestTakeover(): void {
    const size = proposeControlSize();
    if (size) emit("takeover", size.cols, size.rows);
}

onMounted(() => {
    const element = host.value!;
    applyTerminalScope(frameBox.value!);
    let fontFamily = readTerminalFont(frameBox.value!);
    let ratio = measureCellRatio(fontFamily);
    if (ratio === null) {
        console.warn(`终端字体串不被 canvas 接受，改用缺省的等宽字体：${fontFamily}`);
        fontFamily = TERMINAL_FONT_FALLBACK;
        ratio = measureCellRatio(fontFamily);
    }
    if (ratio !== null && ratio > 0) cellRatio = ratio;
    term = new Terminal({
        scrollback: SCROLLBACK,
        disableStdin: props.mode !== "control",
        cursorBlink: false,
        fontFamily,
        fontSize: CONTROL_FONT,
        theme: readTerminalTheme(frameBox.value!),
        linkHandler: {
            activate: (_event, text) => {
                if (/^https?:\/\//iu.test(text)) emit("open-link", text);
            },
        },
    });
    term.open(element);
    const measured = cellSize();
    if (measured) rowRatio = measured.height / CONTROL_FONT;
    if (props.bracketedPaste) term.write("\u001b[?2004h");
    term.attachCustomKeyEventHandler((event) => {
        // Ctrl+] 是接管时固定的退出键（终稿第 11 条）：面板拦下当“释放”，不发给这一格。接管中 Tab、Esc 都交给终端，没有它就是键盘陷阱。
        if (props.mode === "control" && event.ctrlKey && !event.altKey && !event.metaKey && (event.code === "BracketRight" || event.key === "]")) {
            if (event.type === "keydown") {
                event.preventDefault();
                emit("release");
            }
            return false;
        }
        return !letBrowserCopy(event, term?.hasSelection() ?? false);
    });
    term.onData((data) => {
        if (props.mode === "control") emit("input", data, pasting);
    });
    // 粘贴先清洗再交给 xterm（它按本地的 bracketed paste 模式决定包不包）。
    element.addEventListener("paste", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (props.mode !== "control" || !term) return;
        const text = sanitizePaste(event.clipboardData?.getData("text/plain") ?? "");
        if (text === "") return;
        pasting = true;
        term.paste(text);
        pasting = false;
    }, {capture: true});
    unsubscribe = props.source.subscribe(onFrame);
    observer = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            if (props.mode === "watch") return fitWatchFont();
            if (!term || !frameBox.value) return;
            const size = proposeSize(frameBox.value);
            if (size && (size.cols !== props.cols || size.rows !== props.rows)) emit("resize", size.cols, size.rows);
        }, 150);
    });
    observer.observe(frameBox.value!);
});

watch(() => props.mode, (mode) => {
    if (!term) return;
    term.options.disableStdin = mode !== "control";
    if (mode === "control") {
        term.options.fontSize = CONTROL_FONT;
        term.focus();
    } else {
        fitWatchFont();
    }
});
watch(() => props.bracketedPaste, (on) => term?.write(on ? "\u001b[?2004h" : "\u001b[?2004l"));

onBeforeUnmount(() => {
    unsubscribe?.();
    observer?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    term?.dispose();
    term = null;
});

const sizeLabel = computed(() => `${props.cols}×${props.rows}`);
</script>

<template>
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="实时终端">
        <!-- 模式条：一眼看出是只读观看还是你在接管（ux-b F13）；接管时整条换成强调色实底，写明 Ctrl+] 退出。 -->
        <div v-if="mode === 'watch'" class="nbdev-term-bar nbdev-small flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
            <span class="i-lucide-eye size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1"><b>观看中</b> · {{ readOnly ? `实时画面，只读（${readOnly}）` : "实时画面，只读；键盘在 herdr 那边" }}<template v-if="!sizeKnown">；尺寸不确定，可能裁切</template><template v-if="controllerNote">；{{ controllerNote }}</template></span>
            <slot name="actions" />
            <template v-if="!readOnly">
                <span v-if="canTakeover" class="nbdev-secondary">接管后按 <kbd class="nbdev-kbd">Ctrl+]</kbd> 退出</span>
                <Button v-if="canTakeover" size="sm" variant="primary" icon-class="i-lucide-keyboard" :loading="pending" @click="requestTakeover">接管键盘</Button>
                <span v-else class="nbdev-empty">{{ takeoverBlocked }}</span>
            </template>
        </div>
        <div v-else class="nbdev-term-bar nbdev-term-bar-control nbdev-small flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2" role="status">
            <span class="i-lucide-keyboard size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1"><b>你在接管键盘</b> · 你打的字直接进这一格，herdr 那边的输入照样能写进来；终端按网页尺寸 {{ sizeLabel }}；切到别的标签页或离开会自动释放</span>
            <span>按 <kbd class="nbdev-kbd">Ctrl+]</kbd> 退出</span>
            <Button size="sm" variant="secondary" :loading="pending" @click="emit('release')">释放</Button>
        </div>
        <p v-if="mode === 'control'" class="nbdev-caption px-3 py-1">浏览器会拦下 Ctrl+W、Ctrl+T、Ctrl+N（删词用 Alt+Backspace）；有选中的文字时 Ctrl+C 是复制。</p>
        <!-- 终端占满剩下的高度（会话页是铺满页），观看与接管时框高一样，接管尺寸就按它量。根与框都不设会溢出的最小高度：
             放不下时宁可终端变矮，也不能盖到后面的输入区上，接管时量出的行数才等于看得见的行数（第 3 批审查重要 2）。 -->
        <div ref="frameBox" class="relative min-h-0 flex-1 overflow-auto bg-[var(--bg-main)] p-2" @scroll.passive="onBoxScroll">
            <div ref="host" class="h-full" />
        </div>
    </section>
</template>

<style scoped>
.nbdev-term-bar {
    background: var(--bg-hover);
    border-bottom: var(--border-w, 1px) solid var(--divider);
}
/* 接管中：强调色实底、白字，与观看中的浅底一眼分得开（高危状态更醒目）。 */
.nbdev-term-bar-control {
    background: var(--accent-main);
    color: var(--text-inverse);
}
.nbdev-kbd {
    border: 1px solid currentColor;
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 0.3em;
    font-family: var(--font-mono);
    font-size: 0.92em;
}
</style>
