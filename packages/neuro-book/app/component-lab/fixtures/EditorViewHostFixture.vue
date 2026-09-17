<script setup lang="ts">
/**
 * EditorViewHost 的 Lab 场景：受控视图宿主的生命周期合同。
 *
 * 这里检视的不是编辑器内核，而是宿主：谁可见、什么时候结算输入、句柄什么时候交出来、
 * 子视图抛错时收敛成什么。因此视图用**明确标注的替身**（textarea），不引入真实 Monaco/TipTap；
 * 真实内核的两个视图分别在 CodeEditorView / MarkdownEditorView 的场景里看。
 *
 * 替身故意把输入结算延迟 1.5 秒，好让人在切换视图的窗口内输入，观察宿主是否在隐藏旧视图前结算。
 */
import {computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType} from "vue";
import EditorViewHost from "nbook/app/components/editor-workbench/EditorViewHost.vue";
import type {
    EditorAction,
    EditorContribution,
    EditorDocumentSnapshot,
    EditorDocumentTarget,
    EditorViewEvents,
    EditorViewHandle,
} from "nbook/app/components/editor-workbench/editor-view.types";
import {createEditorRegistry, type EditorRegistry} from "nbook/app/utils/editor-workbench/registry";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

/**
 * 受检视的替身视图。它遵守真实合同：onMounted 交出句柄、onBeforeUnmount 撤回、
 * 自己产生的输入经 events.change 上报，外部正文更新覆盖本地草稿。
 */
const LabStubView = defineComponent({
    name: "LabEditorStubView",
    props: {
        document: {type: Object as PropType<EditorDocumentSnapshot>, required: true},
        visible: {type: Boolean, default: true},
        events: {type: Object as PropType<EditorViewEvents>, required: true},
        bindHandle: {type: Function as PropType<(handle: EditorViewHandle | null) => void>, required: true},
        label: {type: String, required: true},
        badge: {type: String, required: true},
        settleDelayMs: {type: Number, required: true},
        readyDelayMs: {type: Number, required: true},
        crash: {type: Boolean, default: false},
    },
    setup(viewProps) {
        if (viewProps.crash) {
            throw new Error(`${viewProps.label} 渲染即失败：这是替身登记的失败分支，不是产品缺陷。`);
        }
        const textareaRef = ref<HTMLTextAreaElement | null>(null);
        const draft = ref(viewProps.document.content);
        let settled = viewProps.document.content;
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        let readyTimer: ReturnType<typeof setTimeout> | null = null;

        function settle(): void {
            if (settleTimer !== null) {
                clearTimeout(settleTimer);
                settleTimer = null;
            }
            if (draft.value === settled) {
                return;
            }
            settled = draft.value;
            viewProps.events.change(viewProps.document.target, draft.value);
        }
        function schedule(): void {
            if (settleTimer !== null) {
                clearTimeout(settleTimer);
            }
            settleTimer = setTimeout(settle, viewProps.settleDelayMs);
        }
        const handle: EditorViewHandle = {
            flushPendingChange: settle,
            focus: () => textareaRef.value?.focus(),
            undo: () => document.execCommand?.("undo"),
            redo: () => document.execCommand?.("redo"),
        };
        onMounted(() => {
            if (viewProps.readyDelayMs > 0) {
                readyTimer = setTimeout(() => viewProps.bindHandle(handle), viewProps.readyDelayMs);
                return;
            }
            viewProps.bindHandle(handle);
        });
        onBeforeUnmount(() => {
            if (settleTimer !== null) {
                clearTimeout(settleTimer);
            }
            if (readyTimer !== null) {
                clearTimeout(readyTimer);
            }
            viewProps.bindHandle(null);
        });
        watch(() => viewProps.document.content, (content) => {
            // 自己刚结算出去的那份不当作外部更新，否则会把光标推回文末
            if (content === settled) {
                return;
            }
            settled = content;
            draft.value = content;
        });
        return () => h("div", {class: "flex h-full min-h-0 flex-col bg-[var(--panel-surface)]"}, [
            h("div", {class: "flex shrink-0 items-center gap-2 border-b border-[var(--divider)] bg-[var(--bg-panel)] px-3 py-1 text-[11px] text-[var(--text-muted)]"}, [
                h("span", {class: "font-medium text-[var(--text-main)]"}, viewProps.label),
                h("span", {class: "rounded bg-[var(--bg-hover)] px-1.5 py-0.5"}, viewProps.badge),
                h("span", viewProps.visible ? "可见" : "隐藏"),
                h("span", `${viewProps.settleDelayMs}ms 后结算输入`),
            ]),
            h("textarea", {
                "aria-label": `${viewProps.label} 正文草稿`,
                ref: textareaRef,
                value: draft.value,
                spellcheck: false,
                class: "h-full min-h-0 w-full flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-5 text-[var(--text-main)] outline-none",
                onInput: (event: Event) => {
                    draft.value = (event.target as HTMLTextAreaElement).value;
                    schedule();
                },
                onFocus: () => viewProps.events.focus(viewProps.document.target, true),
                onBlur: () => viewProps.events.focus(viewProps.document.target, false),
                onKeydown: (event: KeyboardEvent) => {
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                        event.preventDefault();
                        viewProps.events.save(viewProps.document.target);
                    }
                },
            }),
        ]);
    },
});

type StubOptions = {
    id: string;
    label: string;
    badge: string;
    settleDelayMs: number;
    readyDelayMs: number;
    crash?: boolean;
};

const codeStub: StubOptions = {id: "code", label: "源码替身", badge: "textarea", settleDelayMs: 1500, readyDelayMs: 0};
const richStub: StubOptions = {id: "markdown", label: "富文本替身", badge: "textarea", settleDelayMs: 1500, readyDelayMs: 0};
const slowStub: StubOptions = {id: "slow", label: "慢就绪替身", badge: "句柄延迟 1.2 秒", settleDelayMs: 1500, readyDelayMs: 1200};
const crashStub: StubOptions = {id: "crash", label: "失败替身", badge: "渲染即抛错", settleDelayMs: 0, readyDelayMs: 0, crash: true};

function contribution(options: StubOptions): EditorContribution {
    return {
        id: options.id,
        titleKey: `lab.editorStub.${options.id}`,
        iconClass: "i-lucide-square-dashed",
        supports: () => true,
        render: (viewProps, events, bindHandle) => h(LabStubView, {
            document: viewProps.document,
            visible: viewProps.visible,
            events,
            bindHandle,
            label: options.label,
            badge: options.badge,
            settleDelayMs: options.settleDelayMs,
            readyDelayMs: options.readyDelayMs,
            crash: options.crash === true,
        }),
    };
}

/** 场景登记：注册表里必须有 `code`，这是产品注册表的既有约束；失败档默认进入 crash。 */
const sceneDefinitions: Record<string, {stubs: StubOptions[]; editorId: string}> = {
    switch: {stubs: [codeStub, richStub], editorId: "code"},
    pending: {stubs: [codeStub, slowStub], editorId: "code"},
    "view-error": {stubs: [codeStub, crashStub], editorId: "crash"},
    single: {stubs: [codeStub], editorId: "code"},
};

const path = ref("manuscript/chapter-01.md");
const content = ref("");
const baseline = ref("");
const editorId = ref("code");
const registry = ref<EditorRegistry>(buildRegistry([codeStub]));
const lastEvent = ref("");
const failure = ref("");
const activeEditorId = ref("");
const mountKey = ref(0);

const target = computed<EditorDocumentTarget>(() => ({
    workspaceKey: "lab:editor-view-host",
    generation: 1,
    documentId: `lab-doc:${path.value}`,
    path: path.value,
}));
const documentSnapshot = computed<EditorDocumentSnapshot>(() => ({
    target: target.value,
    content: content.value,
    languageId: "markdown",
    readonly: false,
}));
const dirty = computed(() => content.value !== baseline.value);

function buildRegistry(stubs: StubOptions[]): EditorRegistry {
    const result = createEditorRegistry(stubs.map(contribution));
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.value;
}

function normalize(value: unknown): {editorId: string; path: string; content: string} | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const candidate = value as {editorId?: unknown; path?: unknown; content?: unknown};
    if (typeof candidate.editorId !== "string" || typeof candidate.path !== "string" || typeof candidate.content !== "string") {
        return null;
    }
    return {editorId: candidate.editorId, path: candidate.path, content: candidate.content};
}

watch(() => [props.scene, props.data] as const, () => {
    const definition = sceneDefinitions[props.scene] ?? sceneDefinitions.switch!;
    const next = normalize(props.data);
    mountKey.value += 1;
    registry.value = buildRegistry(definition.stubs);
    path.value = next?.path ?? "manuscript/chapter-01.md";
    content.value = next?.content ?? "# 退潮\n\n礁石上留下了一层薄薄的盐。\n";
    baseline.value = content.value;
    editorId.value = next?.editorId ?? definition.editorId;
    lastEvent.value = "";
    failure.value = "";
    activeEditorId.value = "";
}, {immediate: true});

function switchEditor(nextEditorId: string): void {
    failure.value = "";
    editorId.value = nextEditorId;
    log("switch-editor", nextEditorId);
}

function log(name: string, payload: string): void {
    lastEvent.value = payload ? `${name}：${payload}` : name;
    emitLabEvent(name, payload);
}

function onHandleReady(_target: EditorDocumentTarget, token: string, handle: EditorViewHandle | null): void {
    activeEditorId.value = handle ? editorId.value : "";
    log("handle-ready", handle ? `第 ${token} 个实例交出句柄` : `第 ${token} 个实例撤回首柄`);
}

function onChange(nextTarget: EditorDocumentTarget, next: string): void {
    content.value = next;
    log("change", `${nextTarget.path} → ${next.length} 字符`);
}

function onSaveRequest(nextTarget: EditorDocumentTarget): void {
    log("save-request", nextTarget.path);
}

function onFocusChange(nextTarget: EditorDocumentTarget, focused: boolean): void {
    log("focus-change", `${focused ? "进入" : "离开"} ${nextTarget.path}`);
}

function onViewActions(nextTarget: EditorDocumentTarget, token: string, actions: readonly EditorAction[]): void {
    log("view-actions", `${token} → ${actions.map((action) => action.id).join("，") || "无"}`);
    void nextTarget;
}

function onViewError(nextTarget: EditorDocumentTarget, message: string): void {
    failure.value = message;
    log("view-error", message);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--panel-surface)]">
        <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--divider)] bg-[var(--bg-panel)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
            <span class="font-mono text-[var(--text-main)]">{{ path }}</span>
            <span>活动视图：{{ activeEditorId || "无" }}</span>
            <span>{{ content.length }} 字符</span>
            <span :class="dirty ? 'text-[var(--status-warning)]' : ''">{{ dirty ? "与初值不同" : "与初值一致" }}</span>
            <span v-if="lastEvent" class="font-mono text-[var(--text-main)]">{{ lastEvent }}</span>
            <div class="flex-1"></div>
            <button
                v-for="definition in (sceneDefinitions[props.scene] ?? sceneDefinitions.switch!).stubs"
                :key="definition.id"
                type="button"
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                :class="definition.id === editorId ? 'border-[var(--accent-main)] text-[var(--accent-text)]' : ''"
                @click="switchEditor(definition.id)"
            >
                {{ definition.label }}
            </button>
        </div>

        <div v-if="failure" class="shrink-0 border-b border-[var(--divider)] bg-[var(--status-error-bg)] px-3 py-1.5 text-[11px] text-[var(--status-error)]">
            {{ `宿主收敛到的失败：${failure}` }}
        </div>

        <div class="min-h-0 flex-1">
            <EditorViewHost
                data-lab-subject
                :key="mountKey"
                :document="documentSnapshot"
                :registry="registry"
                :editor-id="editorId"
                @handle-ready="onHandleReady"
                @change="onChange"
                @save-request="onSaveRequest"
                @focus-change="onFocusChange"
                @view-actions="onViewActions"
                @view-error="onViewError"
            />
        </div>
    </div>
</template>
