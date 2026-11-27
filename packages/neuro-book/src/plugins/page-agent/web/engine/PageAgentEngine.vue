<script lang="ts">
/**
 * 页面引擎的挂载点（docs/specs/agent/page-agent.md 输出 15）：工作台把它当浮层挂在首页与工作台页的根上，随窗口启动；
 * 不画任何东西。它建引擎、记最近一次用户真实输入的时刻，经 `connect` 把 `PageSide` 交给浏览器入口。
 */

import {defineComponent, onBeforeUnmount} from "vue";
import type {PropType} from "vue";

import {createPageAgent} from "@notnotype/nb-page-agent";
import type {GuideOptions, GuideTheme} from "@notnotype/nb-page-agent";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {CAPTURE_MAX_BYTES, CAPTURE_MAX_EDGE} from "../../shared/contracts";
import {guideText} from "../guide-text";
import type {CaptureOutcome, ConnectPage, PageSide} from "../page-side";

/** 算“最近有用户输入”的事件：脚本派发的不算（`isTrusted`）。 */
const INPUT_EVENTS = ["keydown", "pointerdown", "wheel"] as const;

/**
 * 截图：snapdom 只在第一次截图时才加载，不拖慢窗口启动。截图前后页面都可能变，`of` 在截之前定位一次；窗口看不见时不截
 * （服务端选窗口时已经核对过，这里核对的是调用到达时的状态）。
 */
async function captureNow(agent: ReturnType<typeof createPageAgent>, of: Parameters<PageSide["capture"]>[0]): Promise<CaptureOutcome> {
    if (document.visibilityState !== "visible") return {ok: false, code: "window-hidden", message: "这个窗口现在看不见"};
    let target: Element | null = null;
    let warnings: readonly string[] = [];
    if (of !== undefined) {
        const found = agent.locate(of, {explain: true});
        if (!found.ok) return found;
        target = found.element;
        warnings = found.warnings;
    }
    try {
        const {capturePage} = await import("@notnotype/nb-page-agent/capture");
        const captured = await capturePage(document, target, {maxEdge: CAPTURE_MAX_EDGE, maxBytes: CAPTURE_MAX_BYTES});
        return {ok: true, target: target === null ? "window" : "element", image: captured.blob, width: captured.width, height: captured.height, warnings};
    } catch (error) {
        // 重画、编码失败（例如元素没有大小、缩到最小仍超过上限）都交回 capture-failed，原因写进说明。
        return {ok: false, code: "capture-failed", message: error instanceof Error ? error.message : String(error)};
    }
}

/**
 * 说明框取 NeuroBook 的主题变量（docs/specs/agent/page-agent.md 输出 10；外观按 w00033 t03 第 1 轮静态稿：浮层的外框与底色、
 * 小号按钮、模态遮罩的颜色）。值是 `var(...)`，在说明框挂进的那一层上取，跟着那里的主题走。
 */
const GUIDE_THEME: GuideTheme = {
    accent: "var(--accent-main)",
    onAccent: "var(--text-inverse)",
    surface: "var(--overlay-surface)",
    outline: "var(--panel-outline)",
    shadow: "var(--elevation-popover)",
    blur: "var(--overlay-blur)",
    text: "var(--text-main)",
    textSecondary: "var(--text-secondary)",
    textMuted: "var(--text-muted)",
    radius: "var(--radius-panel)",
    controlRadius: "var(--radius-button-sm)",
    controlHeight: "var(--control-h-sm)",
    font: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontSizeSmall: "var(--text-xs)",
    fontSizeTiny: "var(--text-2xs)",
    dim: "var(--overlay-bg)",
};

/**
 * 悬停才显示的工作台动作（docs/specs/workbench/views.md 输出 25）：高亮其中的按钮时给它所在的动作区写 `data-nb-agent-reveal`，
 * 这期间一直显示。引擎保证换下一个高亮时上一次先撤、这一次再写，同一个动作区的两步不会互相撤掉。
 */
const reveal: NonNullable<GuideOptions["reveal"]> = (target) => {
    const zone = target.closest("[data-hover-actions]");
    if (zone === null) return undefined;
    zone.setAttribute("data-nb-agent-reveal", "");
    return () => zone.removeAttribute("data-nb-agent-reveal");
};

function currentPath(): string {
    const raw = location.pathname + location.search;
    try {
        return decodeURIComponent(raw);
    } catch {
        // 路径里有不成对的百分号编码：照原样交回。
        return raw;
    }
}

export default defineComponent({
    name: "PageAgentEngine",
    props: {
        connect: {type: Function as PropType<ConnectPage>, required: true},
        /** 窗口的翻译端口：说明框上的文字随界面语言。 */
        text: {type: Object as PropType<TextPort>, required: true},
    },
    setup(props) {
        const agent = createPageAgent({guide: {text: () => guideText(props.text), theme: GUIDE_THEME, reveal}});
        let lastInputAt: number | null = null;
        const onInput = (event: Event): void => {
            if (event.isTrusted) lastInputAt = Date.now();
        };
        for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, {capture: true, passive: true});
        const page: PageSide = {
            info: () => ({
                name: agent.refPrefix,
                title: document.title.slice(0, 512),
                path: currentPath().slice(0, 2048),
                width: window.innerWidth,
                height: window.innerHeight,
                visible: document.visibilityState === "visible",
                focused: document.hasFocus(),
                lastInputAt,
            }),
            snapshot: (args) => agent.snapshot(args),
            present: (locator) => {
                const found = agent.locate(locator);
                return found.ok || found.code === "ambiguous";
            },
            capture: (of) => captureNow(agent, of),
            highlight: (args) => agent.highlight(args),
        };
        const release = props.connect(page);
        onBeforeUnmount(() => {
            for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, {capture: true});
            release();
        });
        return () => null;
    },
});
</script>
