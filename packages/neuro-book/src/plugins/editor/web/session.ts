/**
 * 一个窗口里的编辑器（docs/specs/workbench/editor.md）：入口激活时建立，活到入口停止。编辑组的结构在工作台的布局文档里，所以要等它读完；绑定项目的窗口还要读完 `editor.tabs`
 * （读到或失败），之后才建编辑器区，空的组不会先显示再被当成修改保存。外壳没挂的窗口（Lab）布局文档不打开，编辑器区也就不建。编辑器区建好之前命令为 `unavailable`，文档协调按“没有打开的文档”回答。
 */

import {shallowRef, watch} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {FilesService} from "nbook/plugins/files/shared/contracts";
import type {EditorPanelsService} from "nbook/plugins/workbench/shared/contracts";

import type {DocumentCoordinator} from "../shared/contracts";
import {createEditorArea} from "./area";
import type {EditorArea} from "./area";
import type {EditorCatalog} from "./editors";
import type {TabsSnapshot} from "./groups/groups";
import type {EditorRecentStore} from "./recent-record";
import type {EditorTabsStore} from "./tabs-record";

export interface EditorSessionOptions {
    readonly files: FilesService;
    readonly clock: RuntimeClock;
    /** 工作台的布局文档：编辑组的结构在它那里（docs/specs/ui/workbench-layout.md 输出 33）。 */
    readonly panels: EditorPanelsService;
    /** 窗口绑定的项目；未绑定为 null。 */
    readonly project: {readonly id: string; readonly generation: number} | null;
    /** 绑定项目时打开标签记录；未绑定为 null，标签只在内存。 */
    readonly createStore: (() => EditorTabsStore) | null;
    /** 绑定项目时打开最近打开的记录（输出 31）；未绑定为 null。 */
    readonly createRecentStore: (() => EditorRecentStore) | null;
    readonly report: (error: unknown) => void;
    /** 已接受的编辑器声明；缺省只有内置的两个。 */
    readonly editors?: EditorCatalog;
    readonly conflict?: (address: string, editors: ReadonlyArray<string>) => void;
    /** 设置“预览标签页”（docs/specs/workbench/editor.md 输出 52）；缺省为开。 */
    readonly enablePreview?: () => boolean;
}

export interface EditorSession {
    readonly area: Readonly<ShallowRef<EditorArea | null>>;
    /** 最近打开的地址，最近在前；未绑定项目的窗口为 null。 */
    readonly recent: EditorRecentStore | null;
    /**
     * 这部作品第一次在本窗口打开：标签记录读到了“不存在”。编辑器区建好时定下，之后不变；读取失败、未绑定项目都为假。
     * 声明 `openOnFirstVisit` 的页面据此自动打开（输出 33）。
     */
    readonly firstVisit: Readonly<ShallowRef<boolean>>;
    /** 文档协调：编辑器区建好之前没有打开的文档。 */
    readonly coordinator: DocumentCoordinator;
    dispose(): void;
}

export function createEditorSession(options: EditorSessionOptions): EditorSession {
    const area = shallowRef<EditorArea | null>(null);
    const firstVisit = shallowRef(false);
    let stopWaiting: (() => void) | null = null;
    let stopSaveWatch: (() => void) | null = null;
    let disposed = false;
    const workspaceKey = options.project?.id ?? "none";
    const generation = options.project?.generation ?? 1;

    // 与标签记录一样随入口的激活作用域释放。记录读完之前的打开先排队，读到之后作用在读到的值上。
    const recent = options.createRecentStore?.() ?? null;

    const start = (initial: TabsSnapshot | null, persist?: (snapshot: TabsSnapshot) => void): void => {
        area.value = createEditorArea({
            files: options.files,
            clock: options.clock,
            workspaceKey,
            generation,
            panels: options.panels,
            initial,
            ...(persist === undefined ? {} : {persist}),
            ...(recent === null ? {} : {opened: (address: string) => recent.actions.opened(address)}),
            report: options.report,
            ...(options.editors === undefined ? {} : {editors: options.editors}),
            ...(options.conflict === undefined ? {} : {conflict: options.conflict}),
            ...(options.enablePreview === undefined ? {} : {enablePreview: options.enablePreview}),
        });
    };

    // store 随入口的激活作用域释放（`defineStore` 的 create 挂在激活上下文上）。
    const store = options.createStore?.() ?? null;
    const settled = (): boolean => options.panels.ready.value && (store === null || store.state.record.ready || store.state.record.failure !== null);
    stopWaiting = watch(settled, (done) => {
        if (!done || area.value !== null || disposed) return;
        stopWaiting?.();
        stopWaiting = null;
        if (store === null) {
            start(null);
            return;
        }
        const base = store.state.record.base;
        firstVisit.value = base?.status === "missing";
        start(base?.status === "ok" ? base.value : null, (snapshot) => store.actions.save(snapshot));
        options.panels.acceptSaveGate({
            pass: () => (area.value === null ? Promise.resolve(true) : store.actions.saveBeforeLayout(area.value.groups.snapshot())),
            recover: () => (area.value === null ? Promise.resolve(true) : store.actions.recover(area.value.groups.snapshot())),
        });
        // 只改了属性（光标、固定）时布局不存，关卡不走：失败要亮出来，让布局走一次关卡，状态栏才显示“布局未保存”和重试。只看“进入失败”这一下：
        // 重试时状态会 saving → failed 再来一遍，按状态值看的话每次都再走关卡。
        stopSaveWatch = watch(() => {
            const {state} = store.state.record.save;
            return state === "failed" || state === "unknown";
        }, (failed) => {
            if (failed) options.panels.flush();
        });
    }, {immediate: true});

    const coordinator: DocumentCoordinator = {
        affected: (addresses) => area.value?.documents.coordinator.affected(addresses) ?? [],
        begin: async (addresses) => area.value?.documents.coordinator.begin(addresses) ?? {ok: true, lease: {end: () => undefined}},
        save: async (addresses) => area.value?.documents.coordinator.save(addresses) ?? [],
        translate: (address, token) => area.value?.documents.coordinator.translate(address, token) ?? token,
        close: (addresses) => area.value?.documents.coordinator.close(addresses),
    };

    return {
        area,
        recent,
        firstVisit,
        coordinator,
        dispose: () => {
            if (disposed) return;
            disposed = true;
            stopWaiting?.();
            stopSaveWatch?.();
            options.panels.acceptSaveGate(null);
            area.value?.dispose();
            area.value = null;
        },
    };
}
