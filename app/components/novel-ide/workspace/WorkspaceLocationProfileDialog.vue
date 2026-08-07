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

type LocationDraft = {
    title: string;
    path: string;
    status: string;
    subtype: string | null;
    aliases: string[];
    tags: string[];
    summary: string;
    refs: FrontmatterRef[];
    retrieval: RetrievalDraft;
    governance: GovernanceDraft;
    location: {
        parent: string | null;
        region: string | null;
        terrain: string | null;
        climate: string | null;
        atmosphere: string | null;
        access: string | null;
        landmarks: string[];
        risks: string[];
        resources: string[];
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
const draft = ref<LocationDraft | null>(null);
const diagnostics = ref("");

const statusOptions = computed<SelectOption[]>(() => [
    {value: "draft", label: t("ide.workspace.common.statusDraft"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("draft")},
    {value: "pending", label: t("ide.workspace.common.statusPending"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("pending")},
    {value: "active", label: t("ide.workspace.common.statusActive"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("active")},
    {value: "archived", label: t("ide.workspace.common.statusArchived"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("archived")},
]);
const subtypeOptions = ["world", "continent", "nation", "region", "city", "district", "building", "room", "landmark", "facility", "ruin", "dungeon", "settlement", "transport"];
const relatedIssues = computed(() => {
    if (!props.node) {
        return [];
    }
    const currentPath = props.node.path.replace(/\/$/, "");
    return props.issues.filter((issue) => issue.path === props.node?.path || issue.path.startsWith(currentPath));
});

/**
 * 加载当前 Markdown 文件为地点档案草稿。
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
 * 保存地点档案 frontmatter，保留正文与未知字段。
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
 * 创建地点档案草稿。
 */
function createDraft(node: WorkspaceFileNode, frontmatter: Record<string, unknown>, body: string): LocationDraft {
    const location = readPlainObject(frontmatter.location);
    const extra = {...frontmatter};
    delete extra.title;
    delete extra.type;
    delete extra.subtype;
    delete extra.status;
    delete extra.aliases;
    delete extra.tags;
    delete extra.summary;
    delete extra.refs;
    delete extra.retrieval;
    delete extra.governance;
    delete extra.location;
    delete extra.inject;

    return {
        title: readString(frontmatter.title, node.title || basename(node.path)),
        path: node.path,
        status: readString(frontmatter.status, "draft"),
        subtype: readNullableString(frontmatter.subtype),
        aliases: readStringArray(frontmatter.aliases),
        tags: readStringArray(frontmatter.tags),
        summary: readString(frontmatter.summary, ""),
        refs: readRefs(frontmatter.refs),
        retrieval: readRetrieval(frontmatter.retrieval),
        governance: readGovernance(frontmatter.governance),
        location: {
            parent: readNullableString(location.parent),
            region: readNullableString(location.region),
            terrain: readNullableString(location.terrain),
            climate: readNullableString(location.climate),
            atmosphere: readNullableString(location.atmosphere),
            access: readNullableString(location.access),
            landmarks: readStringArray(location.landmarks),
            risks: readStringArray(location.risks),
            resources: readStringArray(location.resources),
        },
        extra,
        body,
    };
}

/**
 * 渲染地点档案草稿。
 */
function renderDraft(current: LocationDraft): string {
    return renderMarkdownDocument({
        ...current.extra,
        title: current.title,
        type: "location",
        subtype: current.subtype,
        status: current.status,
        aliases: current.aliases,
        tags: current.tags,
        summary: current.summary,
        refs: current.refs,
        retrieval: current.retrieval,
        governance: current.governance,
        location: current.location,
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
        :title="draft?.title || t('ide.workspace.typedProfile.locationProfile')"
        width="min(1160px, calc(100vw - 160px))"
        height="min(740px, calc(100vh - 96px))"
        overlay-type="opaque"
        :show-footer="false"
        :busy="savingFile"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <!-- 地点档案头部 -->
            <div class="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div class="flex min-w-0 items-center gap-4">
                    <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]">
                        <span class="i-lucide-map-pinned h-7 w-7"></span>
                    </span>
                    <div class="min-w-0">
                        <h2 class="truncate text-xl font-bold text-[var(--text-main)]">{{ draft?.title || t("ide.workspace.typedProfile.locationProfile") }}</h2>
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

            <!-- 地点核心信息 -->
            <section class="rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-3">
                <div class="grid grid-cols-[minmax(0,1fr)_132px_150px] gap-2">
                    <label class="space-y-1"><span>{{ t("ide.workspace.typedProfile.locationName") }}</span><input v-model="draft.title" class="field" @blur="void saveDraft()"></label>
                    <label class="space-y-1"><span>{{ t("ide.workspace.common.status") }}</span><FormSelect :model-value="draft.status" :options="statusOptions" @update:model-value="draft.status = $event; void saveDraft()" /></label>
                    <label class="space-y-1"><span>{{ t("ide.workspace.typedProfile.type") }}</span><input :value="draft.subtype ?? ''" class="field" list="location-subtypes" @input="draft.subtype = ($event.target as HTMLInputElement).value || null" @blur="void saveDraft()"></label>
                </div>
                <datalist id="location-subtypes"><option v-for="item in subtypeOptions" :key="item" :value="item"></option></datalist>
                <label class="mt-2 block space-y-1"><span>{{ t("ide.workspace.common.summary") }}</span><textarea v-model="draft.summary" rows="3" class="textarea" @blur="void saveDraft()"></textarea></label>
                <div class="mt-2 grid grid-cols-2 gap-2">
                    <label class="space-y-1"><span>{{ t("ide.workspace.common.aliases") }}</span><TagInput :model-value="draft.aliases" :placeholder="t('ide.workspace.common.addAlias')" @update:model-value="draft.aliases = $event; void saveDraft()" /></label>
                    <label class="space-y-1"><span>{{ t("ide.workspace.common.tags") }}</span><TagInput :model-value="draft.tags" :placeholder="t('ide.workspace.common.addTag')" accentStyle @update:model-value="draft.tags = $event; void saveDraft()" /></label>
                </div>
            </section>

            <!-- 地点空间设定 -->
            <section class="grid grid-cols-2 gap-3">
                <div class="space-y-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                    <div class="font-semibold text-[var(--text-main)]">{{ t("ide.workspace.typedProfile.spaceEnvironment") }}</div>
                    <input :value="draft.location.parent ?? ''" class="field" :placeholder="t('ide.workspace.typedProfile.parentLocation')" @input="draft.location.parent = ($event.target as HTMLInputElement).value || null" @blur="void saveDraft()">
                    <input :value="draft.location.region ?? ''" class="field" :placeholder="t('ide.workspace.typedProfile.region')" @input="draft.location.region = ($event.target as HTMLInputElement).value || null" @blur="void saveDraft()">
                    <input :value="draft.location.terrain ?? ''" class="field" :placeholder="t('ide.workspace.typedProfile.terrain')" @input="draft.location.terrain = ($event.target as HTMLInputElement).value || null" @blur="void saveDraft()">
                    <input :value="draft.location.climate ?? ''" class="field" :placeholder="t('ide.workspace.typedProfile.climate')" @input="draft.location.climate = ($event.target as HTMLInputElement).value || null" @blur="void saveDraft()">
                    <textarea :value="draft.location.atmosphere ?? ''" rows="3" class="textarea" :placeholder="t('ide.workspace.typedProfile.atmosphere')" @input="draft.location.atmosphere = ($event.target as HTMLTextAreaElement).value || null" @blur="void saveDraft()"></textarea>
                </div>
                <div class="space-y-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                    <div class="font-semibold text-[var(--text-main)]">{{ t("ide.workspace.typedProfile.availability") }}</div>
                    <textarea :value="draft.location.access ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.typedProfile.access')" @input="draft.location.access = ($event.target as HTMLTextAreaElement).value || null" @blur="void saveDraft()"></textarea>
                    <TagInput :model-value="draft.location.landmarks" :placeholder="t('ide.workspace.typedProfile.landmarks')" @update:model-value="draft.location.landmarks = $event; void saveDraft()" />
                    <TagInput :model-value="draft.location.risks" :placeholder="t('ide.workspace.typedProfile.risks')" @update:model-value="draft.location.risks = $event; void saveDraft()" />
                    <TagInput :model-value="draft.location.resources" :placeholder="t('ide.workspace.typedProfile.resources')" @update:model-value="draft.location.resources = $event; void saveDraft()" />
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
