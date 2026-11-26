<script lang="ts">
/**
 * 页面引擎的挂载点（docs/specs/agent/page-agent.md 输出 15）：工作台把它当浮层挂在首页与工作台页的根上，随窗口启动；
 * 不画任何东西。它建引擎、记最近一次用户真实输入的时刻，经 `connect` 把 `PageSide` 交给浏览器入口。
 */

import {defineComponent, onBeforeUnmount} from "vue";
import type {PropType} from "vue";

import {createPageAgent} from "@notnotype/nb-page-agent";

import {CAPTURE_MAX_BYTES, CAPTURE_MAX_EDGE} from "../../shared/contracts";
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
    if (of !== undefined) {
        const found = agent.locate(of);
        if (!found.ok) return found;
        target = found.element;
    }
    try {
        const {capturePage} = await import("@notnotype/nb-page-agent/capture");
        const captured = await capturePage(document, target, {maxEdge: CAPTURE_MAX_EDGE, maxBytes: CAPTURE_MAX_BYTES});
        return {ok: true, target: target === null ? "window" : "element", image: captured.blob, width: captured.width, height: captured.height};
    } catch (error) {
        // 重画、编码失败（例如元素没有大小、缩到最小仍超过上限）都交回 capture-failed，原因写进说明。
        return {ok: false, code: "capture-failed", message: error instanceof Error ? error.message : String(error)};
    }
}

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
    },
    setup(props) {
        const agent = createPageAgent();
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
