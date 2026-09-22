<script lang="ts">
import {defineComponent, h, onBeforeUnmount, onErrorCaptured, shallowReactive, watch} from "vue";
import type {PropType} from "vue";
import {matchesEditorDocument} from "./editor-view.types";
import type {
    EditorAction,
    EditorChangeRequest,
    EditorChangeResult,
    EditorConflictResolution,
    EditorContribution,
    EditorDocumentSnapshot,
    EditorDocumentTarget,
    EditorFlushResult,
    EditorViewEvents,
    EditorViewHandle,
} from "./editor-view.types";
import type {EditorRegistry} from "nbook/app/utils/editor-workbench/registry";

type ViewInstance = {
    id: string;
    token: string;
    contribution: EditorContribution;
    document: EditorDocumentSnapshot;
    handle: EditorViewHandle | null;
    actions: readonly EditorAction[];
    failed: boolean;
    events: EditorViewEvents;
    bind: (handle: EditorViewHandle | null) => void;
};

/** 每个实例一个新建的 UUID：旧实例的迟到回调靠 token 与挂载身份失效，宿主内递增序号做不到。 */
const createInstanceToken = (): string => globalThis.crypto.randomUUID();

export default defineComponent({
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot | null>, default: null},
        registry: {type: Object as PropType<EditorRegistry>, required: true},
        editorId: {type: String as PropType<string | null>, default: null},
        commitChange: {type: Function as PropType<(request: EditorChangeRequest) => EditorChangeResult>, required: true},
        conflictResolution: {type: Object as PropType<EditorConflictResolution | null>, default: null},
    },
    emits: {
        "handle-ready": (_target: EditorDocumentTarget, _token: string, _handle: EditorViewHandle | null) => true,
        "save-request": (_target: EditorDocumentTarget, _token: string) => true,
        "focus-change": (_target: EditorDocumentTarget, _token: string, _focused: boolean) => true,
        "view-actions": (_target: EditorDocumentTarget, _token: string, _actions: readonly EditorAction[]) => true,
        "view-error": (_target: EditorDocumentTarget, _token: string, _message: string) => true,
        "conflict-resolved": (_token: string, _result: EditorFlushResult) => true,
    },
    setup(props, {emit, expose}) {
        const state = shallowReactive({instances: [] as ViewInstance[], active: null as ViewInstance | null});
        let disposed = false;
        const live = (entry: ViewInstance) => !disposed && !entry.failed && state.instances.includes(entry)
            && matchesEditorDocument(entry.document.target, props.document?.target ?? null);
        const releaseActive = () => {
            if (state.active && live(state.active)) state.active.handle?.flushPendingChange();
            if (state.active) emit("handle-ready", state.active.document.target, state.active.token, null);
            state.active = null;
        };
        const publish = (entry: ViewInstance) => {
            if (!live(entry) || props.editorId !== entry.id || !entry.handle) return;
            if (state.active !== entry) releaseActive();
            state.active = entry;
            emit("handle-ready", entry.document.target, entry.token, entry.handle);
            emit("view-actions", entry.document.target, entry.token, entry.actions);
        };
        function create(contribution: EditorContribution, document: EditorDocumentSnapshot): ViewInstance {
            const entry: ViewInstance = shallowReactive({
                id: contribution.id, token: createInstanceToken(), contribution, document,
                handle: null, actions: [], failed: false,
                events: {
                    change: (target, baseRevision, content) => {
                        // 身份失效的迟到回调回 stale；存活实例（含被隐藏那个）仍要能结算自己的输入。
                        if (!live(entry) || !matchesEditorDocument(target, entry.document.target)) return {status: "stale"};
                        const result = props.commitChange({target, token: entry.token, baseRevision, content});
                        // 只有 accepted 才推进确认快照；conflict 的候选留在实例里等裁决。
                        if (result.status === "accepted") entry.document = result.snapshot;
                        return result;
                    },
                    save: (target) => {if (live(entry)) emit("save-request", target, entry.token);},
                    focus: (target, focused) => {if (live(entry)) emit("focus-change", target, entry.token, focused);},
                    actions: (target, actions) => {
                        if (!live(entry)) return;
                        entry.actions = actions;
                        if (state.active === entry) emit("view-actions", target, entry.token, actions);
                    },
                },
                bind: (handle) => {
                    if (!live(entry)) return;
                    entry.handle = handle;
                    if (handle) publish(entry);
                    else if (state.active === entry) releaseActive();
                },
            });
            return entry;
        }
        watch(() => [props.document, props.editorId] as const, ([document, id]) => {
            if (!document || (state.instances[0] && !matchesEditorDocument(state.instances[0].document.target, document.target))) {
                releaseActive();
                state.instances = [];
            }
            if (!document) return;
            // 兄弟回灌与外部更新先落到存活实例的确认快照：解析未就绪、编辑视图缺失都不能让实例停在旧正文上。
            for (const entry of state.instances) {
                if (matchesEditorDocument(entry.document.target, document.target)) entry.document = document;
            }
            if (!id) return;
            const contribution = props.registry.get(id);
            if (!contribution) return;
            let entry = state.instances.find((item) => item.id === id && !item.failed);
            if (!entry) {
                entry = create(contribution, document);
                state.instances = [...state.instances.filter((item) => item.id !== id), entry];
            }
            // 旧可见实例仅在目标就绪后隐藏；未访问视图不创建，隐藏视图不接收全文更新。
            publish(entry);
        }, {immediate: true});
        onErrorCaptured((error) => {
            const entry = state.instances.find((item) => item.id === props.editorId);
            if (entry) {
                entry.failed = true;
                if (state.active === entry) releaseActive();
                emit("view-error", entry.document.target, entry.token, error instanceof Error ? error.message : String(error));
            }
            return false;
        });
        watch(() => props.conflictResolution, (request) => {
            if (!request) return;
            const entry = state.instances.find((item) => item.token === request.token);
            // 采用当前正文与兄弟回灌是不同的形状，只能由这条显式请求驱动，不能等文档变更自己发生。
            if (!entry || !live(entry) || !entry.handle?.resolveConflict) return;
            emit("conflict-resolved", entry.token, entry.handle.resolveConflict(request.choice));
        });
        onBeforeUnmount(() => {
            releaseActive();
            disposed = true;
            state.instances = [];
        });
        /**
         * 结算本宿主登记的全部实例。防抖计时器被清掉不等于输入已进入权威缓冲：
         * 任一实例仍有未接受的候选，聚合结果就是 conflict，调用方不得继续隐藏/重挂。
         */
        expose({
            flushPendingChange: (): EditorFlushResult => {
                let result: EditorFlushResult = "settled";
                for (const entry of state.instances) {
                    if (entry.failed || !entry.handle) continue;
                    if (entry.handle.flushPendingChange() === "conflict") result = "conflict";
                }
                return result;
            },
        });
        const RenderView = defineComponent({
            props: {entry: {type: Object as PropType<ViewInstance>, required: true}, visible: Boolean},
            setup(view) {
                return () => view.entry.contribution.render(
                    {document: view.entry.document, visible: view.visible, viewInstanceId: view.entry.token},
                    view.entry.events,
                    view.entry.bind,
                );
            },
        });
        return () => h("div", {class: "relative h-full min-h-0 min-w-0 overflow-hidden"}, state.instances.filter((entry) => !entry.failed).map((entry) => h("div", {
            key: entry.token,
            class: "h-full min-h-0 min-w-0",
            style: {display: state.active === entry ? undefined : "none"},
            "aria-hidden": state.active !== entry,
        }, [h(RenderView, {entry, visible: state.active === entry})])));
    },
});
</script>
