import {computed, inject, onBeforeUnmount, provide, readonly, shallowRef, watch, watchEffect, type InjectionKey, type Ref} from "vue";
import {DragDropManager, Droppable, KeyboardSensor} from "@dnd-kit/dom";
import type {CollisionDetector} from "@dnd-kit/abstract";
import type {DragDropProviderProps} from "@dnd-kit/vue";
import type {GridDropMember, GridDropPoint} from "@notnotype/nb-ui/layout";
import {workbenchDragBlocksTarget, workbenchDragSensor} from "nbook/app/composables/useWorkbenchDrag";
import {readWorkbenchDropRect, workbenchPointerCollision} from "nbook/app/utils/workbench/workbench-drop-dom";
import type {EditorTabPresentation} from "./editor-view.types";
import {editorDragStructure, resolveEditorTabDrop, sameEditorDrop, type EditorDragGroup, type EditorTabDrop, type EditorTabDropAction, type EditorTabDropTarget, type EditorTabSource} from "./editor-tab-drop";

export const EDITOR_TAB_DRAG_TYPE = "editor-tab";
type EditorTarget = {groupId: string; element: () => HTMLElement | null} & (
    | {kind: "tabs"; pinned: boolean; wrap?: boolean; tabs: () => readonly EditorTabPresentation[]}
    | {kind: "content"}
);
export type EditorDragContext = {
    active: Readonly<Ref<boolean>>;
    source: Readonly<Ref<EditorTabSource | null>>;
    registerTarget(id: string, target: EditorTarget): () => void;
};
const EDITOR_DRAG_CONTEXT: InjectionKey<EditorDragContext> = Symbol("editor-tab-drag");

/** 普通空格/Enter继续选择标签；Ctrl+Space起拖，方向键移动，Space释放，Escape取消。 */
export function editorDragSensors(): NonNullable<DragDropProviderProps["sensors"]> {
    return [workbenchDragSensor, KeyboardSensor.configure({
        keyboardCodes: {start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter", "Tab"], up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"]},
        preventActivation: event => !event.ctrlKey || workbenchDragBlocksTarget(event.target),
    })];
}

/** 无Provider的独立只读展示不登记拖动，避免落进外层Workbench的manager。 */
export function useEditorTabDrag(): EditorDragContext | null {
    return inject(EDITOR_DRAG_CONTEXT, null);
}

/** 一份Editor工作区只持有一场手势；不持有文档/布局权威状态，也不写store。 */
export function provideEditorTabDrag(options: {
    groups: () => readonly EditorDragGroup[];
    allowSplit: () => boolean;
    contextKey: () => string;
    revision: () => number;
    commit: (action: EditorTabDropAction) => void;
}) {
    const manager = new DragDropManager();
    const source = shallowRef<EditorTabSource | null>(null);
    const decision = shallowRef<EditorTabDrop | null>(null);
    const targets = new Map<string, {target: EditorTarget; droppable: Droppable}>();
    const structure = computed(() => editorDragStructure(options.groups(), options.contextKey(), options.revision(), options.allowSplit()));
    let baseline = "";
    let point: GridDropPoint | null = null;
    let pointerId: number | null = null;
    let frame = 0;
    let cleanup: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    function reset(): void {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        cleanup?.();
        cleanup = null;
        resizeObserver?.disconnect();
        resizeObserver = null;
        point = null;
        pointerId = null;
        source.value = null;
        decision.value = null;
    }
    function cancel(): void {
        if (!source.value) return;
        reset();
        manager.actions.stop({canceled: true});
    }
    function detectorAt(at: GridDropPoint): CollisionDetector {
        return input => workbenchPointerCollision({
            ...input,
            dragOperation: new Proxy(input.dragOperation, {
                get: (target, key) => key === "position" ? {...target.position, current: at} : Reflect.get(target, key),
            }),
        });
    }
    function measure(target: EditorTarget): EditorTabDropTarget | null {
        const element = target.element();
        const rect = readWorkbenchDropRect(element);
        if (!element || !rect) return null;
        if (target.kind === "content") return {kind: "content", groupId: target.groupId, rect};
        const nodes = Array.from(element.querySelectorAll<HTMLElement>('[data-role="editor-tab-item"]'))
            .filter(node => !node.closest('[data-dnd-dragging], [data-dnd-placeholder]'));
        const members: GridDropMember[] = [];
        for (const tab of target.tabs()) {
            const node = nodes.find(item => item.dataset.editorTabPath === tab.path);
            const box = readWorkbenchDropRect(node);
            if (box) members.push({id: tab.path, rect: box});
        }
        // 有成员却一个都不可见不能伪装成空区。
        if (target.tabs().length && !members.length) return null;
        return {kind: "tabs", groupId: target.groupId, pinned: target.pinned, wrap: target.wrap, rect, members};
    }
    function evaluate(): EditorTabDrop | null {
        const current = source.value;
        if (!current || structure.value !== baseline) return null;
        const at = point ?? manager.dragOperation.position.current;
        const collisions = manager.collisionObserver.computeCollisions(undefined, detectorAt(at));
        const hit = collisions?.[0];
        const entry = hit ? targets.get(String(hit.id)) : undefined;
        if (!entry) return null;
        const target = measure(entry.target);
        return target ? resolveEditorTabDrop({source: current, groups: options.groups(), target, point: at, allowSplit: options.allowSplit()}) : null;
    }
    function refresh(): void {
        if (!source.value) return;
        if (structure.value !== baseline) { cancel(); return; }
        decision.value = evaluate();
    }
    function schedule(): void {
        if (!source.value || frame) return;
        frame = requestAnimationFrame(() => { frame = 0; refresh(); });
    }
    function installListeners(): void {
        const track = (event: PointerEvent): void => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            point = {x: event.clientX, y: event.clientY};
            if (event.type !== "pointerup") schedule();
        };
        const keydown = (event: KeyboardEvent): void => { if (event.key === "Escape") cancel(); };
        const visibility = (): void => { if (document.visibilityState === "hidden") cancel(); };
        const pointerCancel = (event: PointerEvent): void => { if (event.pointerId === pointerId) cancel(); };
        window.addEventListener("pointermove", track, true);
        window.addEventListener("pointerup", track, true);
        window.addEventListener("pointercancel", pointerCancel, true);
        window.addEventListener("keydown", keydown, true);
        window.addEventListener("blur", cancel);
        document.addEventListener("visibilitychange", visibility);
        window.addEventListener("scroll", schedule, {capture: true, passive: true});
        window.addEventListener("resize", schedule);
        resizeObserver = new ResizeObserver(schedule);
        for (const {target} of targets.values()) {
            const element = target.element();
            if (!element) continue;
            resizeObserver.observe(element);
            for (const member of element.querySelectorAll('[data-role="editor-tab-item"]')) resizeObserver.observe(member);
        }
        cleanup = () => {
            window.removeEventListener("pointermove", track, true);
            window.removeEventListener("pointerup", track, true);
            window.removeEventListener("pointercancel", pointerCancel, true);
            window.removeEventListener("keydown", keydown, true);
            window.removeEventListener("blur", cancel);
            document.removeEventListener("visibilitychange", visibility);
            window.removeEventListener("scroll", schedule, true);
            window.removeEventListener("resize", schedule);
        };
    }
    const listeners = [
        manager.monitor.addEventListener("beforedragstart", event => {
            const data = event.operation.source?.data;
            const group = options.groups().find(group => group.id === data?.groupId);
            if (data?.kind !== EDITOR_TAB_DRAG_TYPE || typeof data.path !== "string" || !group?.tabs.some(tab => tab.path === data.path)) event.preventDefault();
        }),
        manager.monitor.addEventListener("dragstart", event => {
            const data = event.operation.source?.data;
            if (data?.kind !== EDITOR_TAB_DRAG_TYPE) return;
            reset();
            baseline = structure.value;
            source.value = {groupId: data.groupId, path: data.path};
            if (event.nativeEvent instanceof PointerEvent) {
                pointerId = event.nativeEvent.pointerId;
                point = {x: event.nativeEvent.clientX, y: event.nativeEvent.clientY};
            }
            installListeners();
            schedule();
        }),
        manager.monitor.addEventListener("dragmove", schedule),
        manager.monitor.addEventListener("dragover", schedule),
        manager.monitor.addEventListener("dragend", event => {
            const last = decision.value;
            const next = event.canceled ? null : evaluate();
            // 只接纳与最后一次预览同一意图的动作；原位与中央的可见空动作不产生提交。
            const intent = sameEditorDrop(last, next) ? next!.action : null;
            reset(); // 宿主提交可以同步销毁源组，旧会话不能再观察这些变化。
            if (intent) options.commit(intent);
        }),
    ];
    const context: EditorDragContext = {
        active: computed(() => source.value !== null),
        source: readonly(source),
        registerTarget(id, target) {
            const droppable = new Droppable({id, type: "editor-tab-target", accept: [EDITOR_TAB_DRAG_TYPE], collisionDetector: workbenchPointerCollision, register: false}, manager);
            const entry = {target, droppable};
            const previous = targets.get(id);
            previous?.droppable.destroy();
            targets.set(id, entry);
            droppable.register();
            const stop = watchEffect(() => {
                droppable.element = target.element() ?? undefined;
                if (droppable.element) resizeObserver?.observe(droppable.element);
                schedule();
            });
            return () => {
                stop();
                if (targets.get(id) !== entry) return;
                targets.delete(id);
                droppable.destroy();
                schedule();
            };
        },
    };
    provide(EDITOR_DRAG_CONTEXT, context);
    const stopWatch = watch(structure, cancel, {flush: "sync"});
    onBeforeUnmount(() => {
        cancel();
        reset();
        stopWatch();
        for (const remove of listeners) remove();
        for (const {droppable} of targets.values()) droppable.destroy();
        targets.clear();
        manager.destroy();
    });
    return {manager, decision, ...context};
}
