<script setup lang="ts">
/**
 * MarkdownEditorView 的 Lab 场景：真实 TipTap 富文本 + 批注面板 + frontmatter 拆分。
 *
 * 演示重点：
 * 1. 正文、批注与 frontmatter 都来自同一份 Markdown 方言，夹具不解析也不改写它们；
 * 2. 视图动作由组件自己上报（`actions` 事件），夹具只呈现收到的动作并调用 runAction，
 *    不为组件补一套自己的按钮清单；
 * 3. 引用解析是宿主职责：夹具给一份内存里的工作区条目表，命中就给出预览元数据，
 *    未登记的 target 如实回报 broken，不假装解析成功；
 * 4. quick trigger 菜单的数据源属于产品，夹具不伪造，因此显式关闭。
 */
import {computed, ref, watch} from "vue";
import MarkdownEditorView from "nbook/app/components/editor-workbench/MarkdownEditorView.vue";
import type {EditorAction, EditorChangeResult, EditorDocumentSnapshot, EditorDocumentTarget, EditorViewHandle} from "nbook/app/components/editor-workbench/editor-view.types";
import type {WorkspaceReferencePreviewMeta, WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES} from "nbook/shared/editor-workbench";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof MarkdownEditorView>(() => props.input, ["save", "focus", "ready", "actions", "open-frontmatter-profile", "inline-ai-reference"]);
const emitLabEvent = useLabEventSink();


/**
 * 夹具扮演宿主的引用解析：只认下面这张内存表。
 * 真实产品用工作区文件树解析，这里既不读磁盘也不猜路径。
 */
const referenceEntries = [
    {target: "chapter.md", resolvedPath: "manuscript/chapter-01.md", title: "开场", entryType: "markdown", contentNode: true, isDirectory: false, status: "草稿"},
    {target: "lorebook/潮汐.md", resolvedPath: "lorebook/潮汐.md", title: "潮汐", entryType: "markdown", contentNode: true, isDirectory: false, status: "定稿"},
];

const resolveReference: WorkspaceReferenceResolver = (target: string): WorkspaceReferencePreviewMeta => {
    const entry = referenceEntries.find((item) => item.target === target);
    if (!entry) {
        return {target, resolvedPath: null, entryType: null, icon: null, title: target, status: null, broken: true, contentNode: false, isDirectory: false};
    }
    return {
        target,
        resolvedPath: entry.resolvedPath,
        entryType: entry.entryType,
        icon: "i-lucide-file-text",
        title: entry.title,
        status: entry.status,
        broken: false,
        contentNode: entry.contentNode,
        isDirectory: entry.isDirectory,
    };
};

const path = ref("");
const content = ref("");
const readonly = ref(false);
const showFrontmatterPanel = ref(false);
/** 夹具扮演的权威缓冲修订：基线不符的提交如实回 conflict，实例必须保留候选。 */
const revision = ref(0);
const baseline = ref("");
const identity = ref("");
const mountKey = ref(0);
/** 交给视图的实例 token：同文档换实例时不复用内核实例。 */
const viewInstanceId = computed(() => `lab-markdown-view:${mountKey.value}`);
const viewHandle = ref<EditorViewHandle | null>(null);
/** 组件自己上报的动作，不是夹具手写的第二份清单。 */
const viewActions = ref<readonly EditorAction[]>([]);

const inputDocument = computed(() => subject.bindings.value.document);
const target = computed<EditorDocumentTarget>(() => inputDocument.value.target);
const documentSnapshot = computed<EditorDocumentSnapshot>(() => ({
    ...inputDocument.value,
    content: content.value,
    contentRevision: revision.value,
}));
const dirty = computed(() => content.value !== baseline.value);

/** 编辑器唯一可编辑初值是组件自身的 document 与 showFrontmatterPanel。 */
function resolveScene(): EditorDocumentSnapshot {
    return inputDocument.value;
}

watch(() => [props.scene, props.input?.props?.document, props.input?.props?.showFrontmatterPanel] as const, () => {
    const next = resolveScene();
    const frontmatter = subject.bindings.value.showFrontmatterPanel;
    const nextIdentity = `${next.target.workspaceKey}|${next.target.documentId}|${next.target.path}|${next.readonly}|${frontmatter}`;
    path.value = next.target.path;
    readonly.value = next.readonly;
    showFrontmatterPanel.value = frontmatter;
    if (nextIdentity !== identity.value) {
        identity.value = nextIdentity;
        content.value = next.content;
        revision.value = next.contentRevision;
        baseline.value = next.content;
        viewActions.value = [];
        mountKey.value += 1;
        return;
    }
    if (content.value !== next.content) {
        content.value = next.content;
        revision.value = next.contentRevision;
    }
}, {immediate: true});

/** 夹具扮演的权威缓冲：基线过期回 conflict，目标已换代回 stale，都不是 accepted。 */
function onCommitChange(nextTarget: EditorDocumentTarget, baseRevision: number, next: string): EditorChangeResult {
    if (baseRevision !== revision.value) {
        emitLabEvent("change-rejected", {path: nextTarget.path, baseRevision, revision: revision.value});
        return {status: "conflict", snapshot: documentSnapshot.value};
    }
    content.value = next;
    revision.value += 1;
    subject.write("props", "document", documentSnapshot.value);
    emitLabEvent("change", {path: nextTarget.path, chars: next.length});
    return {status: "accepted", snapshot: documentSnapshot.value};
}

function onReady(handle: EditorViewHandle | null): void {
    viewHandle.value = handle;
    emitLabEvent("ready", handle ? "内核就绪" : "内核卸载");
}

function onActions(nextTarget: EditorDocumentTarget, actions: readonly EditorAction[]): void {
    viewActions.value = actions;
    emitLabEvent("view-actions", actions.map((action) => `${action.id}:${action.checked ? "on" : "off"}`));
    void nextTarget;
}

function runAction(action: EditorAction): void {
    if (action.disabled) {
        return;
    }
    viewHandle.value?.runAction?.(action.id);
    emitLabEvent("run-action", action.id);
}

/** 外部正文更新走权威缓冲：修订推进，实例按最新快照回灌内核。 */
function externalContent(next: string): void {
    content.value = next;
    revision.value += 1;
    subject.write("props", "document", documentSnapshot.value);
}

function externalUpdate(): void {
    externalContent(`${content.value}\n\n（外部更新：这段文字不经过视图输入，走内核 update。）`);
    emitLabEvent("external-update", content.value.length);
}

function resetToBaseline(): void {
    externalContent(baseline.value);
    emitLabEvent("reset", baseline.value.length);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--panel-surface)]">
        <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--divider)] bg-[var(--bg-panel)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
            <span class="font-mono text-[var(--text-main)]">{{ path }}</span>
            <span v-if="readonly" class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">只读</span>
            <span v-if="showFrontmatterPanel" class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5">frontmatter 面板开启</span>
            <span>{{ viewHandle ? "内核就绪" : "等待内核" }}</span>
            <span>{{ content.length }} 字符</span>
            <span :class="dirty ? 'text-[var(--status-warning)]' : ''">{{ dirty ? "与初值不同" : "与初值一致" }}</span>
            <div class="flex-1"></div>
            <!-- 动作来自组件上报，夹具只负责调用；checked 用可读后缀表达，不写无效 ARIA -->
            <button
                v-for="action in viewActions"
                :key="action.id"
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                :class="action.disabled ? 'opacity-50' : ''"
                :disabled="action.disabled"
                @click="runAction(action)"
            >
                <span :class="action.iconClass ?? 'i-lucide-dot'" class="h-3.5 w-3.5" aria-hidden="true"></span>
                <span>{{ action.checked ? `${action.label}（已选）` : action.label }}</span>
            </button>
            <button
                type="button"
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                @click="externalUpdate"
            >
                外部更新正文
            </button>
            <button
                type="button"
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                @click="resetToBaseline"
            >
                回到初值
            </button>
            <button
                type="button"
                class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                @click="viewHandle?.focus()"
            >
                聚焦
            </button>
        </div>

        <div class="min-h-0 flex-1">
            <MarkdownEditorView
                data-lab-subject
                v-bind="subject.bindings.value"
                :key="mountKey"
                :document="documentSnapshot"
                :visible="true"
                :view-instance-id="viewInstanceId"
                :commit-change="onCommitChange"
                :editor-preferences="DEFAULT_MARKDOWN_EDITOR_PREFERENCES"
                :show-frontmatter-panel="showFrontmatterPanel"
                :resolve-reference="resolveReference"
                :open-reference="(reference: string) => emitLabEvent('open-reference', reference)"
                :enable-quick-triggers="false"
                @save="(nextTarget: EditorDocumentTarget) => emitLabEvent('save', nextTarget.path)"
                @focus="(nextTarget: EditorDocumentTarget, focused: boolean) => emitLabEvent('focus', {path: nextTarget.path, focused})"
                @ready="onReady"
                @actions="onActions"
                @open-frontmatter-profile="(kind: string) => emitLabEvent('open-frontmatter-profile', kind)"
                @inline-ai-reference="(reference: unknown) => emitLabEvent('inline-ai-reference', reference)"
            />
        </div>
    </div>
</template>
