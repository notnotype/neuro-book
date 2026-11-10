/**
 * 自动保存（docs/specs/workbench/editor.md 输出 63）：按设置在用户离开视图、窗口失焦或停手之后发起保存。
 *
 * 只发起保存，不改正文、不裁决、不覆盖：存不了的文档留给用户，界面照文档自己的状态提示。保存仍由文档模型排队
 * （在途的保存、资源管理器的租约之后），这里不管先后。
 */

import {shallowRef, watch} from "@vue/reactivity";
import type {ComputedRef} from "@vue/reactivity";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {DocumentStore, SaveResult, TextDocument} from "./documents/store";

export type AutoSaveMode = "off" | "afterDelay" | "onFocusChange" | "onWindowChange";

export interface AutoSaveSettings {
    readonly mode: AutoSaveMode;
    /** “停手后”的延迟，毫秒。 */
    readonly delay: number;
}

export const AUTO_SAVE_OFF: AutoSaveSettings = {mode: "off", delay: 1000};

export interface AutoSave {
    /** 用户离开了一份文档的视图：视图发 `leave`，或它被换下活动标签。 */
    viewLeft(document: TextDocument | null): void;
    /** 窗口失去焦点或页面被隐藏。 */
    windowBlurred(): void;
    /** 页面要离开了：不管哪种开启的模式，把能存的都发出去，不等结果。 */
    leaving(): void;
    /** 关闭标签前：开着自动保存、这份文档又没有阻碍，可以不问就先保存。不要求 dirty：只剩排队的保存时同样只等。 */
    savesOnClose(document: TextDocument): boolean;
    /** 替自动保存发起一次保存并记下失败（关闭标签时用）；文档必须还开着。 */
    save(document: TextDocument): Promise<SaveResult>;
    dispose(): void;
}

export interface AutoSaveOptions {
    readonly documents: Pick<DocumentStore, "get" | "settle" | "pending" | "save">;
    readonly openDocuments: ComputedRef<ReadonlyArray<TextDocument>>;
    readonly clock: RuntimeClock;
    /** 响应式读取：模式变了立即生效。 */
    readonly settings: () => AutoSaveSettings;
    readonly report: (error: unknown) => void;
}

export function createAutoSave(options: AutoSaveOptions): AutoSave {
    const {documents} = options;
    /**
     * 失败闸：上一次自动保存失败的文档，不再自动保存，免得“停手后”反复重试。不借用文档的 `saveProblem`：手动保存失败
     * 之后自动保存还可以再试一次，而且 `saveProblem` 在文档变干净之后可能还留着。
     */
    const failed = shallowRef<ReadonlySet<TextDocument>>(new Set());
    const gate = (document: TextDocument, closed: boolean): void => {
        if (failed.value.has(document) === closed) return;
        const next = new Set(failed.value);
        if (closed) next.add(document);
        else next.delete(document);
        failed.value = next;
    };

    /** 没有要用户先处理的事：被删除、冲突、磁盘已变化、未裁决、写不出、只读的文档都不自动保存。 */
    const unobstructed = (document: TextDocument): boolean => document.writable.value
        && document.conflict.value === null
        && !document.diskChanged.value
        && document.unresolved.value.length === 0
        && document.blocked.value.size === 0
        && !failed.value.has(document);
    const saveable = (document: TextDocument): boolean => unobstructed(document) && document.dirty.value;

    const save = (document: TextDocument): Promise<SaveResult> => {
        const saving = documents.save(document);
        // 保存失败（文档模型记下了 `saveProblem`）才落闸；冲突、未裁决、写不出有各自的标记，已经算阻碍。
        void saving.then((result) => {
            if (!result.ok && document.saveProblem.value !== null) gate(document, true);
        }, options.report);
        return saving;
    };

    const attempt = (document: TextDocument): void => {
        // 已关闭的文档 `save` 会同步抛错：定时与遍历手里的文档可能刚被资源管理器删掉。
        if (documents.get(document.target.value.path) !== document) return;
        documents.settle(document);
        if (saveable(document)) void save(document);
    };
    const attemptAll = (): void => {
        for (const document of options.openDocuments.value) attempt(document);
    };

    /** 一份打开的文档的监听：失败闸的复位与“停手后”的定时。定时按文档对象记，改名不影响它。 */
    const track = (document: TextDocument): (() => void) => {
        let cancelTimer: (() => void) | null = null;
        const disarm = (): void => {
            cancelTimer?.();
            cancelTimer = null;
        };
        const arm = (): void => {
            disarm();
            cancelTimer = options.clock.schedule(() => {
                cancelTimer = null;
                // 视图手里还有没交出的输入或正在组字：用户没有停手。此刻保存会把半截输入（输入法的拼音）结算进正文并
                // 落盘，顺延一轮；它交出时修订变化，下面的监听还会重排。
                if (documents.pending(document)) arm();
                else attempt(document);
            }, options.settings().delay);
        };
        const stops = [
            // 文档变干净，或一次保存成功（手动、重试、结果未知被核对为已落盘）：恢复自动保存。
            watch(() => !document.dirty.value || document.saveProblem.value === null, (recovered) => {
                if (recovered) gate(document, false);
            }),
            // 修订变了重新计时；阻碍消除（可自动保存从假变真）而修订没变时也要排上，否则它一直 dirty 到下一次输入。
            watch(() => [options.settings().mode === "afterDelay" && saveable(document), document.revision.value] as const, ([armed]) => {
                if (armed) arm();
                else disarm();
            }, {immediate: true}),
        ];
        return () => {
            for (const stop of stops) stop();
            disarm();
            gate(document, false);
        };
    };

    const tracked = new Map<TextDocument, () => void>();
    const stopTracking = watch(() => options.openDocuments.value, (open) => {
        const live = new Set(open);
        for (const [document, untrack] of [...tracked]) {
            if (live.has(document)) continue;
            untrack();
            tracked.delete(document);
        }
        for (const document of open) {
            if (!tracked.has(document)) tracked.set(document, track(document));
        }
    }, {immediate: true});

    // 换成任一开启的模式：已经 dirty、又不在焦点里的文档不用等到下一次触发。
    const stopMode = watch(() => options.settings().mode, (mode) => {
        if (mode !== "off") attemptAll();
    });

    return {
        viewLeft: (document) => {
            if (document !== null && options.settings().mode === "onFocusChange") attempt(document);
        },
        windowBlurred: () => {
            const mode = options.settings().mode;
            if (mode === "onFocusChange" || mode === "onWindowChange") attemptAll();
        },
        leaving: () => {
            if (options.settings().mode !== "off") attemptAll();
        },
        savesOnClose: (document) => options.settings().mode !== "off" && unobstructed(document),
        save,
        dispose: () => {
            stopTracking();
            stopMode();
            for (const untrack of tracked.values()) untrack();
            tracked.clear();
        },
    };
}
