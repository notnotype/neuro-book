import type {BrowserContext, Page} from "playwright-core";
import type {BrowserObservation, EditorMode, Environment, GroupCount, Sample} from "./files-baseline-observations";
import {loadavg} from "node:os";

export type ReadyTarget =
    | {kind: "tree"}
    | {kind: "directory"; path: string; children: number}
    | {kind: "editor"; path: string; marker: string; mode: EditorMode; groups: GroupCount; groupId: string};

type BrowserState = {
    longTasks: PerformanceEntry[];
    longAnimationFrames: PerformanceEntry[];
    support: string[];
    operation?: {start: number; end: number; selection: number | null; tab: number | null; readiness: Record<string, unknown>; error: string | null; done: boolean};
};

/** init script 每次导航重新安装；观察器在真实文档的第一个产品脚本之前生效。 */
export async function installObservers(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
        const target = window as Window & {__nbookT42?: BrowserState};
        const state: BrowserState = {longTasks: [], longAnimationFrames: [], support: [...PerformanceObserver.supportedEntryTypes]};
        target.__nbookT42 = state;
        performance.setResourceTimingBufferSize(20_000);
        for (const type of ["longtask", "long-animation-frame"]) {
            if (!state.support.includes(type)) continue;
            const entries = type === "longtask" ? state.longTasks : state.longAnimationFrames;
            new PerformanceObserver((list) => entries.push(...list.getEntries())).observe({type, buffered: true});
        }
    });
}

/** 起止均在页面内记录，排除 Playwright 选择器等待、自动滚动与 RPC 往返。 */
export async function measureClick(page: Page, selector: string, target: ReadyTarget, metadata: {
    id: string; environment: Environment; scenario: Sample["scenario"]; variant: string; iteration: number;
}): Promise<Sample> {
    const element = page.locator(selector).first();
    await element.waitFor({state: "visible", timeout: 30_000});
    await element.scrollIntoViewIfNeeded();
    await page.evaluate(({selector: clickSelector, readyTarget}) => {
        const state = (window as Window & {__nbookT42?: BrowserState}).__nbookT42;
        if (!state) throw new Error("当前文档缺少性能观察器");
        const operation = {start: 0, end: 0, selection: null as number | null, tab: null as number | null, readiness: {} as Record<string, unknown>, error: null as string | null, done: false};
        state.operation = operation;
        let candidateFrame = false;
        const visible = (element: Element): boolean => element instanceof HTMLElement && element.checkVisibility();
        const check = (): void => {
            if (operation.done) return;
            const now = performance.now();
            if (now - operation.start > 60_000) {
                operation.end = now;
                operation.error = `正文或目录在 60000ms 内未满足就绪条件：${JSON.stringify(readyTarget)}`;
                operation.done = true;
                return;
            }
            let ready = false;
            if (readyTarget.kind === "tree") {
                const explorer = document.querySelector('[data-role="files-explorer-view"]');
                const rows = [...document.querySelectorAll<HTMLElement>('[data-role="workspace-file-row"]')];
                const roots = ["lorebook/", "manuscript/", "notes/"];
                ready = Boolean(explorer && visible(explorer) && roots.every((path) => {
                    const row = rows.find((item) => item.dataset.path === path);
                    if (!row || !visible(row)) return false;
                    const rect = row.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return Boolean(hit && row.contains(hit));
                }));
                operation.readiness = {rootRows: rows.length, requiredRoots: roots, treeOperable: ready};
            } else if (readyTarget.kind === "directory") {
                const rows = [...document.querySelectorAll<HTMLElement>('[data-role="workspace-file-row"]')];
                const directory = rows.find((row) => row.dataset.path === readyTarget.path);
                const children = rows.filter((row) => {
                    const path = row.dataset.path ?? "";
                    return path.startsWith(readyTarget.path) && path !== readyTarget.path && !path.slice(readyTarget.path.length).replace(/\/$/u, "").includes("/");
                });
                const container = directory?.parentElement?.querySelector(':scope > .overflow-hidden');
                const animating = Boolean(container?.classList.contains("expand-enter-active") || container?.classList.contains("expand-enter-from") || (container instanceof HTMLElement && container.style.height !== "auto"));
                ready = directory?.getAttribute("aria-expanded") === "true" && children.length === readyTarget.children && children.every(visible) && !animating;
                operation.readiness = {renderedChildren: children.length, expectedChildren: readyTarget.children, animationComplete: !animating, directoryOperable: ready};
            } else {
                const groups = [...document.querySelectorAll<HTMLElement>('section[data-group-id]')];
                const group = groups.find((item) => item.dataset.groupId === readyTarget.groupId && item.classList.contains("is-active-group"));
                const tab = group?.querySelector(`[id="editor-tab-${encodeURIComponent(readyTarget.path)}"]`);
                const selected = document.querySelector(`[data-role="workspace-file-row"][data-path="${CSS.escape(readyTarget.path)}"]`)?.getAttribute("aria-selected") === "true";
                if (selected && operation.selection === null) operation.selection = now;
                if (tab?.getAttribute("aria-selected") === "true" && operation.tab === null) operation.tab = now;
                const panel = group?.querySelector('[role="tabpanel"]');
                const editors = [...(panel?.querySelectorAll<HTMLElement>(readyTarget.mode === "rich" ? '[contenteditable="true"]' : '.monaco-editor') ?? [])].filter(visible);
                const editor = editors.find((item) => (item.textContent ?? "").includes(readyTarget.marker));
                const input = readyTarget.mode === "rich" ? editor : editor?.querySelector<HTMLElement>('.native-edit-context, textarea.inputarea');
                const writable = input instanceof HTMLElement && visible(input) && (readyTarget.mode === "rich" ? input.isContentEditable
                    : input.getAttribute("aria-readonly") !== "true" && (input instanceof HTMLTextAreaElement ? !input.disabled && !input.readOnly : "editContext" in input && input.editContext !== null));
                ready = groups.length === readyTarget.groups && operation.tab !== null && Boolean(editor) && writable && panel?.getAttribute("aria-busy") !== "true";
                operation.readiness = {
                    path: readyTarget.path, marker: readyTarget.marker, mode: readyTarget.mode, groupId: readyTarget.groupId,
                    expectedGroups: readyTarget.groups, actualGroups: groups.length, markerVisible: Boolean(editor), writable,
                    inputClass: input?.className ?? null,
                    selectionMs: operation.selection === null ? null : operation.selection - operation.start,
                    tabMs: operation.tab === null ? null : operation.tab - operation.start,
                    visibleEditorText: editor?.textContent?.slice(0, 300) ?? null,
                };
            }
            if (ready && candidateFrame) {
                operation.end = now;
                operation.done = true;
                return;
            }
            candidateFrame = ready;
            requestAnimationFrame(check);
        };
        const begin = (event: MouseEvent): void => {
            if (!(event.target instanceof Element) || !event.target.closest(clickSelector)) return;
            document.removeEventListener("click", begin, true);
            operation.start = performance.now();
            requestAnimationFrame(check);
        };
        document.addEventListener("click", begin, true);
    }, {selector, readyTarget: target});
    let driverError: string | null = null;
    try {
        await element.click();
        await page.waitForFunction(() => (window as Window & {__nbookT42?: BrowserState}).__nbookT42?.operation?.done === true, undefined, {timeout: 65_000});
    } catch (error) {
        driverError = error instanceof Error ? error.stack ?? error.message : String(error);
    }
    const observation = await page.evaluate(async (): Promise<BrowserObservation & {error: string | null}> => {
        await new Promise<void>((done) => setTimeout(done, 0));
        const state = (window as Window & {__nbookT42?: BrowserState}).__nbookT42;
        if (!state?.operation) throw new Error("测量操作状态丢失");
        const operation = state.operation;
        const end = operation.end || performance.now();
        const intersects = (entry: PerformanceEntry): boolean => entry.startTime <= end && entry.startTime + entry.duration >= operation.start;
        const timing = (entry: PerformanceEntry) => ({name: entry.name, entryType: entry.entryType, startTime: entry.startTime, duration: entry.duration});
        return {
            operationStartTime: operation.start,
            operationEndTime: end,
            durationMs: end - operation.start,
            readiness: {...operation.readiness, timeOrigin: performance.timeOrigin, capturedClick: operation.start > 0, completed: operation.done},
            requests: performance.getEntriesByType("resource").filter(intersects).map((entry) => {
                const resource = entry as PerformanceResourceTiming;
                return {...timing(resource), initiatorType: resource.initiatorType, requestStart: resource.requestStart, responseStart: resource.responseStart, responseEnd: resource.responseEnd,
                    transferSize: resource.transferSize, encodedBodySize: resource.encodedBodySize, decodedBodySize: resource.decodedBodySize, nextHopProtocol: resource.nextHopProtocol,
                    serverTiming: resource.serverTiming.map((item) => ({name: item.name, duration: item.duration, description: item.description}))};
            }),
            userTiming: [...performance.getEntriesByType("mark"), ...performance.getEntriesByType("measure")].filter((entry) => /^(files|editor)\./u.test(entry.name) && intersects(entry)).map(timing),
            longTasks: state.longTasks.filter(intersects).map(timing),
            longAnimationFrames: state.longAnimationFrames.filter(intersects).map(timing),
            observerSupport: state.support,
            error: operation.error,
        };
    });
    const {error: readinessError, ...result} = observation;
    const error = driverError ?? readinessError;
    return {...metadata, ...result, status: error ? "fail" : "pass", error, loadAverage: loadavg()};
}

/** 在计时窗口外验证真实键盘输入与撤销，不能只凭一个可编辑属性宣布成功。 */
export async function verifyInput(page: Page, target: Extract<ReadyTarget, {kind: "editor"}>): Promise<void> {
    const group = page.locator(`section[data-group-id="${target.groupId}"]`);
    const tab = group.locator(`[data-editor-tab-path="${target.path}"]`);
    const wasDirty = await tab.evaluate((item) => item.classList.contains("is-dirty"));
    const editor = group.locator(target.mode === "rich" ? '[contenteditable="true"]:visible' : '.monaco-editor:visible').first();
    if (target.mode === "rich") await editor.click();
    else await editor.locator('.native-edit-context, textarea.inputarea:visible').first().focus();
    await page.keyboard.press("Control+Home");
    const token = "NBOOKINPUTPROOF";
    await page.keyboard.type(token);
    await page.waitForFunction(({id, marker}) => {
        const group = document.querySelector(`section[data-group-id="${id}"]`);
        return [...(group?.querySelectorAll<HTMLElement>('[contenteditable="true"], .monaco-editor') ?? [])].some((item) => item.checkVisibility() && (item.textContent ?? "").includes(marker));
    }, {id: target.groupId, marker: token}, {timeout: 10_000});
    await page.keyboard.press("Control+z");
    await page.waitForFunction(({id, marker}) => {
        const group = document.querySelector(`section[data-group-id="${id}"]`);
        return [...(group?.querySelectorAll<HTMLElement>('[contenteditable="true"], .monaco-editor') ?? [])].filter((item) => item.checkVisibility()).every((item) => !(item.textContent ?? "").includes(marker));
    }, {id: target.groupId, marker: token}, {timeout: 10_000});
    await page.keyboard.press("Control+Home");
    await new Promise<void>((done) => setTimeout(done, 350));
    const dirty = await tab.evaluate((item) => item.classList.contains("is-dirty"));
    if (dirty !== wasDirty) throw new Error(`输入并撤销改变了 dirty 状态：${target.path}`);
}
