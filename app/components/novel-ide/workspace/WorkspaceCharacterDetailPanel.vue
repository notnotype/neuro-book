<script setup lang="ts">
import YAML from "yaml";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import SideDetailPanel from "nbook/app/components/common/SideDetailPanel.vue";
import TagInput from "nbook/app/components/common/form/TagInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {CharacterExt, CharacterMeta, CharacterProfile, CharacterStory} from "nbook/shared/dto/character.dto";
import {
    getWorkspaceLorebookStatusIndicatorClass,
} from "nbook/app/components/novel-ide/workspace/workspace-entry-meta";
import {useNovelIdeStore, type WorkspaceFileIssue, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";

type CharacterRef = {
    relation: string;
    target: string;
    note: string | null;
};

type CharacterDraft = {
    title: string;
    path: string;
    status: string;
    aliases: string[];
    tags: string[];
    summary: string;
    content: string;
    refs: CharacterRef[];
    retrieval: {
        enabled: boolean;
        trigger: string | null;
    };
    governance: {
        source: string;
        review: string;
    };
    /** 旧内容节点可能保留的废弃 writingTip 字段；仅用于原样写回。 */
    legacyWritingTip?: string | null;
    ext: Record<string, unknown>;
    character: CharacterExt;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const props = defineProps<{
    node: WorkspaceFileNode | null;
    issues: WorkspaceFileIssue[];
    height: number;
    modelValue?: boolean;
    dialogOnly?: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "update:height", value: number): void;
    (e: "close"): void;
    (e: "refresh"): void;
}>();

const store = useNovelIdeStore();
const {t} = useI18n();
const {selectedFileContent, savingFile} = storeToRefs(store);
const editForm = ref<CharacterDraft | null>(null);
const lastAppliedContent = ref("");
const diagnostics = ref("");
const dialogOpen = ref(false);
const activeTab = ref<"overview" | "profile" | "relations">("overview");
const expandedSections = ref({
    profile: true,
    appearance: false,
    personality: false,
    abilities: false,
    story: false,
    refs: false,
    retrieval: false,
});

const statusOptions = computed<SelectOption[]>(() => [
    {value: "draft", label: t("ide.workspace.common.statusDraft"), description: t("ide.workspace.common.statusDraftDescription"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("draft")},
    {value: "pending", label: t("ide.workspace.common.statusPending"), description: t("ide.workspace.common.statusPendingDescription"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("pending")},
    {value: "active", label: t("ide.workspace.common.statusActive"), description: t("ide.workspace.common.statusActiveDescription"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("active")},
    {value: "archived", label: t("ide.workspace.common.statusArchived"), description: t("ide.workspace.common.statusArchivedDescription"), indicatorClass: getWorkspaceLorebookStatusIndicatorClass("archived")},
]);
const isDirty = computed(() => editForm.value ? renderDraft(editForm.value) !== selectedFileContent.value : false);
const relatedIssues = computed(() => {
    if (!props.node) {
        return [];
    }
    const currentPath = props.node.path.replace(/\/$/, "");
    return props.issues.filter((issue) => issue.path === props.node?.path || issue.path.startsWith(currentPath));
});

/**
 * 将角色表单写回当前 Markdown 文件。
 */
async function saveDraft(): Promise<void> {
    if (!editForm.value || savingFile.value) {
        return;
    }

    const nextContent = renderDraft(editForm.value);
    if (nextContent === selectedFileContent.value) {
        return;
    }

    selectedFileContent.value = nextContent;
    await store.saveCurrentFile();
    lastAppliedContent.value = nextContent;
    diagnostics.value = "";
}

/**
 * 新增一条角色引用。
 */
function addRef(): void {
    if (!editForm.value) {
        return;
    }
    editForm.value.refs.push({
        relation: "",
        target: "",
        note: null,
    });
    expandedSections.value.refs = true;
}

/**
 * 删除一条角色引用。
 */
function removeRef(index: number): void {
    if (!editForm.value) {
        return;
    }
    editForm.value.refs.splice(index, 1);
    void saveDraft();
}

/**
 * 更新 profile 子字段。
 */
function updateProfile<K extends keyof CharacterProfile>(key: K, value: CharacterProfile[K]): void {
    if (!editForm.value) {
        return;
    }
    editForm.value.character.profile = {
        ...(editForm.value.character.profile ?? {}),
        [key]: value,
    };
}

/**
 * 更新 story 子字段。
 */
function updateStory<K extends keyof CharacterStory>(key: K, value: CharacterStory[K]): void {
    if (!editForm.value) {
        return;
    }
    editForm.value.character.story = {
        ...(editForm.value.character.story ?? {}),
        [key]: value,
    };
}

/**
 * 更新角色元信息子字段。
 */
function updateMeta<K extends keyof CharacterMeta>(key: K, value: CharacterMeta[K]): void {
    if (!editForm.value) {
        return;
    }
    editForm.value.character.meta = {
        ...(editForm.value.character.meta ?? {}),
        [key]: value,
    };
}

watch(() => [props.node?.path, selectedFileContent.value], () => {
    if (!props.node || selectedFileContent.value === lastAppliedContent.value) {
        return;
    }
    const parsed = parseMarkdownDocument(selectedFileContent.value);
    editForm.value = createDraft(props.node, parsed.frontmatter, parsed.body);
    lastAppliedContent.value = selectedFileContent.value;
    diagnostics.value = parsed.error ?? "";
    if (props.dialogOnly) {
        dialogOpen.value = props.modelValue === true;
    }
}, {immediate: true});

watch(() => props.modelValue, (visible) => {
    if (props.dialogOnly) {
        dialogOpen.value = visible === true;
    }
});

/**
 * 更新角色档案弹窗显隐状态。
 */
function updateDialogVisible(visible: boolean): void {
    if (props.dialogOnly) {
        emit("update:modelValue", visible);
        return;
    }
    dialogOpen.value = visible;
}

function parseMarkdownDocument(content: string): {
    frontmatter: Record<string, unknown>;
    body: string;
    error: string | null;
} {
    const match = content.match(FRONTMATTER_PATTERN);
    if (!match) {
        return {frontmatter: {}, body: content, error: null};
    }

    try {
        const parsed = YAML.parse(match[1] ?? "", {logLevel: "silent"}) as unknown;
        return {
            frontmatter: isPlainObject(parsed) ? parsed : {},
            body: content.slice(match[0].length),
            error: isPlainObject(parsed) || parsed === null ? null : t("ide.workspace.common.frontmatterObjectError"),
        };
    } catch (error) {
        return {
            frontmatter: {},
            body: content.slice(match[0].length),
            error: error instanceof Error ? error.message : t("ide.workspace.common.frontmatterParseFailed"),
        };
    }
}

function createDraft(node: WorkspaceFileNode, frontmatter: Record<string, unknown>, body: string): CharacterDraft {
    const ext = readPlainObject(frontmatter.ext);
    const legacyCharacterExt = readPlainObject(ext.character);
    const characterExt = Object.keys(readPlainObject(frontmatter.character)).length > 0
        ? readPlainObject(frontmatter.character)
        : legacyCharacterExt;
    const characterMeta = readPlainObject(characterExt.meta);
    const pinned = characterMeta.pinned;
    const legacyWritingTip = Object.prototype.hasOwnProperty.call(frontmatter, "writingTip")
        ? {legacyWritingTip: readNullableString(frontmatter.writingTip)}
        : {};
    return {
        title: readString(frontmatter.title, node.title || basename(node.path)),
        path: node.path,
        status: readString(frontmatter.status, "draft"),
        aliases: readStringArray(frontmatter.aliases),
        tags: readStringArray(frontmatter.tags),
        summary: readString(frontmatter.summary, ""),
        content: body,
        refs: readRefs(frontmatter.refs),
        retrieval: readRetrieval(frontmatter.retrieval),
        governance: readGovernance(frontmatter.governance),
        ext: omitCharacterExt(ext),
        character: {
            logline: readNullableString(characterExt.logline) ?? undefined,
            profile: readCharacterProfile(characterExt.profile),
            story: readCharacterStory(characterExt.story),
            meta: {
                pinned: typeof pinned === "boolean" ? pinned : false,
                primaryContext: readNullableString(characterMeta.primaryContext) ?? undefined,
            },
        },
        ...legacyWritingTip,
    };
}

function renderDraft(draft: CharacterDraft): string {
    const frontmatter = {
        title: draft.title,
        type: "character",
        subtype: "person",
        status: draft.status,
        aliases: draft.aliases,
        tags: draft.tags,
        summary: draft.summary,
        refs: draft.refs,
        retrieval: draft.retrieval,
        governance: draft.governance,
        ...(draft.legacyWritingTip !== undefined ? {writingTip: draft.legacyWritingTip} : {}),
        character: draft.character,
        ...(Object.keys(draft.ext).length > 0 ? {ext: draft.ext} : {}),
    };
    return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${draft.content}`;
}

/**
 * 保留 ext 的自由扩展字段，但不再写回已废弃的 ext.character。
 */
function omitCharacterExt(ext: Record<string, unknown>): Record<string, unknown> {
    const nextExt = {...ext};
    delete nextExt.character;
    return nextExt;
}

function readCharacterProfile(value: unknown): CharacterProfile {
    const profile = readPlainObject(value);
    return {
        gender: readNullableString(profile.gender) ?? undefined,
        age: readNullableString(profile.age) ?? undefined,
        race: readNullableString(profile.race) ?? undefined,
        faction: readNullableString(profile.faction) ?? undefined,
        occupation: readNullableString(profile.occupation) ?? undefined,
        identity: readNullableString(profile.identity) ?? undefined,
        residence: readNullableString(profile.residence) ?? undefined,
        origin: readNullableString(profile.origin) ?? undefined,
        appearance: readNullableString(profile.appearance) ?? undefined,
        bodyFeatures: readStringArray(profile.bodyFeatures),
        clothingStyle: readNullableString(profile.clothingStyle) ?? undefined,
        voiceStyle: readNullableString(profile.voiceStyle) ?? undefined,
        mannerisms: readStringArray(profile.mannerisms),
        personalityTraits: readStringArray(profile.personalityTraits),
        temperament: readNullableString(profile.temperament) ?? undefined,
        likes: readStringArray(profile.likes),
        dislikes: readStringArray(profile.dislikes),
        fears: readStringArray(profile.fears),
        weaknesses: readStringArray(profile.weaknesses),
        desires: readNullableString(profile.desires) ?? undefined,
        motivation: readNullableString(profile.motivation) ?? undefined,
        values: readNullableString(profile.values) ?? undefined,
        secrets: readNullableString(profile.secrets) ?? undefined,
        abilities: readStringArray(profile.abilities),
        skills: readStringArray(profile.skills),
        equipment: readStringArray(profile.equipment),
        resources: readStringArray(profile.resources),
        limitations: readNullableString(profile.limitations) ?? undefined,
    };
}

function readCharacterStory(value: unknown): CharacterStory {
    const story = readPlainObject(value);
    return {
        firstAppearance: readNullableString(story.firstAppearance) ?? undefined,
        roleInStory: readNullableString(story.roleInStory) ?? undefined,
        characterArc: readNullableString(story.characterArc) ?? undefined,
        currentState: readNullableString(story.currentState) ?? undefined,
        keyEvents: readStringArray(story.keyEvents),
        goalsShortTerm: readNullableString(story.goalsShortTerm) ?? undefined,
        goalsLongTerm: readNullableString(story.goalsLongTerm) ?? undefined,
        publicPersona: readNullableString(story.publicPersona) ?? undefined,
        trueSelf: readNullableString(story.trueSelf) ?? undefined,
    };
}

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readPlainObject(value: unknown): Record<string, unknown> {
    return isPlainObject(value) ? value : {};
}

function readRefs(value: unknown): CharacterRef[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isPlainObject).map((item) => ({
        relation: readString(item.relation, ""),
        target: readString(item.target, ""),
        note: readNullableString(item.note),
    }));
}

function readRetrieval(value: unknown): CharacterDraft["retrieval"] {
    const retrieval = readPlainObject(value);
    return {
        enabled: typeof retrieval.enabled === "boolean" ? retrieval.enabled : true,
        trigger: readNullableString(retrieval.trigger),
    };
}

function readGovernance(value: unknown): CharacterDraft["governance"] {
    const governance = readPlainObject(value);
    return {
        source: readString(governance.source, "manual"),
        review: readString(governance.review, "proposed"),
    };
}

function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
</script>

<template>
    <SideDetailPanel v-if="!props.dialogOnly" :visible="Boolean(props.node)" :height="props.height" body-class="overflow-x-hidden p-3" @update:height="emit('update:height', $event)" @close="emit('close')">
        <template #header>
            <div class="flex min-w-0 items-center gap-2">
                <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]">
                    <span class="i-lucide-user-round h-3.5 w-3.5"></span>
                </span>
                <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ editForm?.title || t("ide.workspace.character.panelTitle") }}</div>
                    <div class="truncate text-[10px] text-[var(--text-muted)]">{{ editForm?.path }}</div>
                </div>
                <span v-if="isDirty" class="h-2 w-2 shrink-0 rounded-full bg-[var(--status-warning)]" :title="t('ide.workspace.common.dirty')"></span>
            </div>
        </template>

        <template #actions>
            <button class="rounded-md px-2 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" @click="emit('refresh')">{{ t("ide.workspace.common.refresh") }}</button>
            <button class="rounded-md px-2 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" type="button" @click="dialogOpen = true">{{ t("ide.workspace.character.profile") }}</button>
        </template>

        <div v-if="editForm" class="space-y-3 text-[11px]">
            <!-- 角色详情入口 -->
            <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <div class="flex items-start gap-3">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]">
                        <span class="i-lucide-user-round h-5 w-5"></span>
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ editForm.title }}</div>
                        <div class="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-secondary)]">{{ editForm.summary || editForm.character.logline || t("ide.workspace.character.noSummary") }}</div>
                        <div class="mt-2 truncate font-mono text-[10px] text-[var(--text-muted)]">{{ editForm.path }}</div>
                    </div>
                </div>
                <button type="button" class="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="dialogOpen = true">
                    <span class="i-lucide-expand h-3.5 w-3.5"></span>
                    {{ t("ide.workspace.character.openProfile") }}
                </button>
            </div>
        </div>
    </SideDetailPanel>

    <Dialog
        :model-value="dialogOpen"
        :title="editForm?.title || t('ide.workspace.character.profileTitle')"
        width="min(1280px, calc(100vw - 160px))"
        height="min(760px, calc(100vh - 96px))"
        overlay-type="opaque"
        :show-footer="false"
        @update:model-value="updateDialogVisible"
    >
        <template #header>
            <!-- 角色档案头部 -->
            <div class="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div class="flex min-w-0 items-center gap-4">
                    <span class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm">
                        <span class="i-lucide-user-round h-8 w-8"></span>
                    </span>
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <h2 class="truncate text-2xl font-bold tracking-wide text-[var(--text-main)]">{{ editForm?.title || t("ide.workspace.character.profileTitle") }}</h2>
                            <span v-if="editForm?.status" class="rounded-full border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-0.5 text-[11px] text-[var(--status-warning)]">{{ editForm.status }}</span>
                            <span v-if="isDirty" class="h-2 w-2 shrink-0 rounded-full bg-[var(--status-warning)]" :title="t('ide.workspace.common.dirty')"></span>
                        </div>
                        <div class="mt-1 truncate text-sm text-[var(--text-secondary)]">{{ editForm?.character.logline || editForm?.summary || t("ide.workspace.character.noDefinition") }}</div>
                        <div class="mt-2 flex flex-wrap gap-1.5">
                            <span v-for="tag in editForm?.tags ?? []" :key="tag" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{{ tag }}</span>
                        </div>
                    </div>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <button class="icon-action" type="button" :title="t('ide.workspace.common.refresh')" @click="emit('refresh')"><span class="i-lucide-refresh-cw h-4 w-4"></span></button>
                    <button class="icon-action" type="button" :title="t('ide.workspace.common.save')" :disabled="savingFile" @click="void saveDraft()"><span class="i-lucide-save h-4 w-4"></span></button>
                    <span class="mx-2 h-7 w-px bg-[var(--border-color)]"></span>
                    <button class="icon-action" type="button" :title="t('ide.workspace.common.close')" @click="updateDialogVisible(false)"><span class="i-lucide-x h-5 w-5"></span></button>
                </div>
            </div>
        </template>

        <div v-if="editForm" class="space-y-3 text-[11px]" :class="savingFile ? 'pointer-events-none opacity-80' : ''">
            <div v-if="diagnostics" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[var(--status-warning)]">{{ diagnostics }}</div>
            <div v-for="issue in relatedIssues" :key="`${issue.code}:${issue.path}:${issue.message}`" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[var(--status-warning)]">[{{ issue.level }}] {{ issue.message }}</div>

            <!-- 角色表单分页 -->
            <div class="flex rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] p-1">
                <button type="button" class="tab-button" :class="activeTab === 'overview' ? 'tab-button-active' : ''" @click="activeTab = 'overview'">{{ t("ide.workspace.character.overview") }}</button>
                <button type="button" class="tab-button" :class="activeTab === 'profile' ? 'tab-button-active' : ''" @click="activeTab = 'profile'">{{ t("ide.workspace.character.profileTab") }}</button>
                <button type="button" class="tab-button" :class="activeTab === 'relations' ? 'tab-button-active' : ''" @click="activeTab = 'relations'">{{ t("ide.workspace.character.relationsTab") }}</button>
            </div>

            <!-- 角色核心信息 -->
            <section v-if="activeTab === 'overview'" class="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <div class="grid grid-cols-[minmax(0,1fr)_132px] gap-2">
                    <label class="space-y-1">
                        <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.character.name") }}</span>
                        <input v-model="editForm.title" class="h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" type="text" @blur="void saveDraft()">
                    </label>
                    <label class="space-y-1">
                        <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.common.status") }}</span>
                        <FormSelect :model-value="editForm.status" :options="statusOptions" @update:model-value="editForm.status = $event; void saveDraft()" />
                    </label>
                </div>
                <label class="space-y-1">
                    <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.character.logline") }}</span>
                    <input :value="editForm.character.logline ?? ''" class="h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" type="text" @input="editForm.character.logline = ($event.target as HTMLInputElement).value || undefined" @blur="void saveDraft()">
                </label>
                <label class="space-y-1">
                    <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.common.summary") }}</span>
                    <textarea v-model="editForm.summary" rows="3" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 text-xs leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" @blur="void saveDraft()"></textarea>
                </label>
                <div class="grid grid-cols-2 gap-2">
                    <label class="space-y-1">
                        <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.common.aliases") }}</span>
                        <TagInput :model-value="editForm.aliases" :placeholder="t('ide.workspace.common.addAlias')" @update:model-value="editForm.aliases = $event; void saveDraft()" />
                    </label>
                    <label class="space-y-1">
                        <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.common.tags") }}</span>
                        <TagInput :model-value="editForm.tags" :placeholder="t('ide.workspace.common.addTag')" accentStyle @update:model-value="editForm.tags = $event; void saveDraft()" />
                    </label>
                </div>
                <div class="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                    <label class="space-y-1">
                        <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.character.primaryContext") }}</span>
                        <input :value="editForm.character.meta?.primaryContext ?? ''" class="field" :placeholder="t('ide.workspace.character.primaryContextPlaceholder')" @input="updateMeta('primaryContext', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    </label>
                    <label class="flex items-end gap-2 pb-1 text-[var(--text-secondary)]">
                        <input :checked="editForm.character.meta?.pinned === true" type="checkbox" class="h-4 w-4 rounded border-[var(--border-color)]" @change="updateMeta('pinned', ($event.target as HTMLInputElement).checked); void saveDraft()">
                        <span>{{ t("ide.workspace.character.pinned") }}</span>
                    </label>
                </div>
                <label class="space-y-1">
                    <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.character.governanceStatus") }}</span>
                    <div class="grid grid-cols-2 gap-1">
                        <input v-model="editForm.governance.source" class="field" placeholder="source" @blur="void saveDraft()">
                        <input v-model="editForm.governance.review" class="field" placeholder="review" @blur="void saveDraft()">
                    </div>
                </label>
                <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
                    <label class="flex items-center gap-2 text-[var(--text-secondary)]">
                        <input v-model="editForm.retrieval.enabled" type="checkbox" class="h-4 w-4 rounded border-[var(--border-color)]" @change="void saveDraft()">
                        <span>{{ t("ide.workspace.common.allowRetrieval") }}</span>
                    </label>
                </div>
                <label class="space-y-1">
                    <span class="text-[var(--text-secondary)]">{{ t("ide.workspace.character.aiTrigger") }}</span>
                    <textarea :value="editForm.retrieval.trigger ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.aiTriggerPlaceholder')" @input="editForm.retrieval.trigger = ($event.target as HTMLTextAreaElement).value || null" @blur="void saveDraft()"></textarea>
                </label>
            </section>

            <!-- 基础身份 -->
            <section v-if="activeTab === 'profile'" class="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <button type="button" class="flex w-full items-center justify-between text-left font-medium text-[var(--text-main)]" @click="expandedSections.profile = !expandedSections.profile">
                    <span>{{ t("ide.workspace.character.baseIdentity") }}</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform" :class="expandedSections.profile ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.profile" class="grid grid-cols-4 gap-2">
                    <input :value="editForm.character.profile?.gender ?? ''" class="field" :placeholder="t('ide.workspace.character.gender')" @input="updateProfile('gender', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    <input :value="editForm.character.profile?.age ?? ''" class="field" :placeholder="t('ide.workspace.character.age')" @input="updateProfile('age', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    <input :value="editForm.character.profile?.race ?? ''" class="field" :placeholder="t('ide.workspace.character.race')" @input="updateProfile('race', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    <input :value="editForm.character.profile?.faction ?? ''" class="field" :placeholder="t('ide.workspace.character.faction')" @input="updateProfile('faction', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    <input :value="editForm.character.profile?.occupation ?? ''" class="field" :placeholder="t('ide.workspace.character.occupation')" @input="updateProfile('occupation', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    <input :value="editForm.character.profile?.identity ?? ''" class="field" :placeholder="t('ide.workspace.character.identity')" @input="updateProfile('identity', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    <input :value="editForm.character.profile?.residence ?? ''" class="field" :placeholder="t('ide.workspace.character.residence')" @input="updateProfile('residence', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    <input :value="editForm.character.profile?.origin ?? ''" class="field" :placeholder="t('ide.workspace.character.origin')" @input="updateProfile('origin', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                </div>
            </section>

            <!-- 外貌与性格 -->
            <section v-if="activeTab === 'profile'" class="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <button type="button" class="flex w-full items-center justify-between text-left font-medium text-[var(--text-main)]" @click="expandedSections.appearance = !expandedSections.appearance">
                    <span>{{ t("ide.workspace.character.appearanceTitle") }}</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform" :class="expandedSections.appearance ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.appearance" class="space-y-2">
                    <textarea :value="editForm.character.profile?.appearance ?? ''" rows="3" class="textarea" :placeholder="t('ide.workspace.character.appearance')" @input="updateProfile('appearance', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                    <div class="grid grid-cols-2 gap-2">
                        <input :value="editForm.character.profile?.clothingStyle ?? ''" class="field" :placeholder="t('ide.workspace.character.clothingStyle')" @input="updateProfile('clothingStyle', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                        <input :value="editForm.character.profile?.voiceStyle ?? ''" class="field" :placeholder="t('ide.workspace.character.voiceStyle')" @input="updateProfile('voiceStyle', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    </div>
                    <TagInput :model-value="editForm.character.profile?.bodyFeatures ?? []" :placeholder="t('ide.workspace.character.bodyFeatures')" @update:model-value="updateProfile('bodyFeatures', $event); void saveDraft()" />
                    <TagInput :model-value="editForm.character.profile?.mannerisms ?? []" :placeholder="t('ide.workspace.character.mannerisms')" @update:model-value="updateProfile('mannerisms', $event); void saveDraft()" />
                </div>
            </section>

            <section v-if="activeTab === 'profile'" class="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <button type="button" class="flex w-full items-center justify-between text-left font-medium text-[var(--text-main)]" @click="expandedSections.personality = !expandedSections.personality">
                    <span>{{ t("ide.workspace.character.personalityTitle") }}</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform" :class="expandedSections.personality ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.personality" class="space-y-2">
                    <TagInput :model-value="editForm.character.profile?.personalityTraits ?? []" :placeholder="t('ide.workspace.character.personalityTraits')" accentStyle @update:model-value="updateProfile('personalityTraits', $event); void saveDraft()" />
                    <input :value="editForm.character.profile?.temperament ?? ''" class="field" :placeholder="t('ide.workspace.character.temperament')" @input="updateProfile('temperament', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    <div class="grid grid-cols-2 gap-2">
                        <textarea :value="editForm.character.profile?.motivation ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.motivation')" @input="updateProfile('motivation', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                        <textarea :value="editForm.character.profile?.secrets ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.secrets')" @input="updateProfile('secrets', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <textarea :value="editForm.character.profile?.desires ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.desires')" @input="updateProfile('desires', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                        <textarea :value="editForm.character.profile?.values ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.values')" @input="updateProfile('values', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <TagInput :model-value="editForm.character.profile?.likes ?? []" :placeholder="t('ide.workspace.character.likes')" @update:model-value="updateProfile('likes', $event); void saveDraft()" />
                        <TagInput :model-value="editForm.character.profile?.dislikes ?? []" :placeholder="t('ide.workspace.character.dislikes')" @update:model-value="updateProfile('dislikes', $event); void saveDraft()" />
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <TagInput :model-value="editForm.character.profile?.fears ?? []" :placeholder="t('ide.workspace.character.fears')" @update:model-value="updateProfile('fears', $event); void saveDraft()" />
                        <TagInput :model-value="editForm.character.profile?.weaknesses ?? []" :placeholder="t('ide.workspace.character.weaknesses')" @update:model-value="updateProfile('weaknesses', $event); void saveDraft()" />
                    </div>
                </div>
            </section>

            <!-- 能力与叙事 -->
            <section v-if="activeTab === 'profile'" class="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <button type="button" class="flex w-full items-center justify-between text-left font-medium text-[var(--text-main)]" @click="expandedSections.abilities = !expandedSections.abilities">
                    <span>{{ t("ide.workspace.character.abilitiesTitle") }}</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform" :class="expandedSections.abilities ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.abilities" class="grid grid-cols-2 gap-2">
                    <TagInput :model-value="editForm.character.profile?.abilities ?? []" :placeholder="t('ide.workspace.character.abilities')" @update:model-value="updateProfile('abilities', $event); void saveDraft()" />
                    <TagInput :model-value="editForm.character.profile?.skills ?? []" :placeholder="t('ide.workspace.character.skills')" @update:model-value="updateProfile('skills', $event); void saveDraft()" />
                    <TagInput :model-value="editForm.character.profile?.equipment ?? []" :placeholder="t('ide.workspace.character.equipment')" @update:model-value="updateProfile('equipment', $event); void saveDraft()" />
                    <TagInput :model-value="editForm.character.profile?.resources ?? []" :placeholder="t('ide.workspace.character.resources')" @update:model-value="updateProfile('resources', $event); void saveDraft()" />
                    <textarea :value="editForm.character.profile?.limitations ?? ''" rows="2" class="textarea col-span-2" :placeholder="t('ide.workspace.character.limitations')" @input="updateProfile('limitations', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                </div>
            </section>

            <section v-if="activeTab === 'profile'" class="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <button type="button" class="flex w-full items-center justify-between text-left font-medium text-[var(--text-main)]" @click="expandedSections.story = !expandedSections.story">
                    <span>{{ t("ide.workspace.character.storyTitle") }}</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform" :class="expandedSections.story ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.story" class="space-y-2">
                    <div class="grid grid-cols-2 gap-2">
                        <input :value="editForm.character.story?.firstAppearance ?? ''" class="field" :placeholder="t('ide.workspace.character.firstAppearance')" @input="updateStory('firstAppearance', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                        <input :value="editForm.character.story?.roleInStory ?? ''" class="field" :placeholder="t('ide.workspace.character.roleInStory')" @input="updateStory('roleInStory', ($event.target as HTMLInputElement).value || undefined)" @blur="void saveDraft()">
                    </div>
                    <textarea :value="editForm.character.story?.currentState ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.currentState')" @input="updateStory('currentState', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                    <textarea :value="editForm.character.story?.characterArc ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.characterArc')" @input="updateStory('characterArc', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                    <TagInput :model-value="editForm.character.story?.keyEvents ?? []" :placeholder="t('ide.workspace.character.keyEvents')" accentStyle @update:model-value="updateStory('keyEvents', $event); void saveDraft()" />
                    <div class="grid grid-cols-2 gap-2">
                        <textarea :value="editForm.character.story?.goalsShortTerm ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.goalsShortTerm')" @input="updateStory('goalsShortTerm', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                        <textarea :value="editForm.character.story?.goalsLongTerm ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.goalsLongTerm')" @input="updateStory('goalsLongTerm', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <textarea :value="editForm.character.story?.publicPersona ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.publicPersona')" @input="updateStory('publicPersona', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                        <textarea :value="editForm.character.story?.trueSelf ?? ''" rows="2" class="textarea" :placeholder="t('ide.workspace.character.trueSelf')" @input="updateStory('trueSelf', ($event.target as HTMLTextAreaElement).value || undefined)" @blur="void saveDraft()"></textarea>
                    </div>
                </div>
            </section>

            <!-- 引用与正文 -->
            <section v-if="activeTab === 'relations'" class="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]/40 p-3">
                <button type="button" class="flex w-full items-center justify-between text-left font-medium text-[var(--text-main)]" @click="expandedSections.refs = !expandedSections.refs">
                    <span>{{ t("ide.workspace.character.referencesAndBody") }}</span>
                    <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform" :class="expandedSections.refs ? '' : '-rotate-90'"></span>
                </button>
                <div v-show="expandedSections.refs" class="space-y-2">
                    <div v-for="(entryRef, index) in editForm.refs" :key="index" class="flex items-center gap-1">
                        <input v-model="entryRef.relation" type="text" :placeholder="t('ide.workspace.common.relation')" class="field w-[76px]" @blur="void saveDraft()">
                        <input v-model="entryRef.target" type="text" :placeholder="t('ide.workspace.common.targetPath')" class="field min-w-0 flex-1 font-mono" @blur="void saveDraft()">
                        <button type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" @click="removeRef(index)">
                            <span class="i-lucide-x h-3.5 w-3.5"></span>
                        </button>
                    </div>
                    <button type="button" class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)]" @click="addRef">
                        <span class="i-lucide-plus h-3 w-3"></span>{{ t("ide.workspace.common.addReference") }}
                    </button>
                    <textarea v-model="editForm.content" rows="6" class="textarea" :placeholder="t('ide.workspace.character.bodyPlaceholder')" @blur="void saveDraft()"></textarea>
                </div>
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
    font-size: 0.75rem;
    color: var(--text-main);
    outline: none;
}

.field:focus,
.textarea:focus {
    border-color: var(--accent-main);
}

.textarea {
    width: 100%;
    resize: vertical;
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
    background: var(--bg-panel);
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
    line-height: 1.25rem;
    color: var(--text-main);
    outline: none;
}

.tab-button {
    min-width: 0;
    flex: 1;
    border-radius: 0.375rem;
    padding: 0.375rem 0.5rem;
    font-size: 0.6875rem;
    color: var(--text-muted);
    transition: background-color 0.15s ease, color 0.15s ease;
}

.tab-button:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.tab-button-active {
    background: var(--bg-panel);
    color: var(--text-main);
    box-shadow: inset 0 0 0 1px var(--border-color);
}

.icon-action {
    display: inline-flex;
    height: 2rem;
    width: 2rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    color: var(--text-muted);
    transition: background-color 0.15s ease, color 0.15s ease;
}

.icon-action:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.icon-action:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}
</style>
