<script setup lang="ts">
import type {WorkspaceEditorTab, WorkspaceFileNode} from "nbook/app/stores/novel-ide";

type WorkspaceMode = "novel" | "user-assets";

type WelcomeAction = Readonly<{
    id: string;
    label: string;
    description: string;
    iconClass: string;
    action: () => void;
}>;

const props = withDefaults(defineProps<{
    node: WorkspaceFileNode | null;
    tabs?: WorkspaceEditorTab[];
    compact?: boolean;
    workspaceMode?: WorkspaceMode;
}>(), {
    tabs: () => [],
    compact: false,
    workspaceMode: "novel",
});

const emit = defineEmits<{
    (event: "select-tab", path: string): void;
    (event: "open-path", path: string): void;
    (event: "open-files"): void;
    (event: "create-chapter"): void;
    (event: "create-markdown-file"): void;
    (event: "create-lorebook-entry"): void;
    (event: "open-agent-panel"): void;
    (event: "open-profile-workbench"): void;
}>();

const {t} = useI18n();
const readonlyNode = computed(() => props.node !== null && !props.node.editable);
const visibleTabs = computed(() => props.tabs.slice(0, props.compact ? 3 : 4));
const novelWorkspace = computed(() => props.workspaceMode === "novel");
const welcomeTitle = computed(() => novelWorkspace.value
    ? t("markdownStudio.welcome.startTitle")
    : t("markdownStudio.welcome.viewAssets"));
const welcomeDescription = computed(() => novelWorkspace.value
    ? t("markdownStudio.welcome.startDescription")
    : t("markdownStudio.welcome.viewAssetsDescription"));

const quickActions = computed<WelcomeAction[]>(() => {
    if (!novelWorkspace.value) {
        return [
            {
                id: "assets-files",
                label: t("markdownStudio.welcome.viewAssets"),
                description: t("markdownStudio.welcome.viewAssetsDescription"),
                iconClass: "i-lucide-folder-tree",
                action: () => emit("open-files"),
            },
            {
                id: "profile-workbench",
                label: t("markdownStudio.welcome.profileWorkbench"),
                description: t("markdownStudio.welcome.profileWorkbenchDescription"),
                iconClass: "i-lucide-file-code-2",
                action: () => emit("open-profile-workbench"),
            },
        ];
    }
    return [
        {
            id: "chapter",
            label: t("markdownStudio.welcome.newChapter"),
            description: t("markdownStudio.welcome.newChapterDescription"),
            iconClass: "i-lucide-pen-line",
            action: () => emit("create-chapter"),
        },
        {
            id: "lorebook",
            label: t("markdownStudio.welcome.newLorebook"),
            description: t("markdownStudio.welcome.newLorebookDescription"),
            iconClass: "i-lucide-book-plus",
            action: () => emit("create-lorebook-entry"),
        },
        {
            id: "markdown",
            label: t("markdownStudio.welcome.newMarkdown"),
            description: t("markdownStudio.welcome.newMarkdownDescription"),
            iconClass: "i-lucide-file-plus-2",
            action: () => emit("create-markdown-file"),
        },
    ];
});

const primaryAction = computed<WelcomeAction | null>(() => {
    const recent = visibleTabs.value[0];
    if (novelWorkspace.value && recent) {
        return {
            id: "continue",
            label: recent.title,
            description: recent.path,
            iconClass: tabIconClass(recent),
            action: () => emit("select-tab", recent.path),
        };
    }
    return quickActions.value[0] ?? null;
});
const secondaryQuickActions = computed(() => quickActions.value.filter((action) => action.id !== primaryAction.value?.id));

function tabIconClass(tab: WorkspaceEditorTab): string {
    if (tab.editorKind === "markdown") return "i-lucide-file-text";
    if (tab.editorKind === "monaco") return "i-lucide-file-code-2";
    return "i-lucide-file-question";
}
</script>

<template>
    <section class="studio-welcome-root min-h-0 flex-1 overflow-y-auto bg-[var(--editor-bg)] px-6 py-5 custom-scrollbar">
        <div v-if="readonlyNode" class="studio-welcome-container mx-auto flex w-full max-w-[720px] flex-col gap-5">
            <div class="flex items-start gap-4 border-b border-[var(--border-color)] pb-5">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--accent-text)]">
                    <span class="i-lucide-lock-keyhole h-5 w-5"></span>
                </div>
                <div class="min-w-0 flex-1">
                    <h1 class="text-lg font-semibold text-[var(--text-main)]">{{ t("markdownStudio.welcome.uneditableTitle") }}</h1>
                    <p class="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{{ t("markdownStudio.welcome.uneditableDescription") }}</p>
                </div>
            </div>

            <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3 text-xs text-[var(--text-secondary)]">
                <div class="truncate font-mono text-[var(--text-main)]" :title="props.node?.path">{{ props.node?.path }}</div>
                <div class="mt-2 flex flex-wrap gap-2">
                    <span class="rounded-md border border-[var(--border-color)] px-2 py-1">editable: false</span>
                    <span class="rounded-md border border-[var(--border-color)] px-2 py-1">type: {{ props.node?.entryType || "-" }}</span>
                    <span class="rounded-md border border-[var(--border-color)] px-2 py-1">{{ props.node?.isDirectory ? "directory" : "file" }}</span>
                </div>
            </div>

            <button type="button" class="welcome-row" @click="emit('open-files')">
                <span class="i-lucide-folder-tree h-5 w-5 shrink-0 text-[var(--accent-text)]"></span>
                <span class="min-w-0">
                    <span class="block text-sm font-medium text-[var(--text-main)]">{{ t("markdownStudio.welcome.openFileTree") }}</span>
                    <span class="block truncate text-xs text-[var(--text-secondary)]">{{ t("markdownStudio.welcome.locateNodeDescription") }}</span>
                </span>
            </button>
        </div>

        <div v-else class="studio-welcome-container mx-auto flex w-full flex-col" :class="{ 'is-compact': props.compact }">
            <header class="studio-welcome-hero">
                <div class="min-w-0">
                    <div class="welcome-eyebrow">
                        <span :class="novelWorkspace ? 'i-lucide-pen-line' : 'i-lucide-folder-cog'" class="h-4 w-4"></span>
                        <span>MARKDOWN STUDIO</span>
                    </div>
                    <h1 class="mt-2 text-2xl font-semibold text-[var(--text-main)]">{{ welcomeTitle }}</h1>
                    <p class="mt-1.5 max-w-[680px] text-sm leading-6 text-[var(--text-secondary)]">{{ welcomeDescription }}</p>
                </div>
                <div class="welcome-hero-actions">
                    <button v-if="primaryAction" type="button" class="welcome-primary-action" :title="primaryAction.description" @click="primaryAction.action">
                        <span :class="primaryAction.iconClass" class="h-4 w-4"></span>
                        <span class="max-w-[190px] truncate">{{ primaryAction.label }}</span>
                    </button>
                    <button type="button" class="welcome-secondary-action" @click="emit('open-files')">
                        <span class="i-lucide-folder-tree h-4 w-4"></span>
                        <span>{{ t("markdownStudio.welcome.openFileTree") }}</span>
                    </button>
                </div>
            </header>

            <div class="welcome-action-grid">
                <button v-for="action in secondaryQuickActions" :key="action.id" type="button" class="welcome-action-card" @click="action.action">
                    <span :class="action.iconClass" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                    <span class="min-w-0">
                        <span class="block truncate text-sm font-medium text-[var(--text-main)]">{{ action.label }}</span>
                        <span class="mt-0.5 block truncate text-xs text-[var(--text-secondary)]">{{ action.description }}</span>
                    </span>
                </button>
                <button v-if="novelWorkspace" type="button" class="welcome-action-card" @click="emit('open-agent-panel')">
                    <span class="i-lucide-panel-right-open h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                    <span class="min-w-0">
                        <span class="block truncate text-sm font-medium text-[var(--text-main)]">{{ t("markdownStudio.welcome.openAgent") }}</span>
                        <span class="mt-0.5 block truncate text-xs text-[var(--text-secondary)]">{{ t("markdownStudio.welcome.openAgentDescription") }}</span>
                    </span>
                </button>
            </div>

            <section class="welcome-recent-section">
                <div class="welcome-section-heading">
                    <h2 class="welcome-section-title">{{ t("markdownStudio.welcome.continueSection") }}</h2>
                    <span v-if="visibleTabs.length > 0" class="welcome-section-hint">{{ visibleTabs.length }} / 5</span>
                </div>
                <div v-if="visibleTabs.length > 0" class="welcome-tab-list">
                    <button v-for="tab in visibleTabs.slice(0, 5)" :key="tab.path" type="button" class="welcome-tab-row" :title="tab.path" @click="emit('select-tab', tab.path)">
                        <span :class="tabIconClass(tab)" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium text-[var(--text-main)]" :class="tab.preview ? 'italic' : ''">{{ tab.title }}</span>
                            <span class="block truncate text-xs text-[var(--text-secondary)]">{{ tab.path }}</span>
                        </span>
                        <span v-if="tab.dirty" class="h-2 w-2 shrink-0 rounded-full bg-[var(--status-warning)]"></span>
                    </button>
                </div>
                <button v-else type="button" class="welcome-empty-row" @click="novelWorkspace ? emit('open-path', 'manuscript/') : emit('open-files')">
                    <span class="i-lucide-arrow-right h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                    <span>{{ t("markdownStudio.welcome.noOpenFiles") }}</span>
                </button>
            </section>
        </div>
    </section>
</template>

<style scoped>
.studio-welcome-root {
    container-type: inline-size;
}

.studio-welcome-container {
    max-width: 820px;
    gap: 1rem;
}

.studio-welcome-container.is-compact {
    max-width: 720px;
}

.studio-welcome-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.25rem 0 1rem;
    border-bottom: 1px solid var(--border-color);
}

.welcome-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--accent-text);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
}

.welcome-hero-actions {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
}

.welcome-action-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.welcome-action-card {
    display: flex;
    min-width: 0;
    min-height: 58px;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem;
    color: var(--text-secondary);
    text-align: left;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    transition: background-color 160ms ease, border-color 160ms ease;
}

.welcome-action-card:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
}

.welcome-recent-section {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.65rem;
}

.welcome-section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
}

.welcome-section-title {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.welcome-primary-action,
.welcome-secondary-action {
    display: inline-flex;
    height: 34px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}

.welcome-primary-action {
    color: var(--text-inverse);
    background: var(--accent-main);
}

.welcome-primary-action:hover {
    opacity: 0.92;
}

.welcome-secondary-action {
    color: var(--text-main);
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
}

.welcome-secondary-action:hover,
.welcome-row:hover,
.welcome-tab-row:hover,
.welcome-empty-row:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
}

.welcome-row,
.welcome-tab-row,
.welcome-empty-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-secondary);
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    text-align: left;
    transition: background-color 160ms ease, border-color 160ms ease;
}

.welcome-row {
    min-height: 62px;
    padding: 0.75rem;
}

.welcome-tab-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.welcome-tab-row {
    min-height: 46px;
    padding: 0.5rem 0.75rem;
}

.welcome-empty-row {
    min-height: 46px;
    padding: 0.6rem 0.75rem;
    border-style: dashed;
    font-size: 12px;
}

.welcome-section-hint {
    color: var(--text-muted);
    font-size: 11px;
}

@container (max-width: 760px) {
    .studio-welcome-hero {
        align-items: flex-start;
        flex-direction: column;
    }

    .welcome-hero-actions {
        justify-content: flex-start;
    }
}

@container (max-width: 520px) {
    .welcome-action-grid {
        grid-template-columns: 1fr;
    }
}
</style>
