/**
 * 注入每个页面的测量代理（w00017 t72，`context.addInitScript(pageAgent, options)`）：每次导航在产品脚本之前重新安装。
 * 起止都在页面里记（`performance.now()` 同一时间原点），不含 Playwright 的等待与往返。函数会被序列化后注入，必须
 * 自包含：不引用模块里的任何东西。
 *
 * - 起点：`window` 捕获阶段的 `pointerdown` 的 `event.timeStamp`（真实鼠标点击，由 Playwright 的 `page.mouse` 发出）。
 * - 终点：`committed` 是 `requestAnimationFrame` 回调里条件第一次成立的时刻（DOM 已改，这一帧结束时画出来）；
 *   `presented` 是其后下一个 rAF 回调的时刻（上一帧已经呈现），并要求条件在这一帧仍成立。同时记经过了几帧。
 * - 卡顿与事件：`long-animation-frame`、`longtask`、`event`（Event Timing）全程收集，按时间窗归给场景；浏览器不支持的
 *   类型记在 `unsupported` 里，报告写“不可用”，不当作 0。
 * - 进度条：`[data-editor-progress]` 每次插入与移除的时刻。
 */

export type ArmSpec =
    /** 点资源管理器的行或标签打开文件：等选中（`fromRow` 时）与活动标签切到它、正文含标记且可输入。 */
    | {readonly kind: "open"; readonly address: string; readonly marker: string; readonly editor: "markdown" | "code"; readonly fromRow: boolean}
    /** 点目录展开：第一个子行出现为 committed，可见区的子行稳定两帧为 settled。 */
    | {readonly kind: "expand"; readonly address: string};

export interface ArmResult {
    readonly start: number;
    /** 选中与标签都切过去（`open`）或第一个子行出现（`expand`）：committed 与 presented 相对起点的时长，以及帧数。 */
    readonly feedbackCommitted: number;
    readonly feedbackPresented: number;
    readonly feedbackFrames: number;
    /** 正文含标记且可输入（`open`）；可见子行稳定（`expand`）。 */
    readonly doneCommitted: number;
    readonly donePresented: number;
    readonly doneFrames: number;
    readonly error: string | null;
}

export interface AgentOptions {
    /** 文件树可操作时必须可见的根下行（资源地址）。 */
    readonly roots: ReadonlyArray<string>;
}

export interface TimedEvent {
    readonly name: string;
    readonly interactionId: number;
    readonly start: number;
    readonly processingStart: number;
    readonly processingEnd: number;
    readonly duration: number;
}

export interface PerfAgent {
    arm(spec: ArmSpec): void;
    result: Promise<ArmResult> | null;
    /** 文件树可操作的第一帧（相对导航开始）；还没到为 null。 */
    treeReadyAt: number | null;
    readonly unsupported: ReadonlyArray<string>;
    readonly progress: Array<{readonly at: number; readonly kind: "added" | "removed"}>;
    readonly frames: Array<{readonly start: number; readonly duration: number; readonly blocking: number}>;
    readonly tasks: Array<{readonly start: number; readonly duration: number}>;
    readonly events: TimedEvent[];
    /** 记录每一帧的 rAF 时刻，直到 `stopFrames`；滚动场景用来算帧间隔。 */
    startFrames(): void;
    stopFrames(): number[];
}

declare global {
    interface Window {
        __perf?: PerfAgent;
    }
}

export function pageAgent(options: AgentOptions): void {
    const visible = (element: Element | null): boolean => element instanceof HTMLElement && element.checkVisibility();
    const wanted = ["long-animation-frame", "longtask", "event"];
    const supported = PerformanceObserver.supportedEntryTypes;
    let recording: number[] | null = null;
    const agent: PerfAgent = {
        arm: () => undefined,
        result: null,
        treeReadyAt: null,
        unsupported: wanted.filter((type) => !supported.includes(type)),
        progress: [],
        frames: [],
        tasks: [],
        events: [],
        startFrames: () => {
            const timestamps: number[] = [];
            recording = timestamps;
            const tick = (): void => {
                if (recording !== timestamps) return;
                timestamps.push(performance.now());
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        },
        stopFrames: () => {
            const timestamps = recording ?? [];
            recording = null;
            return timestamps;
        },
    };
    window.__perf = agent;

    if (supported.includes("long-animation-frame")) {
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) agent.frames.push({start: entry.startTime, duration: entry.duration, blocking: (entry as PerformanceEntry & {blockingDuration?: number}).blockingDuration ?? 0});
        }).observe({type: "long-animation-frame", buffered: true});
    }
    if (supported.includes("longtask")) {
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) agent.tasks.push({start: entry.startTime, duration: entry.duration});
        }).observe({type: "longtask", buffered: true});
    }
    if (supported.includes("event")) {
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as PerformanceEventTiming[]) {
                agent.events.push({name: entry.name, interactionId: (entry as PerformanceEventTiming & {interactionId?: number}).interactionId ?? 0, start: entry.startTime, processingStart: entry.processingStart, processingEnd: entry.processingEnd, duration: entry.duration});
            }
        }).observe({type: "event", buffered: true, durationThreshold: 16} as PerformanceObserverInit);
    }

    // 文件树可操作：根目录的列出结果已到（根下的这些行都可见），树本身在。
    const watchTree = (): void => {
        const tree = document.querySelector("[data-explorer-tree]");
        if (tree !== null && options.roots.every((address) => visible(document.querySelector(`[data-explorer-row="${address}"]`)))) {
            agent.treeReadyAt = performance.now();
            return;
        }
        requestAnimationFrame(watchTree);
    };
    requestAnimationFrame(watchTree);

    const watchProgress = (): void => {
        const isProgress = (node: Node): boolean => node instanceof Element && (node.matches("[data-editor-progress]") || node.querySelector("[data-editor-progress]") !== null);
        new MutationObserver((records) => {
            const now = performance.now();
            for (const record of records) {
                for (const node of record.addedNodes) if (isProgress(node)) agent.progress.push({at: now, kind: "added"});
                for (const node of record.removedNodes) if (isProgress(node)) agent.progress.push({at: now, kind: "removed"});
            }
        }).observe(document.documentElement, {childList: true, subtree: true});
    };
    if (document.documentElement !== null) watchProgress();
    else document.addEventListener("DOMContentLoaded", watchProgress, {once: true});

    const editable = (spec: Extract<ArmSpec, {kind: "open"}>): boolean => {
        const host = document.querySelector(`[data-editor-group-active] [data-editor-kind="${spec.editor}"]`);
        if (host === null || !visible(host)) return false;
        if (spec.editor === "markdown") {
            const prose = host.querySelector("[data-editor-prose]");
            return prose !== null && prose.getAttribute("contenteditable") === "true" && (prose.textContent ?? "").includes(spec.marker);
        }
        const lines = host.querySelector(".view-lines");
        const input = host.querySelector(".monaco-editor textarea");
        return lines !== null && input !== null && input.getAttribute("aria-readonly") !== "true" && (lines.textContent ?? "").includes(spec.marker);
    };
    const switched = (spec: Extract<ArmSpec, {kind: "open"}>): boolean => {
        const tab = [...document.querySelectorAll("[data-editor-group-active] [data-editor-tab]")].find((candidate) => candidate.getAttribute("title") === spec.address);
        if (tab?.getAttribute("aria-selected") !== "true") return false;
        return !spec.fromRow || document.querySelector(`[data-explorer-row="${spec.address}"]`)?.getAttribute("aria-selected") === "true";
    };
    const childRows = (address: string): number => document.querySelectorAll(`[data-explorer-row^="${address}/"]`).length;

    agent.arm = (spec) => {
        agent.result = new Promise<ArmResult>((resolve) => {
            let start = -1;
            let frames = 0;
            // 每个终点：条件第一次成立的帧（committed）与下一帧（presented，条件仍成立才算）。
            const feedback = {committed: -1, presented: -1, frames: -1};
            const done = {committed: -1, presented: -1, frames: -1};
            let lastCount = -1;
            let stable = 0;
            const finish = (error: string | null): void => resolve({
                start,
                feedbackCommitted: feedback.committed,
                feedbackPresented: feedback.presented,
                feedbackFrames: feedback.frames,
                doneCommitted: done.committed,
                donePresented: done.presented,
                doneFrames: done.frames,
                error,
            });
            const step = (point: {committed: number; presented: number; frames: number}, holds: boolean, now: number): void => {
                if (point.presented >= 0) return;
                if (point.committed >= 0) {
                    if (holds) {
                        point.presented = now - start;
                        point.frames = frames;
                    } else {
                        point.committed = -1;
                    }
                } else if (holds) {
                    point.committed = now - start;
                }
            };
            const tick = (): void => {
                const now = performance.now();
                frames += 1;
                if (now - start > 15_000) {
                    // 带上超时那一刻的状态，便于判断是哪一个条件没有成立。
                    const state = spec.kind === "open"
                        ? {switched: switched(spec), editable: editable(spec), activeTab: document.querySelector("[data-editor-group-active] [data-editor-tab][aria-selected=\"true\"]")?.getAttribute("title"), groups: document.querySelectorAll("[data-editor-group]").length, text: (document.querySelector(`[data-editor-group-active] [data-editor-kind="${spec.editor}"]`)?.textContent ?? "").slice(0, 60)}
                        : {children: childRows(spec.address), expanded: document.querySelector(`[data-explorer-row="${spec.address}"]`)?.getAttribute("aria-expanded")};
                    finish(`15 秒内没有完成：${JSON.stringify(spec)}；此刻 ${JSON.stringify(state)}`);
                    return;
                }
                if (spec.kind === "open") {
                    step(feedback, switched(spec), now);
                    if (feedback.presented >= 0 || feedback.committed >= 0) step(done, editable(spec), now);
                } else {
                    const count = childRows(spec.address);
                    step(feedback, count > 0, now);
                    stable = count > 0 && count === lastCount ? stable + 1 : 0;
                    lastCount = count;
                    if (stable >= 2 && done.committed < 0) done.committed = now - start;
                    else if (done.committed >= 0 && done.presented < 0) {
                        done.presented = now - start;
                        done.frames = frames;
                    }
                }
                if (feedback.presented >= 0 && done.presented >= 0) {
                    finish(null);
                    return;
                }
                requestAnimationFrame(tick);
            };
            // 点击没有落到页面上（坐标错了、行被重新渲染挪开）：不要无限等。
            const missed = setTimeout(() => finish(`5 秒内没有收到点击：${JSON.stringify(spec)}`), 5000);
            window.addEventListener("pointerdown", (event) => {
                clearTimeout(missed);
                start = event.timeStamp;
                requestAnimationFrame(tick);
            }, {capture: true, once: true});
        });
    };
}
