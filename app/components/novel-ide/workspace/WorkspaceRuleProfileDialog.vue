<script setup lang="ts">
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import TagInput from "nbook/app/components/common/form/TagInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {getWorkspaceLorebookStatusIndicatorClass} from "nbook/app/components/novel-ide/workspace/workspace-entry-meta";
import {useNovelIdeStore, type WorkspaceFileIssue, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    basename,
    parseMarkdownDocument,
    readGovernance,
    readNullableString,
    readPlainObject,
    readRefs,
    readRetrieval,
    readString,
    readStringArray,
    renderMarkdownDocument,
    type FrontmatterRef,
    type GovernanceDraft,
    type RetrievalDraft,
} from "nbook/app/components/novel-ide/workspace/workspace-frontmatter-profile";

type RuleDraft = {
    title: string;
    path: string;
    status: string;
    subtype: string | null;
    tags: string[];
    summary: string;
    refs: FrontmatterRef[];
    retrieval: RetrievalDraft;
    governance: GovernanceDraft;
    rule: {
        scope: string | null;
        priority: string | null;
        trigger: string | null;
        effect: string | null;
        limits: string | null;
        exceptions: string[];
        examples: string[];
        conflicts: string[];
    };
    extra: Record<string, unknown>;
    body: string;
};

const props = defineProps<{
    modelValue: boolean;
    node: WorkspaceFileNode | null;
    issues: WorkspaceFileIssue[];
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "refresh"): void;
}>();

const store = useNovelIdeStore();
const {t} = useI18n();
const {selectedFileContent, savingFile} = storeToRefs(store);
const draft = ref<RuleDraft | null>(null);
const diagnostics = ref("");

const statusOptions = computed<SelectOption[]>(() => [
    {value: "draft", label: t("ide.workspace.common.statusDraft"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("draft")},
    {value: "pending", label: t("ide.workspace.common.statusPending"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("pending")},
    {value: "active", label: t("ide.workspace.common.statusActive"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("active")},
    {value: "archived", label: t("ide.workspace.common.statusArchived"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("archived")},
]);
const subtypeOptions = ["system", "physics", "social", "constraint", "interaction", "local", "behavior", "mechanic", "progression"];
const relatedIssues = computed(() => {
    if (!props.node) {
        return [];
    }
    const currentPath = props.node.path.replace(/\/$/, "");
    return props.issues.filter((issue) => issue.path === props.node?.path || issue.path.startsWith(currentPath));
});

/**
 * 加载当前 Markdown 文件为规则档案草稿。
 */
function loadDraft(): void {
    if (!props.node) {
        draft.value = null;
        diagnostics.value = "";
        return;
    }
    const parsed = parseMarkdownDocument(selectedFileContent.value);
    draft.value = createDraft(props.node, parsed.frontmatter, parsed.body);
    diagnostics.value = parsed.error ?? "";
}

/**
 * 保存规则档案 frontmatter，保留正文与未知字段。
 */
async function saveDraft(): Promise<void> {
    if (!draft.value || savingFile.value || diagnostics.value) {
        return;
    }
    selectedFileContent.value = renderDraft(draft.value);
    await store.saveCurrentFile();
}

/**
 * 新增结构化引用。
 */
function addRef(): void {
    if (!draft.value) {
        return;
    }
    draft.value.refs.push({relation: "", target: "", note: null});
}

/**
 * 删除结构化引用。
 */
function removeRef(index: number): void {
    if (!draft.value) {
        return;
    }
    draft.value.refs.splice(index, 1);
    void saveDraft();
}

/**
 * 创建规则档案草稿。
 */
function createDraft(node: WorkspaceFileNode, frontmatter: Record<string, unknown>, body: string): RuleDraft {
    const rule = readPlainObject(frontmatter.rule);
    const extra = {...frontmatter};
    delete extra.title;
    delete extra.type;
    delete extra.subtype;
    delete extra.status;
    delete extra.tags;
    delete extra.summary;
    delete extra.refs;
    delete extra.retrieval;
    delete extra.governance;
    delete extra.rule;
    delete extra.inject;

    return {
        title: readString(frontmatter.title, node.title || basename(node.path)),
        path: node.path,
        status: readString(frontmatter.status, "draft"),
        subtype: readNullableString(frontmatter.subtype),
        tags: readStringArray(frontmatter.tags),
        summary: readString(frontmatter.summary, ""),
        refs: readRefs(frontmatter.refs),
        retrieval: readRetrieval(frontmatter.retrieval),
        governance: readGovernance(frontmatter.governance),
        rule: {
            scope: readNullableString(rule.scope),
            priority: readNullableString(rule.priority),
            trigger: readNullableString(rule.trigger),
            effect: readNullableString(rule.effect),
            limits: readNullableString(rule.limits),
            exceptions: readStringArray(rule.exceptions),
            examples: readStringArray(rule.examples),
            conflicts: readStringArray(rule.conflicts),
        },
        extra,
        body,
    };
}

/**
 * 渲染规则档案草稿。
 */
function renderDraft(current: RuleDraft): string {
    return renderMarkdownDocument({
        ...current.extra,
        title: current.title,
        type: "rule",
        subtype: current.subtype,
        status: current.status,
        tags: current.tags,
        summary: current.summary,
        refs: current.refs,
        retrieval: current.retrieval,
        governance: current.governance,
        rule: current.rule,
    }, current.body);
}

watch(() => [props.modelValue, props.node?.path, selectedFileContent.value], () => {
    if (props.modelValue) {
        loadDraft();
    }
}, {immediate: true});
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        :title="draft?.title || t('ide.workspace.typedProfile.ruleProfile')"
        width="min(1160px, calc(100vw - 160px))"
        height="min(740px, calc(100vh - 96px))"
        overlay-type="opaque"
        :show-footer="false"
        :busy="savingFile"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <!-- 规则档案头部 -->
            <div class="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div class="flex min-w-0 items-center gap-4">
                    <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]">
                        <span class="i-lucide-book-key h-7 w-7"></span>
                    </span>
                    <div class="min-w-0">
                        <h2 class="truncate text-xl font-bold text-[var(--text-main)]">{{ draft?.title || t("ide.workspace.typedProfile.ruleProfile") }}</h2>
                        <div class="mt-1 truncate text-xs text-[var(--text-secondary)]">{{ draft?.path }}</div>
                    </div>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <button class="icon-action" type="button" :title="t('ide.workspace.common.refresh')" @click="emit('refresh')"><span class="i-lucide-refresh-cw h-4 w-4"></span></button>
                    <button class="icon-action" type="button" :title="t('ide.workspace.common.save')" :disabled="savingFile || Boolean(diagnostics)" @click="void saveDraft()"><span class="i-lucide-save h-4 w-4"></span></button>
                    <span class="mx-2 h-7 w-px bg-[var(--border-color)]"></span>
                    <button class="icon-action" type="button" :title="t('ide.workspace.common.close')" @click="emit('update:modelValue', false)"><span class="i-lucide-x h-5 w-5"></span></button>
                </div>
            </div>
        </template>

        <div v-if="draft" class="space-y-3 text-xs" :class="savingFile ? 'pointer-events-none opacity-80' : ''">
            <div v-if="diagnostics" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[var(--status-danger)]">{{ diagnostics }}</div>
            <div v-for="issue in relatedIssues" :key="`${issue.code}:${issue.path}:${issue.message}`" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[var(--status-warning)]">[{{ issue.level }}] {{ issue.message }}</div>

            <!-- 规则核心信息 -->
            <section class="rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3">
                <div class="grid grid-cols-[minmax(0,1fr)_132px_150px] gap-2">
                    <label class="space-y-1"><span>{{ t("ide.workspace.typedProfile.ruleName") }}</span><input v-model="draft.title" class="field" @blur="void saveDraft()"></label>
                    <label class="space-y-1"><span>{{ t("ide.workspace.common.status") }}</span><FormSelect :model-value="draft.status" :options="statusOptions" @update:model-value="draft.status = $event; void saveDraft()" /></label>
                    <label class="space-y-1"><span>{{ t("ide.workspace.typedProfile.category") }}</span><input :value="draft.subtype ?? ''" class="field" list="rule-subtypes" @input="draft.subtype = ($event.target as HTMLInputElement).value || null" @blur="void saveDraft()"></label>
                </div>
                <datalist id="rule-subtypes"><option v-for="item in subtypeOptions" :key="item" :value="item"></option></datalist>
                <label class="mt-2 block space-y-1"><span>{{ t("ide.workspace.common.summary") }}</span><textarea v-model="draft.summary" rows="3" class="textarea" @blur="void saveDraft()"></textarea></label>
                <label class="mt-2 block space-y-1"><span>{{ t("ide.workspace.common.tags") }}</span><TagInput :model-value="draft.tags" :placeholder="t('ide.workspace.common.addTag')" accentStyle @update:model-value="draft.tags = $event; void saveDraft()" /></label>
            </section>

            <!-- 规则系统面板 -->
            <section class="grid grid-cols-[1fr_1fr] gap-3">
                <div class="space-y-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                    <div class="font-semibold text-[var(--text-main)]">{{ t("ide.workspace.typedProfile.triggerEffect") }}</div>
                    <input :value="draft.rule.scope ?? ''" class="field" :placeholder="t('ide.workspace.typedProfile.scope')" @input="draft.rule.scope = ($event.target as HTMLInputElement).value || null" @blur="void saveDraft()">
                    <input :value="draft.rule.priority ?? ''" class="field" :placeholder="t('ide.workspace.typedProfile.priority')" @input="draft.rule.priority = ($event.target as HTMLInputElement).value || null" @blur="void saveDraft()">
                    <textarea :value="draft.rule.trigger ?? ''" rows="3" class="textarea" :placeholder="t('ide.workspace.typedProfile.trigger')" @input="draft.rule.trigger = ($event.target as HTMLTextAreaElement).value || null" @blur="void saveDraft()"></textarea>
                    <textarea :value="draft.rule.effect ?? ''" rows="4" class="textarea" :placeholder="t('ide.workspace.typedProfile.effect')" @input="draft.rule.effect = ($event.target as HTMLTextAreaElement).value || null" @blur="void saveDraft()"></textarea>
                </div>
                <div class="space-y-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                    <div class="font-semibold text-[var(--text-main)]">{{ t("ide.workspace.typedProfile.boundaries") }}</div>
                    <textarea :value="draft.rule.limits ?? ''" rows="3" class="textarea" :placeholder="t('ide.workspace.typedProfile.limits')" @input="draft.rule.limits = ($event.target as HTMLTextAreaElement).value || null" @blur="void saveDraft()"></textarea>
                    <TagInput :model-value="draft.rule.exceptions" :placeholder="t('ide.workspace.typedProfile.exceptions')" @update:model-value="draft.rule.exceptions = $event; void saveDraft()" />
                    <TagInput :model-value="draft.rule.conflicts" :placeholder="t('ide.workspace.typedProfile.conflicts')" @update:model-value="draft.rule.conflicts = $event; void saveDraft()" />
                    <TagInput :model-value="draft.rule.examples" :placeholder="t('ide.workspace.typedProfile.examples')" @update:model-value="draft.rule.examples = $event; void saveDraft()" />
                </div>
            </section>

            <!-- AI 与引用 -->
            <section class="space-y-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <div class="font-semibold text-[var(--text-main)]">{{ t("ide.workspace.typedProfile.aiReferences") }}</div>
                <div class="flex flex-wrap items-center gap-4">
                    <label class="flex items-center gap-2 text-[var(--text-secondary)]">
                        <input v-model="draft.retrieval.enabled" type="checkbox" class="h-4 w-4 rounded border-[var(--border-color)]" @change="void saveDraft()">
                        <span>{{ t("ide.workspace.common.allowRetrieval") }}</span>
                    </label>
                </div>
                <textarea :value="draft.retrieval.trigger ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.common.retrievalTrigger')" @input="draft.retrieval.trigger = ($event.target as HTMLTextAreaElement).value || null" @blur="void saveDraft()"></textarea>
                <div class="grid grid-cols-2 gap-2">
                    <input v-model="draft.governance.source" class="field" placeholder="source" @blur="void saveDraft()">
                    <input v-model="draft.governance.review" class="field" placeholder="review" @blur="void saveDraft()">
                </div>
                <div v-for="(entryRef, index) in draft.refs" :key="index" class="flex items-center gap-1">
                    <input v-model="entryRef.relation" class="field w-[88px]" :placeholder="t('ide.workspace.common.relation')" @blur="void saveDraft()">
                    <input v-model="entryRef.target" class="field min-w-0 flex-1 font-mono" :placeholder="t('ide.workspace.common.targetPath')" @blur="void saveDraft()">
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" @click="removeRef(index)"><span class="i-lucide-x h-3.5 w-3.5"></span></button>
                </div>
                <button type="button" class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)]" @click="addRef"><span class="i-lucide-plus h-3 w-3"></span>{{ t("ide.workspace.common.addReference") }}</button>
            </section>
        </div>
    </Dialog>
</template>

<style scoped>
.field {
    height: 1.75rem;
    width: 100%;
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
    background: var(--bg-panel);
    padding: 0 0.5rem;
    color: var(--text-main);
    outline: none;
}

.textarea {
    width: 100%;
    resize: vertical;
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
    background: var(--bg-panel);
    padding: 0.375rem 0.5rem;
    line-height: 1.25rem;
    color: var(--text-main);
    outline: none;
}

.field:focus,
.textarea:focus {
    border-color: var(--accent-main);
}

.icon-action {
    display: inline-flex;
    height: 2rem;
    width: 2rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    color: var(--text-muted);
}

.icon-action:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-main);
}
</style>
