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

const primaryAction = computed(() => quickActions.value[0] ?? null);
const secondaryQuickActions = computed(() => quickActions.value.slice(1));

const commonLocations = computed<WelcomeAction[]>(() => {
    if (!novelWorkspace.value) {
        return [
            {
                id: "assets-root",
                label: t("markdownStudio.welcome.userAssets"),
                description: "skills、profiles、templates",
                iconClass: "i-lucide-folder-cog",
                action: () => emit("open-files"),
            },
            {
                id: "assets-profile",
                label: "Profile",
                description: t("markdownStudio.welcome.profileWorkbenchTsxDescription"),
                iconClass: "i-lucide-file-code-2",
                action: () => emit("open-profile-workbench"),
            },
        ];
    }
    return [
        {
            id: "manuscript",
            label: "manuscript",
            description: t("markdownStudio.welcome.manuscriptDescription"),
            iconClass: "i-lucide-book-open-text",
            action: () => emit("open-path", "manuscript/"),
        },
        {
            id: "lorebook-root",
            label: "lorebook",
            description: t("markdownStudio.welcome.lorebookDescription"),
            iconClass: "i-lucide-library-big",
            action: () => emit("open-path", "lorebook/"),
        },
        {
            id: "manual",
            label: "manual",
            description: t("markdownStudio.welcome.docsDescription"),
            iconClass: "i-lucide-book-marked",
            action: () => emit("open-path", "manual/README.md"),
        },
        {
            id: "reference",
            label: "reference",
            description: t("markdownStudio.welcome.materialsDescription"),
            iconClass: "i-lucide-archive",
            action: () => emit("open-path", "reference/"),
        },
    ];
});

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
                <div class="flex min-w-0 items-start gap-4">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--accent-text)]">
                        <span :class="novelWorkspace ? 'i-lucide-pen-line' : 'i-lucide-folder-cog'" class="h-5 w-5"></span>
                    </div>
                    <div class="min-w-0">
                        <h1 class="text-2xl font-semibold text-[var(--text-main)]">{{ welcomeTitle }}</h1>
                        <p class="mt-1.5 max-w-[620px] text-sm leading-6 text-[var(--text-secondary)]">{{ welcomeDescription }}</p>
                    </div>
                </div>
                <div class="flex shrink-0 flex-wrap gap-2">
                    <button v-if="primaryAction" type="button" class="welcome-primary-action" @click="primaryAction.action">
                        <span :class="primaryAction.iconClass" class="h-4 w-4"></span>
                        <span>{{ primaryAction.label }}</span>
                    </button>
                    <button type="button" class="welcome-secondary-action" @click="emit('open-files')">
                        <span class="i-lucide-folder-tree h-4 w-4"></span>
                        <span>{{ t("markdownStudio.welcome.openFileTree") }}</span>
                    </button>
                </div>
            </header>

            <div class="studio-welcome-main">
                <div class="studio-welcome-primary-column">
                    <section class="welcome-section">
                        <h2 class="welcome-section-title">{{ t("markdownStudio.welcome.continueSection") }}</h2>
                        <div v-if="visibleTabs.length > 0" class="welcome-tab-list">
                            <button v-for="tab in visibleTabs" :key="tab.path" type="button" class="welcome-tab-row" :title="tab.path" @click="emit('select-tab', tab.path)">
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

                    <section v-if="secondaryQuickActions.length > 0" class="welcome-section">
                        <h2 class="welcome-section-title">{{ t("markdownStudio.welcome.startSection") }}</h2>
                        <div class="welcome-quick-grid">
                            <button v-for="action in secondaryQuickActions" :key="action.id" type="button" class="welcome-row" @click="action.action">
                                <span :class="action.iconClass" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                                <span class="min-w-0">
                                    <span class="block text-sm font-medium text-[var(--text-main)]">{{ action.label }}</span>
                                    <span class="mt-0.5 block text-xs leading-5 text-[var(--text-secondary)]">{{ action.description }}</span>
                                </span>
                            </button>
                        </div>
                    </section>
                </div>

                <aside class="studio-welcome-secondary-column">
                    <section class="welcome-agent-card">
                        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-text)]">
                            <span class="i-lucide-bot h-4 w-4"></span>
                        </div>
                        <div>
                            <h2 class="text-sm font-semibold text-[var(--text-main)]">{{ t("markdownStudio.welcome.agentGuideTitle") }}</h2>
                            <p class="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{{ t("markdownStudio.welcome.openAgentDescription") }}</p>
                        </div>
                        <button type="button" class="welcome-agent-button" @click="emit('open-agent-panel')">
                            <span class="i-lucide-panel-right-open h-4 w-4"></span>
                            <span>{{ t("markdownStudio.welcome.openAgent") }}</span>
                        </button>
                    </section>

                    <section class="welcome-section">
                        <h2 class="welcome-section-title">{{ t("markdownStudio.welcome.projectEntries") }}</h2>
                        <div class="welcome-location-list">
                            <button v-for="entry in commonLocations" :key="entry.id" type="button" class="welcome-location-row" @click="entry.action">
                                <span :class="entry.iconClass" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                                <span class="min-w-0 flex-1">
                                    <span class="block truncate text-sm font-medium text-[var(--text-main)]">{{ entry.label }}</span>
                                    <span class="block truncate text-xs text-[var(--text-secondary)]">{{ entry.description }}</span>
                                </span>
                            </button>
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    </section>
</template>

<style scoped>
.studio-welcome-root {
    container-type: inline-size;
}

.studio-welcome-container {
    max-width: 980px;
    gap: 1.25rem;
}

.studio-welcome-container.is-compact {
    max-width: 720px;
}

.studio-welcome-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0.5rem 0 1.25rem;
    border-bottom: 1px solid var(--border-color);
}

.studio-welcome-main {
    display: grid;
    min-height: 0;
    gap: 1.25rem;
    grid-template-columns: minmax(0, 1fr) 300px;
}

.studio-welcome-primary-column,
.studio-welcome-secondary-column,
.welcome-section {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.75rem;
}

.studio-welcome-primary-column,
.studio-welcome-secondary-column {
    gap: 1.1rem;
}

.welcome-section-title {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.welcome-primary-action,
.welcome-secondary-action,
.welcome-agent-button {
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
.welcome-location-row:hover,
.welcome-empty-row:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
}

.welcome-quick-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.welcome-row,
.welcome-tab-row,
.welcome-location-row,
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

.welcome-tab-list,
.welcome-location-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.welcome-tab-row {
    min-height: 46px;
    padding: 0.5rem 0.75rem;
}

.welcome-location-row {
    min-height: 46px;
    padding: 0.45rem 0.65rem;
}

.welcome-empty-row {
    min-height: 46px;
    padding: 0.6rem 0.75rem;
    border-style: dashed;
    font-size: 12px;
}

.welcome-agent-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 10px;
}

.welcome-agent-button {
    align-self: flex-start;
    color: var(--accent-text);
    background: var(--accent-bg);
    border: 1px solid var(--accent-main);
}

.welcome-agent-button:hover {
    background: var(--bg-hover);
}

@container (max-width: 760px) {
    .studio-welcome-hero {
        align-items: flex-start;
        flex-direction: column;
        gap: 1rem;
    }

    .studio-welcome-main {
        grid-template-columns: 1fr;
    }
}

@container (max-width: 520px) {
    .welcome-quick-grid {
        grid-template-columns: 1fr;
    }
}
</style>
