/**
 * 一个窗口里的编辑器（docs/specs/workbench/editor.md）：入口激活时建立，活到入口停止。绑定项目的窗口先读会话记录，
 * 首读结束（读到或失败）后才建编辑器区，空的组不会先显示再被当成修改保存；未绑定项目的窗口直接建。编辑器区建好之前
 * 命令为 `unavailable`，文档协调按“没有打开的文档”回答。
 */

import {shallowRef, watch} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {FilesService} from "nbook/plugins/files/shared/contracts";

import type {DocumentCoordinator} from "../shared/contracts";
import {createEditorArea} from "./area";
import type {EditorArea} from "./area";
import {snapshotOf} from "./session-record";
import type {EditorSessionStore} from "./session-record";

export interface EditorSessionOptions {
    readonly files: FilesService;
    readonly clock: RuntimeClock;
    /** 窗口绑定的项目；未绑定为 null。 */
    readonly project: {readonly id: string; readonly generation: number} | null;
    /** 绑定项目时打开会话记录；未绑定为 null。 */
    readonly createStore: (() => EditorSessionStore) | null;
    readonly report: (error: unknown) => void;
}

export interface EditorSession {
    readonly area: Readonly<ShallowRef<EditorArea | null>>;
    /** 文档协调：编辑器区建好之前没有打开的文档。 */
    readonly coordinator: DocumentCoordinator;
    dispose(): void;
}

export function createEditorSession(options: EditorSessionOptions): EditorSession {
    const area = shallowRef<EditorArea | null>(null);
    let stopWaiting: (() => void) | null = null;
    let disposed = false;
    const workspaceKey = options.project?.id ?? "none";
    const generation = options.project?.generation ?? 1;

    const start = (initial: ReturnType<typeof snapshotOf>, persist?: (snapshot: Parameters<EditorSessionStore["actions"]["save"]>[0]) => void): void => {
        area.value = createEditorArea({
            files: options.files,
            clock: options.clock,
            workspaceKey,
            generation,
            initial,
            ...(persist === undefined ? {} : {persist}),
            report: options.report,
        });
    };

    if (options.createStore === null) {
        start(null);
    } else {
        // store 随入口的激活作用域释放（`defineStore` 的 create 挂在激活上下文上）。
        const current = options.createStore();
        const session = current.state.session;
        stopWaiting = watch(() => session.ready || session.failure !== null, (settled) => {
            if (!settled || area.value !== null || disposed) return;
            stopWaiting?.();
            stopWaiting = null;
            const base = session.base;
            start(base !== null && base.status === "ok" ? snapshotOf(base.value) : null, (snapshot) => current.actions.save(snapshot));
        }, {immediate: true});
    }

    const coordinator: DocumentCoordinator = {
        affected: (addresses) => area.value?.documents.coordinator.affected(addresses) ?? [],
        begin: async (addresses) => area.value?.documents.coordinator.begin(addresses) ?? {ok: true, lease: {end: () => undefined}},
        save: async (addresses) => area.value?.documents.coordinator.save(addresses) ?? [],
        translate: (address, token) => area.value?.documents.coordinator.translate(address, token) ?? token,
        close: (addresses) => area.value?.documents.coordinator.close(addresses),
    };

    return {
        area,
        coordinator,
        dispose: () => {
            if (disposed) return;
            disposed = true;
            stopWaiting?.();
            area.value?.dispose();
            area.value = null;
        },
    };
}
