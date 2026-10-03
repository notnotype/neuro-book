<script setup lang="ts">
import YAML from "yaml";
import {storeToRefs} from "pinia";
import SideDetailPanel from "nbook/app/components/common/SideDetailPanel.vue";
import LucideIconPickerDialog from "nbook/app/components/common/LucideIconPickerDialog.vue";
import TagInput from "nbook/app/components/common/form/TagInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useNovelIdeStore, type WorkspaceFileIssue, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {isWorkspaceContentScopePath} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";
import {normalizeLucideIconName, readLucideIconClass} from "nbook/app/utils/lucide-icons";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

type ManuscriptFrontmatterDraft = {
    title: string;
    status: string;
    tags: string[];
    summary: string;
};

type ManuscriptStatsSnapshot = {
    currentWords: number;
    totalWords: number;
    totalSize: number;
    chapters: number;
    files: number;
    updatedAt: string;
};

const props = defineProps<{
    node: WorkspaceFileNode | null;
    issues: WorkspaceFileIssue[];
    height: number;
}>();

const emit = defineEmits<{
    (e: "update:height", value: number): void;
    (e: "close"): void;
    (e: "create-index"): void;
    (e: "convert-file-to-directory"): void;
}>();

const store = useNovelIdeStore();
const {t, locale} = useI18n();
const {selectedFileContent, savingFile, workspaceTree} = storeToRefs(store);
const frontmatterText = ref("");
const markdownBody = ref("");
const localFrontmatterError = ref<string | null>(null);
const lastLoadedContent = ref("");
const iconPickerVisible = ref(false);
const manuscriptForm = ref<ManuscriptFrontmatterDraft>({
    title: "",
    status: "",
    tags: [],
    summary: "",
});
const manuscriptStats = ref<ManuscriptStatsSnapshot>({
    currentWords: 0,
    totalWords: 0,
    totalSize: 0,
    chapters: 0,
    files: 0,
    updatedAt: "",
});
const manuscriptStatusOptions = computed<SelectOption[]>(() => [
    {value: "draft", label: t("ide.workspace.fileDetail.draft"), description: t("ide.workspace.common.statusDraftDescription")},
    {value: "pending", label: t("ide.workspace.fileDetail.pending"), description: t("ide.workspace.common.statusPendingDescription")},
    {value: "active", label: t("ide.workspace.fileDetail.active"), description: t("ide.workspace.fileDetail.activeDescription")},
    {value: "archived", label: t("ide.workspace.fileDetail.archived"), description: t("ide.workspace.common.statusArchivedDescription")},
]);

const isMarkdownFile = computed(() => Boolean(props.node?.editable && props.node.path.toLowerCase().endsWith(".md")));
const isContentIndexFile = computed(() => Boolean(isMarkdownFile.value && props.node?.contentNode && props.node.path.toLowerCase().endsWith("/index.md")));
const isManuscriptIndexFile = computed(() => Boolean(isContentIndexFile.value && props.node?.path.startsWith("manuscript/")));
const isDirectoryWithoutIndex = computed(() => Boolean(props.node?.isDirectory && !props.node.hasIndex));
const isContentDirectoryWithoutIndex = computed(() => Boolean(props.node?.isDirectory && !props.node.hasIndex && isWorkspaceContentScopePath(props.node.path)));
const canEditFrontmatter = computed(() => Boolean(isContentIndexFile.value && !isManuscriptIndexFile.value && !localFrontmatterError.value && !props.node?.frontmatterError));
const canCreateIndex = computed(() => Boolean(isContentDirectoryWithoutIndex.value));
const canConvertFileToDirectory = computed(() => Boolean(
    props.node
    && !props.node.isDirectory
    && props.node.editable
    && isWorkspaceContentScopePath(props.node.path)
    && !props.node.path.toLowerCase().endsWith("/index.md"),
));
const renderedContent = computed(() => renderMarkdownDocument(frontmatterText.value, markdownBody.value));
const isFrontmatterDirty = computed(() => isContentIndexFile.value && renderedContent.value !== selectedFileContent.value);
const manuscriptBasePath = computed(() => {
    if (!props.node) {
        return "";
    }
    if (props.node.path.toLowerCase().endsWith("/index.md")) {
        return props.node.path.slice(0, -"/index.md".length);
    }
    return props.node.path.replace(/\/$/, "");
});
const currentIconName = computed(() => normalizeLucideIconName(parseFrontmatterText(frontmatterText.value).frontmatter.icon));
const currentIconClass = computed(() => readLucideIconClass(currentIconName.value) ?? "i-lucide-notebook-tabs");
const readonlyFrontmatterText = computed(() => {
    if (!props.node) {
        return "";
    }
    if (Object.keys(props.node.frontmatter).length === 0) {
        return "{}";
    }
    return YAML.stringify(props.node.frontmatter).trimEnd();
});
const relatedIssues = computed(() => {
    if (!props.node) {
        return [];
    }

    const currentPath = props.node.path.replace(/\/$/, "");
    return props.issues.filter((issue) => issue.path === props.node?.path || issue.path.startsWith(currentPath));
});
const hasRelatedIssues = computed(() => relatedIssues.value.length > 0);

/**
 * 保存当前 Markdown 文件的 frontmatter，正文保持不变。
 */
async function saveFrontmatter(): Promise<void> {
    if (!isContentIndexFile.value || localFrontmatterError.value || props.node?.frontmatterError || savingFile.value || !isFrontmatterDirty.value) {
        return;
    }

    selectedFileContent.value = renderedContent.value;
    await store.saveCurrentFile();
    lastLoadedContent.value = selectedFileContent.value;
}

/**
 * 保存 manuscript 节点表单，保留未展示的 frontmatter 字段。
 */
async function saveManuscriptForm(): Promise<void> {
    if (!isManuscriptIndexFile.value || localFrontmatterError.value || props.node?.frontmatterError || savingFile.value) {
        return;
    }

    const parsed = parseFrontmatterText(frontmatterText.value);
    if (parsed.error) {
        localFrontmatterError.value = parsed.error;
        return;
    }

    frontmatterText.value = YAML.stringify({
        ...parsed.frontmatter,
        title: manuscriptForm.value.title,
        status: manuscriptForm.value.status || null,
        tags: manuscriptForm.value.tags,
        summary: manuscriptForm.value.summary,
    }).trimEnd();
    await saveFrontmatter();
}

/**
 * 手动刷新 manuscript 当前节点与子树统计快照。
 */
function refreshManuscriptStats(): void {
    if (!props.node || !isManuscriptIndexFile.value) {
        manuscriptStats.value = {
            currentWords: props.node?.words ?? 0,
            totalWords: props.node?.words ?? 0,
            totalSize: props.node?.size ?? 0,
            chapters: 0,
            files: 0,
            updatedAt: "",
        };
        return;
    }

    const prefix = `${manuscriptBasePath.value}/`;
    const descendants = workspaceTree.value.filter((node) => node.path.startsWith(prefix));
    manuscriptStats.value = {
        currentWords: props.node.words,
        totalWords: descendants.reduce((total, node) => total + node.words, props.node?.words ?? 0),
        totalSize: descendants.reduce((total, node) => total + node.size, props.node?.size ?? 0),
        chapters: descendants.filter((node) => node.contentNode && !node.isDirectory && node.path.toLowerCase().endsWith("/index.md")).length,
        files: descendants.filter((node) => !node.isDirectory).length,
        updatedAt: new Date().toLocaleTimeString(locale.value, {hour: "2-digit", minute: "2-digit"}),
    };
}

/**
 * 将选择器里的图标名写入当前 frontmatter。
 */
function applySelectedIcon(iconName: string): void {
    const parsed = parseFrontmatterText(frontmatterText.value);
    if (parsed.error) {
        localFrontmatterError.value = parsed.error;
        return;
    }

    frontmatterText.value = YAML.stringify({
        ...parsed.frontmatter,
        icon: iconName,
    }).trimEnd();
    void saveFrontmatter();
}

watch(() => [props.node?.path, selectedFileContent.value], () => {
    if (!isContentIndexFile.value) {
        frontmatterText.value = "";
        markdownBody.value = "";
        localFrontmatterError.value = null;
        lastLoadedContent.value = selectedFileContent.value;
        return;
    }
    if (selectedFileContent.value === lastLoadedContent.value) {
        return;
    }

    const parsed = parseMarkdownDocument(selectedFileContent.value);
    frontmatterText.value = parsed.frontmatterText;
    markdownBody.value = parsed.body;
    localFrontmatterError.value = parsed.error;
    if (props.node) {
        manuscriptForm.value = createManuscriptDraft(props.node, parseFrontmatterText(parsed.frontmatterText).frontmatter);
        refreshManuscriptStats();
    }
    lastLoadedContent.value = selectedFileContent.value;
}, {immediate: true});

watch(frontmatterText, () => {
    if (!isContentIndexFile.value) {
        localFrontmatterError.value = null;
        return;
    }
    localFrontmatterError.value = parseFrontmatterText(frontmatterText.value).error;
});

function parseMarkdownDocument(content: string): {
    frontmatterText: string;
    body: string;
    error: string | null;
} {
    const match = content.match(FRONTMATTER_PATTERN);
    if (!match) {
        return {
            frontmatterText: "",
            body: content,
            error: null,
        };
    }

    const text = match[1] ?? "";
    return {
        frontmatterText: text.trimEnd(),
        body: content.slice(match[0].length),
        error: parseFrontmatterText(text).error,
    };
}

function parseFrontmatterText(text: string): {
    frontmatter: Record<string, unknown>;
    error: string | null;
} {
    if (!text.trim()) {
        return {frontmatter: {}, error: null};
    }

    try {
        const parsed = YAML.parse(text, {logLevel: "silent"}) as unknown;
        if (parsed === null) {
            return {frontmatter: {}, error: null};
        }
        if (!isPlainObject(parsed)) {
            return {frontmatter: {}, error: t("ide.workspace.common.frontmatterObjectError")};
        }
        return {frontmatter: parsed, error: null};
    } catch (error) {
        return {
            frontmatter: {},
            error: error instanceof Error ? error.message : t("ide.workspace.common.frontmatterParseFailed"),
        };
    }
}

function renderMarkdownDocument(text: string, body: string): string {
    const parsed = parseFrontmatterText(text);
    if (parsed.error || Object.keys(parsed.frontmatter).length === 0) {
        return body;
    }
    return `---\n${text.trimEnd()}\n---\n\n${body}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 从 frontmatter 和文件节点生成 manuscript 表单草稿。
 */
function createManuscriptDraft(node: WorkspaceFileNode, frontmatter: Record<string, unknown>): ManuscriptFrontmatterDraft {
    return {
        title: readString(frontmatter.title, node.title || basename(node.path)),
        status: readString(frontmatter.status, ""),
        tags: readStringArray(frontmatter.tags),
        summary: readString(frontmatter.summary, node.summary),
    };
}

/**
 * 从未知 frontmatter 字段中读取字符串。
 */
function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

/**
 * 从未知 frontmatter 字段中读取字符串数组。
 */
function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * 返回路径最后一段名称。
 */
function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}
</script>

<template>
    <SideDetailPanel
        :visible="Boolean(props.node)"
        :height="props.height"
        body-class="overflow-x-hidden p-2"
        @update:height="emit('update:height', $event)"
        @close="emit('close')"
    >
        <template #header>
            <div class="min-w-0 overflow-hidden">
                <div class="truncate text-xs font-semibold text-[var(--text-main)]">{{ props.node?.title || props.node?.path || t("ide.workspace.fileDetail.title") }}</div>
                <div class="truncate text-[10px] text-[var(--text-muted)]">{{ props.node?.path }}</div>
            </div>
        </template>

        <template #actions>
            <button v-if="canCreateIndex" class="rounded-md px-2 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" type="button" @click="emit('create-index')">{{ t("ide.workspace.fileDetail.convert") }}</button>
            <button v-if="canConvertFileToDirectory" class="rounded-md px-2 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" type="button" @click="emit('convert-file-to-directory')">{{ t("ide.workspace.fileDetail.convertToDirectory") }}</button>
            <button v-if="isContentIndexFile" class="rounded-md px-2 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45" type="button" :disabled="isManuscriptIndexFile ? savingFile : (!isFrontmatterDirty || savingFile)" @click="isManuscriptIndexFile ? void saveManuscriptForm() : void saveFrontmatter()">{{ t("ide.workspace.common.save") }}</button>
        </template>

        <div v-if="props.node" class="grid min-w-0 gap-2 text-xs text-[var(--text-secondary)]">
            <!-- 文件详情基础信息 -->
            <div class="min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
                <div class="flex min-w-0 items-center justify-between gap-2">
                    <div class="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{{ props.node.isDirectory ? "Directory" : "File" }}</div>
                    <div class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ props.node.editable ? t("ide.workspace.fileDetail.editable") : t("ide.workspace.fileDetail.readonly") }}</div>
                </div>
                <div class="mt-1 max-w-full truncate font-mono text-[11px] text-[var(--text-main)]" :title="props.node.path">{{ props.node.path }}</div>
            </div>

            <div v-if="isContentDirectoryWithoutIndex" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2 text-[var(--status-warning)]">
                {{ t("ide.workspace.fileDetail.contentDirectoryWithoutIndex") }}
            </div>
            <div v-else-if="isDirectoryWithoutIndex" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[var(--text-muted)]">
                {{ t("ide.workspace.fileDetail.directoryWithoutIndex") }}
            </div>

            <div v-if="localFrontmatterError || props.node.frontmatterError" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 text-[var(--status-danger)]">
                {{ localFrontmatterError || props.node.frontmatterError }}
            </div>

            <!-- frontmatter 详情 -->
            <div v-if="isManuscriptIndexFile" class="min-w-0 space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2">
                <div class="flex items-center justify-between gap-2">
                    <div class="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Manuscript</div>
                    <div class="flex shrink-0 items-center gap-2">
                        <span v-if="manuscriptStats.updatedAt" class="text-[10px] text-[var(--text-muted)]">{{ manuscriptStats.updatedAt }}</span>
                        <span v-if="isFrontmatterDirty" class="text-[10px] text-[var(--status-warning)]">{{ t("ide.workspace.common.unsaved") }}</span>
                        <button type="button" class="rounded-md border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="refreshManuscriptStats">{{ t("ide.workspace.fileDetail.updateStats") }}</button>
                    </div>
                </div>
                <div class="grid grid-cols-5 gap-1.5">
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5">
                        <div class="text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{{ t("ide.workspace.fileDetail.current") }}</div>
                        <div class="mt-0.5 text-[var(--text-main)]">{{ manuscriptStats.currentWords }}</div>
                    </div>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5">
                        <div class="text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{{ t("ide.workspace.fileDetail.total") }}</div>
                        <div class="mt-0.5 text-[var(--text-main)]">{{ manuscriptStats.totalWords }}</div>
                    </div>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5">
                        <div class="text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{{ t("ide.workspace.fileDetail.size") }}</div>
                        <div class="mt-0.5 text-[var(--text-main)]">{{ manuscriptStats.totalSize }}</div>
                    </div>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5">
                        <div class="text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{{ t("ide.workspace.fileDetail.chapters") }}</div>
                        <div class="mt-0.5 text-[var(--text-main)]">{{ manuscriptStats.chapters }}</div>
                    </div>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5">
                        <div class="text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{{ t("ide.workspace.fileDetail.files") }}</div>
                        <div class="mt-0.5 text-[var(--text-main)]">{{ manuscriptStats.files }}</div>
                    </div>
                </div>
                <div class="grid grid-cols-[minmax(0,1fr)_132px] gap-2">
                    <div class="space-y-1">
                        <label class="text-[11px] font-medium text-[var(--text-secondary)]">{{ t("ide.workspace.common.title") }}</label>
                        <input v-model="manuscriptForm.title" class="h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" type="text" @blur="void saveManuscriptForm()">
                    </div>
                    <div class="space-y-1">
                        <label class="text-[11px] font-medium text-[var(--text-secondary)]">{{ t("ide.workspace.common.status") }}</label>
                        <FormSelect :model-value="manuscriptForm.status || 'draft'" :options="manuscriptStatusOptions" @update:model-value="manuscriptForm.status = $event; void saveManuscriptForm()" />
                    </div>
                </div>
                <div class="space-y-1">
                    <label class="text-[11px] font-medium text-[var(--text-secondary)]">{{ t("ide.workspace.common.tags") }}</label>
                    <TagInput :model-value="manuscriptForm.tags" :placeholder="t('ide.workspace.common.addTag')" accentStyle @update:model-value="manuscriptForm.tags = $event; void saveManuscriptForm()" />
                </div>
                <div class="space-y-1">
                    <label class="text-[11px] font-medium text-[var(--text-secondary)]">{{ t("ide.workspace.common.summary") }}</label>
                    <textarea v-model="manuscriptForm.summary" rows="3" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 text-xs leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" @blur="void saveManuscriptForm()"></textarea>
                </div>
            </div>

            <div v-else-if="isContentIndexFile || props.node.contentNode" class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2">
                <div class="flex items-center justify-between gap-2">
                    <div class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Frontmatter</div>
                    <span v-if="isContentIndexFile && isFrontmatterDirty" class="text-[10px] text-[var(--status-warning)]">{{ t("ide.workspace.common.unsaved") }}</span>
                </div>
                <div v-if="isContentIndexFile" class="flex items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5">
                    <div class="flex min-w-0 items-center gap-2">
                        <span :class="currentIconClass" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                        <span class="truncate text-[11px] text-[var(--text-secondary)]">{{ currentIconName || t("ide.workspace.fileDetail.noIcon") }}</span>
                    </div>
                    <button type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="iconPickerVisible = true">{{ t("ide.workspace.fileDetail.chooseIcon") }}</button>
                </div>
                <textarea
                    v-if="isContentIndexFile"
                    v-model="frontmatterText"
                    rows="10"
                    class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 font-mono text-[11px] leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]"
                    :placeholder="t('ide.workspace.fileDetail.frontmatterPlaceholder')"
                    :disabled="savingFile"
                ></textarea>
                <pre v-else class="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 font-mono text-[11px] leading-5 text-[var(--text-main)] custom-scrollbar">{{ readonlyFrontmatterText }}</pre>
            </div>

            <div v-if="props.node.summary" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 leading-5">
                {{ props.node.summary }}
            </div>

            <div v-if="hasRelatedIssues" class="space-y-2">
                <div class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{{ t("ide.workspace.fileDetail.validate") }}</div>
                <div v-for="issue in relatedIssues" :key="`${issue.code}:${issue.path}:${issue.message}`" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2 text-[var(--status-warning)]">
                    <div class="font-medium">[{{ issue.level }}] {{ issue.code }}</div>
                    <div class="mt-1 leading-5">{{ issue.message }}</div>
                </div>
            </div>
        </div>

        <LucideIconPickerDialog
            v-model="iconPickerVisible"
            :selected-icon="currentIconName"
            @select="applySelectedIcon"
        />
    </SideDetailPanel>
</template>
