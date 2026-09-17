<script lang="ts">
import {defineComponent, h, onBeforeUnmount, onErrorCaptured, shallowReactive, watch} from "vue";
import type {PropType} from "vue";
import {matchesEditorDocument} from "./editor-view.types";
import type {EditorAction, EditorContribution, EditorDocumentSnapshot, EditorDocumentTarget, EditorViewEvents, EditorViewHandle} from "./editor-view.types";
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

export default defineComponent({
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot | null>, default: null},
        registry: {type: Object as PropType<EditorRegistry>, required: true},
        editorId: {type: String as PropType<string | null>, default: null},
    },
    emits: {
        "handle-ready": (_target: EditorDocumentTarget, _token: string, _handle: EditorViewHandle | null) => true,
        change: (_target: EditorDocumentTarget, _content: string) => true,
        "save-request": (_target: EditorDocumentTarget) => true,
        "focus-change": (_target: EditorDocumentTarget, _focused: boolean) => true,
        "view-actions": (_target: EditorDocumentTarget, _token: string, _actions: readonly EditorAction[]) => true,
        "view-error": (_target: EditorDocumentTarget, _message: string) => true,
    },
    setup(props, {emit}) {
        const state = shallowReactive({instances: [] as ViewInstance[], active: null as ViewInstance | null});
        let sequence = 0;
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
                id: contribution.id, token: String(++sequence), contribution, document,
                handle: null, actions: [], failed: false,
                events: {
                    change: (target, content) => {
                        if (!live(entry) || state.active !== entry) return;
                        entry.document = {...entry.document, content};
                        const preparing = state.instances.find((item) => item.id === props.editorId && item !== entry);
                        if (preparing) preparing.document = {...preparing.document, content};
                        emit("change", target, content);
                    },
                    save: (target) => {if (live(entry) && state.active === entry) emit("save-request", target);},
                    focus: (target, focused) => {if (live(entry) && state.active === entry) emit("focus-change", target, focused);},
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
            if (!document || !id) return;
            const contribution = props.registry.get(id);
            if (!contribution) return;
            let entry = state.instances.find((item) => item.id === id && !item.failed);
            if (!entry) {
                entry = create(contribution, document);
                state.instances = [...state.instances.filter((item) => item.id !== id), entry];
            } else entry.document = document;
            // 旧可见实例仅在目标就绪后隐藏；未访问视图不创建，隐藏视图不接收全文更新。
            publish(entry);
        }, {immediate: true});
        onErrorCaptured((error) => {
            const entry = state.instances.find((item) => item.id === props.editorId);
            if (entry) {
                entry.failed = true;
                if (state.active === entry) releaseActive();
                emit("view-error", entry.document.target, error instanceof Error ? error.message : String(error));
            }
            return false;
        });
        onBeforeUnmount(() => {
            releaseActive();
            disposed = true;
            state.instances = [];
        });
        const RenderView = defineComponent({
            props: {entry: {type: Object as PropType<ViewInstance>, required: true}, visible: Boolean},
            setup(view) {
                return () => view.entry.contribution.render({document: view.entry.document, visible: view.visible}, view.entry.events, view.entry.bind);
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
