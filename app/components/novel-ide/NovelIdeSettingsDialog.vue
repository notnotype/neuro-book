<script setup lang="ts">
import {storeToRefs} from "pinia";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import NovelIdeAgentProfileModelSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue";
import NovelIdeCostSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeCostSettingsPanel.vue";
import NovelIdeEmbeddingSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeEmbeddingSettingsPanel.vue";
import ThemeEditorDialog from "nbook/app/components/novel-ide/settings/theme/ThemeEditorDialog.vue";
import NovelIdeModelSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue";
import NovelIdeObservabilitySettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeObservabilitySettingsPanel.vue";
import NovelIdeWebSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeWebSettingsPanel.vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useNotification} from "nbook/app/composables/useNotification";
import {useAuthSessionState} from "nbook/app/composables/useAuthSessionState";
import {useThemeManager} from "nbook/app/composables/useThemeManager";
import {ideThemeIds, themeMeta, type ThemeVars} from "nbook/app/utils/theme/theme-tokens";
import {resolveTheme, isBuiltInThemeId} from "nbook/app/utils/theme/resolve-theme";
import {createCustomThemeId, themeVarsToCustomVars} from "nbook/app/utils/theme/theme-editor";
import {downloadThemeJson, parseThemeJson} from "nbook/app/utils/theme/theme-io";
import type {MarkdownStudioViewMode} from "nbook/app/composables/useMarkdownStudioController";
import type {CustomThemeDto, ThemeAppearance} from "nbook/shared/theme/theme-vars";
import {DEFAULT_DESKTOP_SETTINGS, type DesktopCloseBehavior, type DesktopSettings, type DesktopStatus} from "nbook/shared/desktop-contract";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, DEFAULT_MONACO_EDITOR_PREFERENCES, type MarkdownEditorPreferences, type MonacoEditorPreferences} from "nbook/shared/editor-workbench";

type SettingsSection = "security" | "frontend" | "editor" | "models" | "embedding" | "cost" | "web-tools" | "agent-profile-models" | "observability" | "desktop";
type SettingsScope = "boot" | "global" | "project" | "browser";
type AppVersionKind = "release" | "tag" | "commit" | "package";
type ThemeEditorMode = "create" | "edit" | "copy";

interface AppVersionDto {
    versionLabel: string;
    versionKind: AppVersionKind;
    githubUrl: string;
}

type SettingsSavePanelExpose = {
    readonly dirty: boolean;
    readonly loading: boolean;
    readonly saving: boolean;
    saveSettings: () => Promise<void>;
    restoreSettings: () => Promise<void>;
};

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const novelIdeStore = useNovelIdeStore();
const notification = useNotification();
const authSessionState = useAuthSessionState();
const themeManager = useThemeManager();
const {locale, setLocale, t} = useI18n();
const {
    selectedReasoning,
    activeThemeId,
    customThemes,
    viewMode,
    markdownEditorPreferences,
    monacoEditorPreferences,
} = storeToRefs(novelIdeStore);

const activeSection = ref<SettingsSection>("models");
const activeScope = ref<SettingsScope>("global");
const appVersion = ref<AppVersionDto | null>(null);
const appVersionPending = ref(false);
const modelSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const embeddingSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const costSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const webSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const agentProfileModelSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const observabilitySettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const desktopSettings = ref<DesktopSettings>({...DEFAULT_DESKTOP_SETTINGS});
const desktopStatus = ref<DesktopStatus | null>(null);
const themeEditorOpen = ref(false);
const themeEditorMode = ref<ThemeEditorMode>("create");
const themeEditorInitialTheme = ref<CustomThemeDto | null>(null);
const themeDeleteTarget = ref<CustomThemeDto | null>(null);
const themeImportInputRef = ref<HTMLInputElement | null>(null);

const frontendSectionItems = computed<Array<{value: SettingsSection; label: string; description: string; iconClass: string}>>(() => [
    {
        value: "security",
        label: t("settings.section.security.label"),
        description: t("settings.section.security.description"),
        iconClass: "i-lucide-shield-check",
    },
    {
        value: "frontend",
        label: t("settings.section.frontend.label"),
        description: t("settings.section.frontend.description"),
        iconClass: "i-lucide-monitor-cog",
    },
    {
        value: "editor",
        label: t("settings.section.editor.label"),
        description: t("settings.section.editor.description"),
        iconClass: "i-lucide-type",
    },
    {
        value: "models",
        label: t("settings.section.models.label"),
        description: t("settings.section.models.description"),
        iconClass: "i-lucide-cpu",
    },
    {
        value: "embedding",
        label: "Embedding",
        description: t("settings.section.embedding.description"),
        iconClass: "i-lucide-binary",
    },
    {
        value: "cost",
        label: t("settings.section.cost.label"),
        description: t("settings.section.cost.description"),
        iconClass: "i-lucide-circle-dollar-sign",
    },
    {
        value: "web-tools",
        label: t("settings.section.webTools.label"),
        description: t("settings.section.webTools.description"),
        iconClass: "i-lucide-search-code",
    },
    {
        value: "agent-profile-models",
        label: t("settings.section.agentProfileModels.label"),
        description: t("settings.section.agentProfileModels.description"),
        iconClass: "i-lucide-bot-message-square",
    },
    {
        value: "observability",
        label: t("settings.section.observability.label"),
        description: t("settings.section.observability.description"),
        iconClass: "i-lucide-activity",
    },
    {
        value: "desktop",
        label: t("settings.section.desktop.label"),
        description: t("settings.section.desktop.description"),
        iconClass: "i-lucide-panels-top-left",
    },
]);

const scopeOptions = computed<Array<{value: SettingsScope; label: string; description: string; iconClass: string}>>(() => [
    {
        value: "boot",
        label: t("settings.scope.boot.label"),
        description: t("settings.scope.boot.description"),
        iconClass: "i-lucide-server-cog",
    },
    {
        value: "global",
        label: t("settings.scope.global.label"),
        description: t("settings.scope.global.description"),
        iconClass: "i-lucide-globe-2",
    },
    {
        value: "project",
        label: t("settings.scope.project.label"),
        description: t("settings.scope.project.description"),
        iconClass: "i-lucide-folder-cog",
    },
    {
        value: "browser",
        label: t("settings.scope.browser.label"),
        description: t("settings.scope.browser.description"),
        iconClass: "i-lucide-monitor",
    },
]);

const globalConfigSections: SettingsSection[] = ["models", "embedding", "cost", "web-tools", "agent-profile-models", "observability"];
const projectConfigSections: SettingsSection[] = ["agent-profile-models"];
const browserSections: SettingsSection[] = ["frontend", "editor", "desktop"];
const bootConfigSections: SettingsSection[] = ["security"];
const desktopBridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
const desktopAvailable = computed(() => Boolean(desktopBridge.value));
const projectScopeAvailable = computed(() => novelIdeStore.workspaceKind !== "user-assets"
    && Boolean(novelIdeStore.currentProjectRoot));

/** 主题卡片渲染数据：迷你预览用该主题自己的变量绘制 */
type ThemeCard = {
    id: string;
    name: string;
    appearance: ThemeAppearance;
    vars: ThemeVars;
    /** 非空表示自定义主题，携带可编辑的原始 DTO */
    custom: CustomThemeDto | null;
};

const builtInThemeCards = computed<ThemeCard[]>(() => ideThemeIds.map((themeId) => ({
    id: themeId,
    name: themeMeta[themeId].label,
    appearance: themeMeta[themeId].appearance,
    vars: resolveTheme(themeId, customThemes.value).vars,
    custom: null,
})));
const customThemeCards = computed<ThemeCard[]>(() => customThemes.value.map((customTheme) => ({
    id: customTheme.id,
    name: customTheme.name,
    appearance: customTheme.appearance,
    vars: resolveTheme(customTheme.id, customThemes.value).vars,
    custom: customTheme,
})));
const activeResolvedTheme = computed(() => resolveTheme(activeThemeId.value, customThemes.value));
const activeThemeIsBuiltIn = computed(() => isBuiltInThemeId(activeResolvedTheme.value.id));
const bootAuthEnabled = computed(() => authSessionState.session.value?.authEnabled ?? null);
const bootAuthExample = computed(() => `auth:\n    enabled: ${bootAuthEnabled.value === null ? "<true|false>" : String(bootAuthEnabled.value)}`);

const viewModeOptions = computed<SelectOption[]>(() => [
    {value: "rich", label: t("settings.frontend.viewModeRich")},
    {value: "source", label: t("settings.frontend.viewModeSource")},
]);

const localeOptions = computed<SelectOption[]>(() => [
    {
        value: "zh-CN",
        label: t("settings.frontend.simplifiedChinese"),
        description: t("settings.frontend.simplifiedChineseDescription"),
        iconClass: "i-lucide-languages",
    },
    {
        value: "en-US",
        label: t("settings.frontend.english"),
        description: t("settings.frontend.englishDescription"),
        iconClass: "i-lucide-languages",
    },
]);

const editorFontOptions = computed<SelectOption[]>(() => [
    {
        value: "\"Source Han Serif SC\", \"Noto Serif SC\", \"Songti SC\", serif",
        label: t("settings.editor.fontChineseSerif"),
    },
    {
        value: "\"Microsoft YaHei\", \"Noto Sans SC\", sans-serif",
        label: t("settings.editor.fontChineseSans"),
    },
    {
        value: "\"LXGW WenKai\", \"KaiTi\", \"STKaiti\", serif",
        label: t("settings.editor.fontChineseKai"),
    },
    {
        value: "ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
        label: t("settings.editor.fontSystemSans"),
    },
    {
        value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        label: t("settings.editor.fontMonospace"),
    },
]);

const monacoFontOptions = computed<SelectOption[]>(() => [
    {
        value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
        label: t("settings.editor.fontSystemMonospace"),
    },
    {
        value: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        label: "JetBrains Mono",
    },
    {
        value: "Cascadia Code, Consolas, ui-monospace, monospace",
        label: "Cascadia Code",
    },
    {
        value: "Fira Code, ui-monospace, Menlo, Monaco, Consolas, monospace",
        label: "Fira Code",
    },
]);

const targetQuery = computed(() => activeScope.value === "project" && novelIdeStore.currentProjectRoot
    ? {workspaceKind: "novel" as const, projectRoot: novelIdeStore.currentProjectRoot}
    : {workspaceKind: "user-assets" as const});
const settingsPanelKey = computed(() => `${activeScope.value}:${targetQuery.value.workspaceKind}:${targetQuery.value.projectRoot ?? "global"}`);
const targetLabel = computed(() => activeScope.value === "project"
    ? novelIdeStore.currentNovel?.title || novelIdeStore.currentProjectRoot || "Project Workspace"
    : activeScope.value === "boot" ? "config.yaml" : "Workspace Root");
const visibleSectionItems = computed(() => {
    const allowed = activeScope.value === "boot"
        ? bootConfigSections
        : activeScope.value === "browser"
        ? browserSections
        : activeScope.value === "project"
            ? projectConfigSections
            : globalConfigSections;
    return frontendSectionItems.value.filter((item) => allowed.includes(item.value) && (item.value !== "desktop" || desktopAvailable.value));
});

const versionLabel = computed(() => {
    if (appVersionPending.value && !appVersion.value) {
        return t("settings.version.loading");
    }
    if (!appVersion.value) {
        return t("settings.version.unavailable");
    }
    if (appVersion.value.versionKind === "commit") {
        return t("settings.version.commit", {version: appVersion.value.versionLabel});
    }
    if (appVersion.value.versionKind === "release") {
        return t("settings.version.release", {version: appVersion.value.versionLabel});
    }
    return t("settings.version.generic", {version: appVersion.value.versionLabel});
});

const activeSavePanel = computed<SettingsSavePanelExpose | null>(() => {
    switch (activeSection.value) {
        case "models":
            return modelSettingsPanelRef.value;
        case "embedding":
            return embeddingSettingsPanelRef.value;
        case "cost":
            return costSettingsPanelRef.value;
        case "web-tools":
            return webSettingsPanelRef.value;
        case "agent-profile-models":
            return agentProfileModelSettingsPanelRef.value;
        case "observability":
            return observabilitySettingsPanelRef.value;
        case "frontend":
        case "editor":
        case "security":
        case "desktop":
            return null;
    }
});
const activeSaveDirty = computed(() => activeSavePanel.value?.dirty ?? false);
const activeSaveLoading = computed(() => activeSavePanel.value?.loading ?? false);
const activeSaveSaving = computed(() => activeSavePanel.value?.saving ?? false);
const showHeaderSaveButton = computed(() => activeSavePanel.value !== null);
const activeSaveDisabled = computed(() => activeSaveLoading.value || activeSaveSaving.value || !activeSaveDirty.value);
const activeRestoreDisabled = computed(() => activeSaveLoading.value || activeSaveSaving.value || !activeSaveDirty.value);

/**
 * 读取当前配置目标允许显示的设置分区。
 */
function sectionsForScope(scope: SettingsScope): SettingsSection[] {
    if (scope === "boot") {
        return bootConfigSections;
    }
    if (scope === "browser") {
        return browserSections;
    }
    if (scope === "project") {
        return projectConfigSections;
    }
    return globalConfigSections;
}

/**
 * 保证右侧内容分区与左侧配置目标一致。
 */
function alignActiveSectionToScope(): void {
    const allowed = sectionsForScope(activeScope.value);
    if (!allowed.includes(activeSection.value)) {
        activeSection.value = allowed[0] ?? "frontend";
    }
}

/**
 * 保存当前激活的配置面板。
 */
async function saveActivePanel(): Promise<void> {
    const panel = activeSavePanel.value;
    if (!panel || panel.loading || panel.saving || !panel.dirty) {
        return;
    }
    await panel.saveSettings();
}

/**
 * 从已保存配置重新读取当前面板，丢弃本地草稿。
 */
async function restoreActivePanel(): Promise<void> {
    const panel = activeSavePanel.value;
    if (!panel || panel.loading || panel.saving || !panel.dirty) {
        return;
    }
    await panel.restoreSettings();
}

/**
 * 设置页允许直接离开 dirty 草稿；只在加载或保存中阻止切换。
 */
function canLeaveCurrentPanel(): boolean {
    if (activeSaveLoading.value || activeSaveSaving.value) {
        notification.info(activeSaveSaving.value ? t("settings.feedback.saving") : t("settings.feedback.loading"));
        return false;
    }
    return true;
}

/**
 * 选择设置页配置目标，不改变当前 IDE 打开的小说。
 */
function selectScope(scope: SettingsScope): void {
    if (scope === activeScope.value) {
        return;
    }
    if (!canLeaveCurrentPanel()) {
        return;
    }
    if (scope === "project" && !projectScopeAvailable.value) {
        notification.info(t("settings.scope.project.unavailable"));
        activeScope.value = "global";
        activeSection.value = "models";
        return;
    }
    activeScope.value = scope;
    activeSection.value = scope === "boot" ? "security" : scope === "browser" ? "frontend" : "models";
    alignActiveSectionToScope();
}

/**
 * 选择配置分区；dirty 草稿会随面板切换自然丢弃。
 */
function selectSection(section: SettingsSection): void {
    if (section === activeSection.value) {
        return;
    }
    if (!canLeaveCurrentPanel()) {
        return;
    }
    activeSection.value = section;
}

/**
 * 更新 Markdown 编辑器显示偏好。
 */
function updateEditorPreferences(patch: Partial<MarkdownEditorPreferences>): void {
    markdownEditorPreferences.value = {
        ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
        ...markdownEditorPreferences.value,
        ...patch,
    };
}

/**
 * 读取数值输入并限制到指定范围。
 */
function updateEditorNumber(key: keyof Pick<MarkdownEditorPreferences, "fontSize" | "lineHeight" | "contentWidth" | "paragraphIndentEm">, value: string, min: number, max: number): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    updateEditorPreferences({
        [key]: Math.min(Math.max(parsed, min), max),
    });
}

/**
 * 重置 Markdown 编辑器显示偏好。
 */
function resetEditorPreferences(): void {
    markdownEditorPreferences.value = {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
}

/**
 * 更新 Monaco 源码编辑器显示偏好。
 */
function updateMonacoPreferences(patch: Partial<MonacoEditorPreferences>): void {
    monacoEditorPreferences.value = {
        ...DEFAULT_MONACO_EDITOR_PREFERENCES,
        ...monacoEditorPreferences.value,
        ...patch,
    };
}

/**
 * 读取 Monaco 数值输入并限制到指定范围。
 */
function updateMonacoNumber(key: keyof Pick<MonacoEditorPreferences, "fontSize" | "lineHeight" | "tabSize">, value: string, min: number, max: number): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    updateMonacoPreferences({
        [key]: Math.min(Math.max(parsed, min), max),
    });
}

/**
 * 重置 Monaco 源码编辑器显示偏好。
 */
function resetMonacoPreferences(): void {
    monacoEditorPreferences.value = {...DEFAULT_MONACO_EDITOR_PREFERENCES};
}

/**
 * 关闭设定弹窗。
 */
function closeDialog(): void {
    if (!canLeaveCurrentPanel()) {
        return;
    }
    emit("update:modelValue", false);
}

/**
 * 处理主题选择。
 */
function updateTheme(value: string): void {
    void themeManager.setTheme(value);
}

/**
 * 克隆自定义主题，避免 Dialog 草稿直接改写 store 引用。
 */
function cloneCustomTheme(theme: CustomThemeDto): CustomThemeDto {
    return {
        id: theme.id,
        name: theme.name,
        appearance: theme.appearance,
        vars: {...theme.vars},
    };
}

/**
 * 基于指定主题创建编辑器初始草稿（新建/复制的起点）。
 */
function createThemeDraftFrom(sourceThemeId: string, mode: Exclude<ThemeEditorMode, "edit">): CustomThemeDto {
    const resolvedTheme = resolveTheme(sourceThemeId, customThemes.value);
    const name = mode === "copy"
        ? t("settings.frontend.themeCopyName", {name: resolvedTheme.label})
        : t("settings.frontend.themeNewName", {name: resolvedTheme.label});
    return {
        id: createCustomThemeId(name, customThemes.value),
        name,
        appearance: resolvedTheme.appearance,
        vars: themeVarsToCustomVars(resolvedTheme.vars),
    };
}

/**
 * 打开新建主题编辑器（以当前主题为起点）。
 */
function openThemeCreator(): void {
    themeEditorMode.value = "create";
    themeEditorInitialTheme.value = createThemeDraftFrom(activeThemeId.value, "create");
    themeEditorOpen.value = true;
}

/**
 * 复制指定主题为自定义主题并打开编辑器。
 */
function openThemeCopier(sourceThemeId: string): void {
    themeEditorMode.value = "copy";
    themeEditorInitialTheme.value = createThemeDraftFrom(sourceThemeId, "copy");
    themeEditorOpen.value = true;
}

/**
 * 打开指定自定义主题的编辑器。
 */
function openThemeEditor(theme: CustomThemeDto): void {
    themeEditorMode.value = "edit";
    themeEditorInitialTheme.value = cloneCustomTheme(theme);
    themeEditorOpen.value = true;
}

/**
 * 主题编辑器保存成功后的反馈。
 */
function handleThemeSaved(theme: CustomThemeDto): void {
    notification.success(t("settings.frontend.themeSaved", {name: theme.name}));
}

/**
 * 主题编辑器是浮动窗口：打开时收起设置对话框让用户看到真实页面，
 * 关闭后恢复设置对话框继续操作。
 */
const resumeSettingsAfterThemeEditor = ref(false);
watch(themeEditorOpen, (open) => {
    if (open) {
        if (props.modelValue) {
            resumeSettingsAfterThemeEditor.value = true;
            emit("update:modelValue", false);
        }
        return;
    }
    if (resumeSettingsAfterThemeEditor.value) {
        resumeSettingsAfterThemeEditor.value = false;
        emit("update:modelValue", true);
    }
});

/**
 * 请求删除指定自定义主题。
 */
function requestDeleteTheme(theme: CustomThemeDto): void {
    themeDeleteTarget.value = cloneCustomTheme(theme);
}

/**
 * 删除确认后保存新主题列表；若删掉当前主题则回退 Sepia。
 */
async function confirmDeleteTheme(): Promise<void> {
    const target = themeDeleteTarget.value;
    if (!target) {
        return;
    }
    const nextThemes = customThemes.value.filter((theme) => theme.id !== target.id);
    const nextThemeId = activeThemeId.value === target.id ? "sepia" : activeThemeId.value;
    const saved = await themeManager.saveThemeConfig(nextThemeId, nextThemes);
    if (!saved) {
        return;
    }
    themeDeleteTarget.value = null;
    notification.success(t("settings.frontend.themeDeleted", {name: target.name}));
}

/**
 * 导出指定主题为 JSON 文件；内置主题会先转成具体变量。
 */
function exportTheme(themeId: string): void {
    const resolvedTheme = resolveTheme(themeId, customThemes.value);
    downloadThemeJson({
        name: resolvedTheme.label,
        appearance: resolvedTheme.appearance,
        vars: themeVarsToCustomVars(resolvedTheme.vars),
    }, `${themeFileSlug(resolvedTheme.label)}.json`);
    notification.success(t("settings.frontend.themeExported", {name: resolvedTheme.label}));
}

/**
 * 打开主题 JSON 文件选择器。
 */
function triggerThemeImport(): void {
    themeImportInputRef.value?.click();
}

/**
 * 导入主题 JSON 并保存为新的自定义主题。
 */
async function importThemeFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) {
        return;
    }

    try {
        const parsed = parseThemeJson(await file.text());
        if (!parsed.ok) {
            notification.error(parsed.message, {title: t("settings.frontend.themeImportFailed")});
            return;
        }
        const importedTheme: CustomThemeDto = {
            id: createCustomThemeId(parsed.theme.name, customThemes.value),
            name: parsed.theme.name,
            appearance: parsed.theme.appearance,
            vars: parsed.theme.vars,
        };
        const saved = await themeManager.saveThemeConfig(importedTheme.id, [...customThemes.value, importedTheme]);
        if (saved) {
            notification.success(t("settings.frontend.themeImported", {name: importedTheme.name}));
        }
    } catch (error) {
        notification.error(error instanceof Error ? error.message : t("settings.frontend.themeImportFailed"), {title: t("settings.frontend.themeImportFailed")});
    }
}

/**
 * 把主题名转换为稳定文件名片段。
 */
function themeFileSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || "theme";
}

/**
 * 处理界面语言选择。
 */
function updateLocale(value: string): void {
    if (value === "zh-CN" || value === "en-US") {
        void setLocale(value);
    }
}

/**
 * 处理默认视图模式选择。
 */
function updateViewMode(value: string): void {
    if (value === "rich" || value === "source") {
        viewMode.value = value as MarkdownStudioViewMode;
    }
}

/**
 * 读取设置页底部展示的应用版本信息。
 */
async function loadAppVersion(): Promise<void> {
    if (appVersion.value || appVersionPending.value) {
        return;
    }
    appVersionPending.value = true;
    try {
        appVersion.value = await $fetch<AppVersionDto>("/api/app/version");
    } catch {
        appVersion.value = null;
    } finally {
        appVersionPending.value = false;
    }
}

watch(() => props.modelValue, (open) => {
    if (!open) {
        return;
    }
    void loadAppVersion();
    if (desktopBridge.value) {
        void loadDesktopSettings();
    }
}, {immediate: true});

watch([
    () => novelIdeStore.workspaceKind,
    () => novelIdeStore.currentProjectRoot,
], ([workspaceKind, currentProjectRoot]) => {
    if ((workspaceKind === "user-assets" || !currentProjectRoot) && activeScope.value === "project") {
        activeScope.value = "global";
        activeSection.value = "models";
    }
}, {immediate: true});

watch(activeScope, alignActiveSectionToScope, {immediate: true});

/** 读取 Desktop Envelope 的设备设置；B/S 页面不会执行。 */
async function loadDesktopSettings(): Promise<void> {
    const bridge = desktopBridge.value;
    if (!bridge) return;
    try {
        const [settings, status] = await Promise.all([bridge.settings(), bridge.status()]);
        desktopSettings.value = settings;
        desktopStatus.value = status;
    } catch {
        desktopStatus.value = null;
    }
}

/** 通过 Desktop Bridge 更新设备设置，不触碰 Product State Root。 */
async function updateDesktopSettings(patch: Partial<Pick<DesktopSettings, "zoomFactor" | "trayEnabled" | "closeBehavior">>): Promise<void> {
    const bridge = desktopBridge.value;
    if (!bridge) return;
    try {
        desktopSettings.value = await bridge.updateSettings(patch);
    } catch (error) {
        notification.error(error instanceof Error ? error.message : t("settings.desktop.updateFailed"));
    }
}

const desktopCloseOptions = computed<SelectOption[]>(() => [
    {value: "ask", label: t("settings.desktop.closeAsk")},
    {value: "tray", label: t("settings.desktop.closeTray")},
    {value: "quit", label: t("settings.desktop.closeQuit")},
]);

function updateDesktopCloseBehavior(value: string): void {
    if (value === "ask" || value === "tray" || value === "quit") void updateDesktopSettings({closeBehavior: value as DesktopCloseBehavior});
}

</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        :title="t('settings.title')"
        width="min(1440px, calc(100vw - 48px))"
        height="90vh"
        overlay-type="opaque"
        :busy="false"
        :show-footer="false"
        @request-close="closeDialog"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <!-- 固定高度，顶部配置目标栏 + 左右分栏 -->
        <div class="flex h-full flex-col gap-4">
            <!-- 配置目标栏 -->
            <section class="shrink-0 rounded-2xl border border-[var(--border-color)] border-opacity-70 bg-[var(--bg-input)] bg-opacity-20 px-4 py-3 shadow-sm">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0 space-y-3">
                        <div class="flex min-w-0 flex-wrap items-center gap-2">
                            <button
                                v-for="scope in scopeOptions"
                                :key="scope.value"
                                type="button"
                                class="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-color)] border-opacity-60 px-3 text-xs font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-45"
                                :class="activeScope === scope.value ? 'border-[var(--accent-main)] border-opacity-30 bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm' : 'bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                :disabled="scope.value === 'project' && !projectScopeAvailable"
                                :title="scope.value === 'project' && !projectScopeAvailable ? t('settings.scope.project.unavailable') : scope.description"
                                @click="selectScope(scope.value)"
                            >
                                <span :class="scope.iconClass" class="h-3.5 w-3.5"></span>
                                <span>{{ scope.label }}</span>
                            </button>
                        </div>
                    </div>

                    <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        <div v-if="activeScope === 'project'" class="flex min-w-[300px] items-center gap-2 rounded-lg border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-panel)] bg-opacity-35 px-3 py-2">
                            <span class="shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">Project</span>
                            <span class="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-main)]" :title="targetLabel">{{ targetLabel }}</span>
                        </div>

                        <button
                            v-if="showHeaderSaveButton"
                            type="button"
                            class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] bg-opacity-45 px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors duration-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                            :disabled="activeRestoreDisabled"
                            @click="void restoreActivePanel()"
                        >
                            <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                            <span>{{ t("common.restore") }}</span>
                        </button>

                        <button
                            v-if="showHeaderSaveButton"
                            type="button"
                            class="group relative inline-flex h-9 shrink-0 items-center justify-center overflow-hidden rounded-lg px-4 text-xs font-medium transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                            :class="activeSaveDirty && !activeSaveLoading ? 'bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-md hover:shadow-lg' : 'border border-[var(--border-color)] bg-[var(--bg-panel)] bg-opacity-45 text-[var(--text-muted)]'"
                            :disabled="activeSaveDisabled"
                            @click="void saveActivePanel()"
                        >
                            <span v-if="activeSaveDirty && !activeSaveLoading" class="absolute inset-0 translate-y-full bg-white/20 transition-transform duration-300 ease-out group-hover:translate-y-0"></span>
                            <span class="relative flex items-center gap-1.5">
                                <span v-if="activeSaveLoading || activeSaveSaving" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                <span v-else class="i-lucide-save h-3.5 w-3.5"></span>
                                {{ activeSaveLoading ? t("common.loading") : activeSaveSaving ? t("common.saving") : t("common.saveSettings") }}
                            </span>
                        </button>
                    </div>
                </div>
            </section>

            <div class="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:gap-6">
                <!-- 左侧导航栏 - 清爽无边框 -->
            <aside class="flex w-full min-w-0 flex-col pb-2 md:w-[220px] md:shrink-0">
                <div class="mb-3 mt-1 hidden px-3 md:block">
                    <div class="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{{ activeScope === "browser" ? t("settings.scope.browserState") : t("settings.scope.configFile") }}</div>
                </div>

                <div class="flex min-w-0 gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
                    <button
                        v-for="item in visibleSectionItems"
                        :key="item.value"
                        class="group relative flex min-w-max shrink-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-all duration-200 md:w-full md:gap-3 md:px-2.5 md:py-2.5"
                        :class="activeSection === item.value ? 'bg-[var(--bg-input)] text-[var(--text-main)] shadow-[0_2px_8px_color-mix(in_srgb,var(--shadow-color)_4%,transparent)] border border-[var(--border-color)]' : 'border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:bg-opacity-40 hover:text-[var(--text-main)]'"
                        @click="selectSection(item.value)"
                    >
                        <!-- 图标 -->
                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-300" :class="activeSection === item.value ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm font-semibold' : 'bg-transparent text-[var(--text-muted)] group-hover:text-[var(--text-main)]'">
                            <span :class="item.iconClass" class="h-4 w-4"></span>
                        </div>
                        
                        <div class="min-w-0 flex-1">
                            <span class="block whitespace-nowrap text-xs font-medium md:text-[13px]">{{ item.label }}</span>
                            <span class="mt-0.5 hidden truncate text-[10px] text-[var(--text-muted)] md:block">{{ item.description }}</span>
                        </div>
                    </button>
                </div>

                <!-- 底部版本信息 -->
                <div class="mt-auto hidden pt-4 md:block">
                    <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-15 px-3.5 py-3 shadow-sm">
                        <div class="min-w-0">
                            <div class="truncate text-[11px] font-medium leading-relaxed text-[var(--text-secondary)]">{{ versionLabel }}</div>
                            <div class="mt-0.5 text-[10px] leading-relaxed text-[var(--text-muted)]">Neuro Book</div>
                        </div>
                        <a
                            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] border-opacity-60 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                            :href="appVersion?.githubUrl || 'https://github.com/notnotype/neuro-book'"
                            target="_blank"
                            rel="noreferrer"
                            :title="t('settings.version.openGithub')"
                        >
                            <span class="i-lucide-github h-4 w-4"></span>
                        </a>
                    </div>
                </div>
            </aside>

            <!-- 右侧内容区 -->
            <section class="min-w-0 flex-1 relative flex flex-col overflow-hidden">
                <!-- 内部独立滚动 -->
                <div class="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-6">
                    <Transition name="fade-slide" mode="out-in">
                        <!-- 启动期安全配置：只读说明，避免把安全边界误解为可热更新的 Global Config。 -->
                        <div v-if="activeSection === 'security'" key="security" class="space-y-4 pt-1">
                            <div class="rounded-2xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-5 py-4 text-[var(--text-main)]">
                                <div class="flex items-start gap-3">
                                    <span class="i-lucide-shield-check mt-0.5 h-5 w-5 shrink-0 text-[var(--status-info)]"></span>
                                    <div>
                                        <h3 class="text-sm font-semibold">{{ t("settings.security.title") }}</h3>
                                        <p class="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{{ t("settings.security.description") }}</p>
                                    </div>
                                </div>
                            </div>
                            <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                <div class="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <div class="text-sm font-medium text-[var(--text-main)]">auth.enabled</div>
                                        <div class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.security.runtimeStatusDescription") }}</div>
                                    </div>
                                    <div class="rounded-full border px-3 py-1 text-xs font-medium" :class="bootAuthEnabled === null ? 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]' : bootAuthEnabled ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                                        {{ bootAuthEnabled === null ? t("settings.security.statusUnknown") : bootAuthEnabled ? t("settings.security.statusEnabled") : t("settings.security.statusDisabled") }}
                                    </div>
                                </div>
                                <div class="mt-4 text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.security.exampleTitle") }}</div>
                                <pre class="mt-2 overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] p-4 text-xs text-[var(--text-secondary)]">{{ bootAuthExample }}</pre>
                                <p class="mt-3 text-xs leading-5 text-[var(--status-warning)]">{{ t("settings.security.warning") }}</p>
                            </div>
                        </div>

                        <!-- 前端设定 -->
                        <div v-else-if="activeSection === 'frontend'" key="frontend" class="space-y-4 pt-1">
                            <div class="grid gap-3">
                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-languages h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.frontend.languageTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.frontend.languageDescription") }}</div>
                                    </div>
                                    <div class="w-48 shrink-0">
                                        <FormSelect :model-value="locale" :options="localeOptions" @update:model-value="updateLocale" />
                                    </div>
                                </div>

                                <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                    <!-- 主题管理入口 -->
                                    <div class="flex flex-wrap items-start gap-4">
                                        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)]">
                                            <span class="i-lucide-palette h-5 w-5"></span>
                                        </div>
                                        <div class="min-w-0 flex-1">
                                            <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.frontend.themeTitle") }}</div>
                                            <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.frontend.themeDescription") }}</div>
                                            <div class="mt-2 text-xs text-[var(--text-muted)]">{{ activeResolvedTheme.label }} · {{ activeThemeIsBuiltIn ? t("settings.frontend.themeBuiltInPreset") : t("settings.frontend.themeCustomPreset") }}</div>
                                        </div>
                                        <div class="flex shrink-0 items-center gap-2">
                                            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent bg-[var(--accent-main)] px-3 text-xs font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90" @click="openThemeCreator">
                                                <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                                <span>{{ t("settings.frontend.themeCreate") }}</span>
                                            </button>
                                            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="triggerThemeImport">
                                                <span class="i-lucide-upload h-3.5 w-3.5"></span>
                                                <span>{{ t("settings.frontend.themeImport") }}</span>
                                            </button>
                                            <input ref="themeImportInputRef" class="hidden" type="file" accept="application/json,.json" @change="void importThemeFile($event)">
                                        </div>
                                    </div>

                                    <!-- 内置主题卡片网格 -->
                                    <div class="mt-4">
                                        <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.themeBuiltInGroup") }}</div>
                                        <div class="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                                            <div v-for="card in builtInThemeCards" :key="card.id" class="group relative cursor-pointer overflow-hidden rounded-lg border transition-all" :class="activeResolvedTheme.id === card.id ? 'border-[var(--accent-main)] shadow-[0_0_0_1px_var(--accent-main)]' : 'border-[var(--border-color)] hover:border-[var(--border-strong)] hover:shadow-sm'" @click="updateTheme(card.id)">
                                                <!-- 迷你预览：使用该主题自己的变量绘制 -->
                                                <div class="relative h-16" :style="{background: card.vars['--bg-main']}">
                                                    <div class="absolute inset-y-1.5 left-1.5 w-6 rounded-sm" :style="{background: card.vars['--bg-sidebar']}"></div>
                                                    <div class="absolute bottom-1.5 left-9 right-1.5 top-1.5 rounded-sm border px-1.5 py-1" :style="{background: card.vars['--bg-panel'], borderColor: card.vars['--border-color']}">
                                                        <div class="text-[11px] font-semibold leading-none" :style="{color: card.vars['--text-main']}">Aa</div>
                                                        <div class="mt-1 h-1 w-9 rounded-full" :style="{background: card.vars['--text-muted']}"></div>
                                                        <div class="absolute bottom-1 left-1.5 flex items-center gap-1">
                                                            <span class="h-1.5 w-3 rounded-full" :style="{background: card.vars['--accent-main']}"></span>
                                                            <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-info']}"></span>
                                                            <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-success']}"></span>
                                                            <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-warning']}"></span>
                                                            <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-danger']}"></span>
                                                        </div>
                                                    </div>
                                                    <!-- 悬停操作：复制为自定义 / 导出 -->
                                                    <div class="absolute right-1 top-1 flex items-center gap-0.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                                                        <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeCopy')" @click.stop="openThemeCopier(card.id)">
                                                            <span class="i-lucide-copy h-3.5 w-3.5"></span>
                                                        </button>
                                                        <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeExport')" @click.stop="exportTheme(card.id)">
                                                            <span class="i-lucide-download h-3.5 w-3.5"></span>
                                                        </button>
                                                    </div>
                                                </div>
                                                <!-- 名称行：使用当前主题变量，保证列表底盘一致 -->
                                                <div class="flex items-center gap-1.5 border-t border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
                                                    <span class="h-3 w-3 shrink-0 text-[var(--text-muted)]" :class="card.appearance === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'"></span>
                                                    <span class="min-w-0 flex-1 truncate text-xs text-[var(--text-main)]">{{ card.name }}</span>
                                                    <span v-if="activeResolvedTheme.id === card.id" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- 自定义主题卡片网格 -->
                                    <div class="mt-4">
                                        <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.themeCustomGroup") }}</div>
                                        <div v-if="customThemeCards.length" class="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                                            <div v-for="card in customThemeCards" :key="card.id" class="group relative cursor-pointer overflow-hidden rounded-lg border transition-all" :class="activeThemeId === card.id ? 'border-[var(--accent-main)] shadow-[0_0_0_1px_var(--accent-main)]' : 'border-[var(--border-color)] hover:border-[var(--border-strong)] hover:shadow-sm'" @click="updateTheme(card.id)">
                                                <!-- 迷你预览：使用该主题自己的变量绘制 -->
                                                <div class="relative h-16" :style="{background: card.vars['--bg-main']}">
                                                    <div class="absolute inset-y-1.5 left-1.5 w-6 rounded-sm" :style="{background: card.vars['--bg-sidebar']}"></div>
                                                    <div class="absolute bottom-1.5 left-9 right-1.5 top-1.5 rounded-sm border px-1.5 py-1" :style="{background: card.vars['--bg-panel'], borderColor: card.vars['--border-color']}">
                                                        <div class="text-[11px] font-semibold leading-none" :style="{color: card.vars['--text-main']}">Aa</div>
                                                        <div class="mt-1 h-1 w-9 rounded-full" :style="{background: card.vars['--text-muted']}"></div>
                                                        <div class="absolute bottom-1 left-1.5 flex items-center gap-1">
                                                            <span class="h-1.5 w-3 rounded-full" :style="{background: card.vars['--accent-main']}"></span>
                                                            <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-info']}"></span>
                                                            <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-success']}"></span>
                                                            <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-warning']}"></span>
                                                            <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-danger']}"></span>
                                                        </div>
                                                    </div>
                                                    <!-- 悬停操作：编辑 / 复制 / 导出 / 删除 -->
                                                    <div class="absolute right-1 top-1 flex items-center gap-0.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                                                        <button v-if="card.custom" type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeEdit')" @click.stop="openThemeEditor(card.custom)">
                                                            <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                                                        </button>
                                                        <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeCopy')" @click.stop="openThemeCopier(card.id)">
                                                            <span class="i-lucide-copy h-3.5 w-3.5"></span>
                                                        </button>
                                                        <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeExport')" @click.stop="exportTheme(card.id)">
                                                            <span class="i-lucide-download h-3.5 w-3.5"></span>
                                                        </button>
                                                        <button v-if="card.custom" type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)]" :title="t('settings.frontend.themeDelete')" @click.stop="requestDeleteTheme(card.custom)">
                                                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                                        </button>
                                                    </div>
                                                </div>
                                                <!-- 名称行：使用当前主题变量，保证列表底盘一致 -->
                                                <div class="flex items-center gap-1.5 border-t border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
                                                    <span class="h-3 w-3 shrink-0 text-[var(--text-muted)]" :class="card.appearance === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'"></span>
                                                    <span class="min-w-0 flex-1 truncate text-xs text-[var(--text-main)]">{{ card.name }}</span>
                                                    <span v-if="activeThemeId === card.id" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                                                </div>
                                            </div>
                                        </div>
                                        <div v-else class="rounded-md bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-muted)]">{{ t("settings.frontend.themeNoCustom") }}</div>
                                    </div>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-brain-circuit h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.frontend.reasoningTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.frontend.reasoningDescription") }}</div>
                                    </div>
                                    <div class="w-40 shrink-0">
                                        <FormSelect :model-value="selectedReasoning" :options="novelIdeStore.reasoningOptions.map((item) => ({ value: item, label: item }))" @update:model-value="selectedReasoning = $event" />
                                    </div>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-layout h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.frontend.viewModeTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.frontend.viewModeDescription") }}</div>
                                    </div>
                                    <div class="w-40 shrink-0">
                                        <FormSelect :model-value="viewMode" :options="viewModeOptions" @update:model-value="updateViewMode" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 编辑器设定 -->
                        <div v-else-if="activeSection === 'editor'" key="editor" class="space-y-4 pt-1">
                            <div class="flex flex-wrap items-center justify-between gap-4">
                                <div class="max-w-xl">
                                    <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.editor.markdownTitle") }}</h3>
                                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.markdownDescription") }}</p>
                                </div>
                                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetEditorPreferences">
                                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                                    <span>{{ t("settings.editor.resetMarkdown") }}</span>
                                </button>
                            </div>

                            <div class="grid gap-3">
                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-type h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.bodyFontTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.bodyFontDescription") }}</div>
                                    </div>
                                    <div class="w-72 shrink-0">
                                        <input
                                            list="markdown-editor-font-options"
                                            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20"
                                            :value="markdownEditorPreferences.fontFamily"
                                            :placeholder="t('settings.editor.fontFamilyPlaceholder')"
                                            @input="updateEditorPreferences({fontFamily: ($event.target as HTMLInputElement).value})"
                                        >
                                        <datalist id="markdown-editor-font-options">
                                            <option v-for="option in editorFontOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                                        </datalist>
                                    </div>
                                </div>

                                <div class="grid gap-3 md:grid-cols-2">
                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.fontSizeTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.fontSizeDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="markdownEditorPreferences.fontSize" min="12" max="28" step="1" @input="updateEditorNumber('fontSize', ($event.target as HTMLInputElement).value, 12, 28)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.lineHeightTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.lineHeightDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="markdownEditorPreferences.lineHeight" min="1.2" max="2.6" step="0.05" @input="updateEditorNumber('lineHeight', ($event.target as HTMLInputElement).value, 1.2, 2.6)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.contentWidthTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.contentWidthDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="markdownEditorPreferences.contentWidth" min="520" max="1280" step="20" @input="updateEditorNumber('contentWidth', ($event.target as HTMLInputElement).value, 520, 1280)">
                                    </label>

                                    <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <div class="flex items-center justify-between gap-4">
                                            <div class="min-w-0">
                                                <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.paragraphIndentTitle") }}</div>
                                                <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.paragraphIndentDescription") }}</div>
                                            </div>
                                            <button type="button" class="relative h-6 w-11 rounded-full border transition-colors" :class="markdownEditorPreferences.paragraphIndentEnabled ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]'" @click="updateEditorPreferences({paragraphIndentEnabled: !markdownEditorPreferences.paragraphIndentEnabled})">
                                                <span class="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform" :class="markdownEditorPreferences.paragraphIndentEnabled ? 'translate-x-5' : 'translate-x-0.5'"></span>
                                            </button>
                                        </div>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20 disabled:opacity-50" :value="markdownEditorPreferences.paragraphIndentEm" min="0" max="4" step="0.25" :disabled="!markdownEditorPreferences.paragraphIndentEnabled" @input="updateEditorNumber('paragraphIndentEm', ($event.target as HTMLInputElement).value, 0, 4)">
                                    </div>
                                </div>
                            </div>

                            <div class="grid gap-3 border-t border-[var(--border-color)] pt-4">
                                <div class="flex flex-wrap items-center justify-between gap-4">
                                    <div class="max-w-xl">
                                        <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.editor.monacoTitle") }}</h3>
                                        <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.monacoDescription") }}</p>
                                    </div>
                                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetMonacoPreferences">
                                        <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                                        <span>{{ t("settings.editor.resetMonaco") }}</span>
                                    </button>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-code-2 h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.monacoFontTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.monacoFontDescription") }}</div>
                                    </div>
                                    <div class="w-72 shrink-0">
                                        <input
                                            list="monaco-editor-font-options"
                                            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20"
                                            :value="monacoEditorPreferences.fontFamily"
                                            :placeholder="t('settings.editor.fontFamilyPlaceholder')"
                                            @input="updateMonacoPreferences({fontFamily: ($event.target as HTMLInputElement).value})"
                                        >
                                        <datalist id="monaco-editor-font-options">
                                            <option v-for="option in monacoFontOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                                        </datalist>
                                    </div>
                                </div>

                                <div class="grid gap-3 md:grid-cols-3">
                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.monacoFontSizeTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.monacoFontSizeDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="monacoEditorPreferences.fontSize" min="10" max="32" step="1" @input="updateMonacoNumber('fontSize', ($event.target as HTMLInputElement).value, 10, 32)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.monacoLineHeightTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.monacoLineHeightDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="monacoEditorPreferences.lineHeight" min="16" max="56" step="1" @input="updateMonacoNumber('lineHeight', ($event.target as HTMLInputElement).value, 16, 56)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.tabSizeTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.tabSizeDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="monacoEditorPreferences.tabSize" min="2" max="8" step="1" @input="updateMonacoNumber('tabSize', ($event.target as HTMLInputElement).value, 2, 8)">
                                    </label>
                                </div>

                                <div class="grid gap-3 md:grid-cols-2">
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({wordWrap: !monacoEditorPreferences.wordWrap})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.wordWrapTitle") }}</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.wordWrapDescription") }}</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.wordWrap ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({minimapEnabled: !monacoEditorPreferences.minimapEnabled})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.minimapTitle") }}</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.minimapDescription") }}</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.minimapEnabled ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({lineNumbers: !monacoEditorPreferences.lineNumbers})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.lineNumbersTitle") }}</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.lineNumbersDescription") }}</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.lineNumbers ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({renderWhitespace: !monacoEditorPreferences.renderWhitespace})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.whitespaceTitle") }}</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.whitespaceDescription") }}</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.renderWhitespace ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'"></span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Desktop Envelope 设备设置；B/S 页面不会显示该分区。 -->
                        <div v-else-if="activeSection === 'desktop' && desktopAvailable" key="desktop" class="space-y-4 pt-1">
                            <div class="rounded-2xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-5 py-4 text-[var(--text-main)]">
                                <div class="flex items-start gap-3">
                                    <span class="i-lucide-panels-top-left mt-0.5 h-5 w-5 shrink-0 text-[var(--status-info)]"></span>
                                    <div class="min-w-0">
                                        <h3 class="text-sm font-semibold">{{ t("settings.desktop.title") }}</h3>
                                        <p class="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{{ t("settings.desktop.description") }}</p>
                                        <p v-if="desktopStatus" class="mt-2 text-[11px] text-[var(--text-muted)]">{{ desktopStatus.connection === "local" ? t("settings.desktop.localStatus") : t("settings.desktop.remoteStatus") }} · {{ desktopStatus.version }}</p>
                                    </div>
                                </div>
                            </div>

                            <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                <div class="flex items-center justify-between gap-4">
                                    <div>
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.desktop.zoomTitle") }}</div>
                                        <div class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.desktop.zoomDescription") }}</div>
                                    </div>
                                    <output class="text-sm font-semibold text-[var(--accent-main)]">{{ Math.round(desktopSettings.zoomFactor * 100) }}%</output>
                                </div>
                                <input class="mt-4 w-full accent-[var(--accent-main)]" type="range" min="0.75" max="2" step="0.05" :value="desktopSettings.zoomFactor" @change="updateDesktopSettings({zoomFactor: Number(($event.target as HTMLInputElement).value)})">
                            </label>

                            <button type="button" class="flex w-full items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-colors hover:bg-[var(--bg-hover)]" @click="updateDesktopSettings({trayEnabled: !desktopSettings.trayEnabled})">
                                <span>
                                    <span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.desktop.trayTitle") }}</span>
                                    <span class="mt-1 block text-xs text-[var(--text-secondary)]">{{ t("settings.desktop.trayDescription") }}</span>
                                </span>
                                <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="desktopSettings.trayEnabled ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'"></span>
                            </button>

                            <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.desktop.closeTitle") }}</div>
                                <div class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.desktop.closeDescription") }}</div>
                                <div class="mt-3 max-w-sm">
                                    <FormSelect :model-value="desktopSettings.closeBehavior" :options="desktopCloseOptions" @update:model-value="updateDesktopCloseBehavior" />
                                </div>
                            </div>
                        </div>

                        <!-- 模型设定 -->
                        <div v-else-if="activeSection === 'models'" key="models">
                            <!-- 注意：ModelSettingsPanel 内部不使用 h-full，让外层自动撑开或根据内容滚动 -->
                            <NovelIdeModelSettingsPanel ref="modelSettingsPanelRef" :key="`models:${settingsPanelKey}`" :scope="activeScope === 'project' ? 'project' : 'global'" :target-query="targetQuery" :target-label="targetLabel" />
                        </div>

                        <!-- Embedding 服务设定 -->
                        <div v-else-if="activeSection === 'embedding'" key="embedding">
                            <NovelIdeEmbeddingSettingsPanel ref="embeddingSettingsPanelRef" :key="`embedding:${settingsPanelKey}`" :scope="activeScope === 'project' ? 'project' : 'global'" :target-query="targetQuery" :target-label="targetLabel" />
                        </div>

                        <!-- 费用显示设定 -->
                        <div v-else-if="activeSection === 'cost'" key="cost">
                            <NovelIdeCostSettingsPanel ref="costSettingsPanelRef" :key="`cost:${settingsPanelKey}`" :target-query="targetQuery" />
                        </div>

                        <!-- Web 工具设定 -->
                        <div v-else-if="activeSection === 'web-tools'" key="web-tools">
                            <NovelIdeWebSettingsPanel ref="webSettingsPanelRef" :key="`web-tools:${settingsPanelKey}`" :target-query="targetQuery" :target-label="targetLabel" />
                        </div>

                        <!-- Agent Profile 模型设定 -->
                        <div v-else-if="activeSection === 'agent-profile-models'" key="agent-profile-models">
                            <NovelIdeAgentProfileModelSettingsPanel ref="agentProfileModelSettingsPanelRef" :key="`profile-models:${settingsPanelKey}`" :scope="activeScope === 'project' ? 'project' : 'global'" :target-query="targetQuery" :target-label="targetLabel" />
                        </div>

                        <!-- 可观测设定（Pi 请求 trace） -->
                        <div v-else-if="activeSection === 'observability'" key="observability">
                            <NovelIdeObservabilitySettingsPanel ref="observabilitySettingsPanelRef" :key="`observability:${settingsPanelKey}`" :target-query="targetQuery" />
                        </div>

                    </Transition>
                </div>
            </section>
            </div>
        </div>
    </Dialog>

    <ThemeEditorDialog
        v-model="themeEditorOpen"
        :mode="themeEditorMode"
        :initial-theme="themeEditorInitialTheme"
        :existing-themes="customThemes"
        @saved="handleThemeSaved"
    />

    <Dialog
        :model-value="Boolean(themeDeleteTarget)"
        :title="t('settings.frontend.themeDeleteTitle')"
        width="420px"
        overlay-type="opaque"
        show-cancel
        @confirm="void confirmDeleteTheme()"
        @request-close="themeDeleteTarget = null"
        @update:model-value="themeDeleteTarget = $event ? themeDeleteTarget : null"
    >
        <!-- 删除自定义主题确认 -->
        <p class="text-sm text-[var(--text-secondary)]">{{ t("settings.frontend.themeDeleteMessage", {name: themeDeleteTarget?.name ?? ""}) }}</p>
    </Dialog>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.2s cubic-bezier(0.34, 1.15, 0.64, 1);
}
.fade-slide-enter-from {
    opacity: 0;
    transform: translateX(10px) scale(0.98);
}
.fade-slide-leave-to {
    opacity: 0;
    transform: translateX(-10px) scale(0.98);
}
</style>
