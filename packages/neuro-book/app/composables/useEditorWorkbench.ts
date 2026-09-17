import {computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch} from "vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useEditorConfiguration} from "nbook/app/composables/useEditorConfiguration";
import {createBuiltinEditorContributions, type BuiltinEditorBindings} from "nbook/app/utils/editor-workbench/builtin-editors";
import {createEditorRegistry, resolveEditorAssociation} from "nbook/app/utils/editor-workbench/registry";
import {resolveEditorLanguage} from "nbook/shared/editor-associations";
import {loadMonacoEditor} from "nbook/app/components/markdown-studio/load-monaco-editor";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {matchesEditorDocument} from "nbook/app/components/editor-workbench/editor-view.types";
import type {EditorAction, EditorDocumentSnapshot, EditorDocumentTarget, EditorTabPresentation, EditorViewHandle} from "nbook/app/components/editor-workbench/editor-view.types";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";

type Binding = {target: EditorDocumentTarget; token: string; handle: EditorViewHandle; release: () => void};
type Resolution = {id: string; languageId: string; diagnosis: string | null};
export function useEditorWorkbench(options: {
    bindings: BuiltinEditorBindings;
    chooseClose(title: string): Promise<string>;
}) {
    const store = useNovelIdeStore();
    const config = useEditorConfiguration();
    const {t} = useI18n();
    const result = createEditorRegistry(createBuiltinEditorContributions(options.bindings));
    if (!result.ok) throw new Error(result.reason);
    const registry = result.value;
    const languages = shallowRef<ReadonlySet<string> | null>(null);
    const engineError = ref<string | null>(null);
    const actionError = ref<string | null>(null);
    const editorFocused = ref(false);
    const binding = shallowRef<Binding | null>(null);
    const actions = shallowRef<readonly EditorAction[]>([]);
    const resolutions = new Map<string, Resolution>();
    const resolution = shallowRef<Resolution | null>(null);
    let savePromise: Promise<boolean> | null = null;
    let saveTarget: EditorDocumentTarget | null = null;
    let disposed = false;

    async function loadLanguages(): Promise<void> {
        engineError.value = null;
        try {
            const monaco = await loadMonacoEditor();
            if (!disposed) languages.value = new Set(["plaintext", ...monaco.languages.getLanguages().map((language) => language.id)]);
        } catch (error) {
            if (!disposed) engineError.value = resolveApiErrorMessage(error, t("editorWorkbench.loadFailed"));
        }
    }
    onMounted(loadLanguages);
    watch(() => store.workspaceGeneration, () => {
        resolutions.clear();
        actionError.value = null;
    }, {flush: "sync"});
    watch([() => store.activeWorkspaceDocumentTarget, () => store.workspaceTabs.find((tab) => tab.path === store.selectedFilePath)?.editorId, config.settings, languages], () => {
        const target = store.activeWorkspaceDocumentTarget;
        const node = store.selectedFileNode;
        if (!target || !node?.editable) {resolution.value = null; return;}
        const cached = resolutions.get(target.documentId);
        const requestedId = store.workspaceTabs.find((tab) => tab.path === target.path)?.editorId ?? null;
        if (cached && (requestedId === null || cached.id === requestedId)) {resolution.value = cached; return;}
        if (!languages.value || (!config.settings.value && !requestedId)) {resolution.value = null; return;}
        const language = resolveEditorLanguage(target.path, config.settings.value?.languageAssociations ?? {}, languages.value);
        const selected = resolveEditorAssociation({registry, resource: {path: target.path, languageId: language.languageId, editable: true}, requestedId, associations: config.settings.value?.associations ?? {}});
        const next = {id: selected.editor?.id ?? "code", languageId: language.languageId, diagnosis: selected.diagnosis ?? language.diagnosis};
        resolutions.set(target.documentId, next);
        resolution.value = next;
    }, {immediate: true});

    const document = computed<EditorDocumentSnapshot | null>(() => {
        const target = store.activeWorkspaceDocumentTarget;
        if (!target || !resolution.value || !store.selectedFileNode?.editable) return null;
        return {target, content: store.selectedFileContent, languageId: resolution.value.languageId, readonly: store.loadingWorkspaceDocument};
    });
    const editorId = computed(() => resolution.value?.id ?? null);
    const tabs = computed<readonly EditorTabPresentation[]>(() => store.workspaceTabs.map((tab) => ({
        ...tab, iconClass: registry.get(tab.editorId ?? (tab.path === store.selectedFilePath ? resolution.value?.id : null) ?? "code")?.iconClass ?? "i-lucide-file",
    })));
    const activePath = computed(() => store.activeWorkspaceTabPath);
    const busy = computed(() => store.loadingWorkspaceDocument || Boolean(store.selectedFileNode?.editable && !diagnosis.value
        && (!document.value || !binding.value || !matchesEditorDocument(binding.value.target, store.activeWorkspaceDocumentTarget))));
    const diagnosis = computed(() => actionError.value ?? store.workspaceDocumentError ?? engineError.value ?? config.diagnosis.value ?? resolution.value?.diagnosis ?? null);

    function bindViewHandle(target: EditorDocumentTarget, token: string, handle: EditorViewHandle | null): void {
        if (!matchesEditorDocument(target, store.activeWorkspaceDocumentTarget)) return;
        if (!handle) {
            if (binding.value?.token === token) {binding.value.release(); binding.value = null; actions.value = [];}
            return;
        }
        if (binding.value?.token === token && binding.value.handle === handle) return;
        binding.value?.release();
        binding.value = {target, token, handle, release: store.registerActiveEditorFlush(target, handle.flushPendingChange)};
        actions.value = [];
        actionError.value = null;
        void nextTick(() => {if (binding.value?.token === token) handle.focus();});
    }
    function flush(): void {store.flushActiveEditorPending();}
    function setActions(target: EditorDocumentTarget, token: string, value: readonly EditorAction[]): void {
        if (binding.value?.token === token && matchesEditorDocument(target, store.activeWorkspaceDocumentTarget)) actions.value = value;
    }
    function setFocus(target: EditorDocumentTarget, focused: boolean): void {
        if (matchesEditorDocument(target, store.activeWorkspaceDocumentTarget)) editorFocused.value = focused;
    }
    function viewError(target: EditorDocumentTarget, message: string): void {
        if (matchesEditorDocument(target, store.activeWorkspaceDocumentTarget)) actionError.value = message;
    }
    function runViewAction(id: string): void {
        const current = binding.value;
        if (!current || !matchesEditorDocument(current.target, store.activeWorkspaceDocumentTarget)) return;
        if (actions.value.some((action) => action.id === id && !action.disabled)) current.handle.runAction?.(id);
    }
    async function selectTab(path: string): Promise<void> {
        flush();
        actionError.value = null;
        try {await store.selectWorkspaceTab(path);} catch (error) {actionError.value = resolveApiErrorMessage(error, t("editorWorkbench.loadFailed"));}
    }
    async function switchEditor(id: string): Promise<void> {
        flush();
        const target = store.activeWorkspaceDocumentTarget;
        if (!target || !store.selectedFileNode?.editable) return;
        const languageId = resolution.value?.languageId ?? "plaintext";
        if (!registry.get(id)?.supports({path: target.path, languageId, editable: true})) return;
        actionError.value = null;
        resolutions.delete(target.documentId);
        store.setWorkspaceTabEditor(target.path, id);
        await nextTick();
    }
    async function save(): Promise<boolean> {
        flush();
        const target = store.activeWorkspaceDocumentTarget;
        if (!target || !store.selectedFileNode?.editable) return false;
        if (savePromise) {
            const same = matchesEditorDocument(target, saveTarget);
            await savePromise;
            if (!same || !matchesEditorDocument(target, store.activeWorkspaceDocumentTarget)) return false;
        }
        saveTarget = target;
        const operation = (async () => {
            actionError.value = null;
            try {
                const saved = await store.saveCurrentFile();
                if (!matchesEditorDocument(target, store.activeWorkspaceDocumentTarget)) return false;
                flush();
                return saved !== null && !store.hasUnsavedFileChanges;
            } catch (error) {
                if (matchesEditorDocument(target, store.activeWorkspaceDocumentTarget)) actionError.value = resolveApiErrorMessage(error, t("editorWorkbench.saveFailed"));
                return false;
            }
        })();
        savePromise = operation;
        try {return await operation;} finally {if (savePromise === operation) {savePromise = null; saveTarget = null;}}
    }
    async function saveRequested(target: EditorDocumentTarget): Promise<void> {
        if (matchesEditorDocument(target, store.activeWorkspaceDocumentTarget)) await save();
    }
    async function closeTab(path: string): Promise<void> {
        flush();
        const generation = store.workspaceGeneration;
        const tab = store.workspaceTabs.find((item) => item.path === path);
        if (!tab) return;
        if (!tab.dirty) {await store.closeWorkspaceTab(path); return;}
        const choice = await options.chooseClose(tab.title);
        if (generation !== store.workspaceGeneration || !store.workspaceTabs.some((item) => item.path === path)) return;
        if (choice === "discard") {await store.closeWorkspaceTab(path, true); return;}
        if (choice !== "save") return;
        if (path !== store.selectedFilePath) await selectTab(path);
        if (generation !== store.workspaceGeneration || path !== store.selectedFilePath) return;
        if (await save()) await store.closeWorkspaceTab(path);
    }
    async function retry(): Promise<void> {
        actionError.value = null;
        if (engineError.value) await loadLanguages();
        await config.reload();
        const id = editorId.value;
        if (id) {
            resolution.value = null;
            await nextTick();
            const target = store.activeWorkspaceDocumentTarget;
            if (target) resolution.value = resolutions.get(target.documentId) ?? null;
        }
        if (store.workspaceDocumentError && store.selectedFilePath) await selectTab(store.selectedFilePath);
    }
    const menus = computed<MenubarMenuData[]>(() => {
        const node = store.selectedFileNode;
        const resource = node && resolution.value ? {path: node.path, editable: node.editable, languageId: resolution.value.languageId} : null;
        return [{id: "file", label: t("editorWorkbench.file"), items: [
            {value: "save", label: t("editorWorkbench.save"), shortcut: "Ctrl+S", disabled: !node?.editable || store.savingFile},
            {value: "close", label: t("editorWorkbench.close"), disabled: !activePath.value},
            {value: "reload", label: t("editorWorkbench.reloadConfiguration"), disabled: config.loading.value},
        ]}, {id: "open-with", label: t("editorWorkbench.openWith"), disabled: !node?.editable, items: (resource ? registry.available(resource) : [registry.get("code")!]).map((entry) => ({
            value: `editor:${entry.id}`, label: t(entry.titleKey), checked: entry.id === editorId.value, type: "checkbox" as const,
        }))}, ...(actions.value.length ? [{id: "view-actions", label: t("editorWorkbench.viewActions"), items: actions.value.map((action) => ({...action, value: `action:${action.id}`, type: action.checked === undefined ? "default" as const : "checkbox" as const}))}] : [])];
    });
    async function selectMenu(item: MenubarItemData): Promise<void> {
        if (item.disabled) return;
        if (item.value === "save") await save();
        else if (item.value === "close") await closeTab(activePath.value);
        else if (item.value === "reload") await config.reload();
        else if (item.value.startsWith("editor:")) await switchEditor(item.value.slice(7));
        else if (item.value.startsWith("action:")) runViewAction(item.value.slice(7));
    }
    onScopeDispose(() => {disposed = true; binding.value?.release();});
    return {
        registry, tabs, activePath, document, editorId, menus, busy, diagnosis, editorFocused,
        selectTab, closeTab, switchEditor, save, saveRequested, flush, bindViewHandle, setActions, setFocus, viewError, runViewAction, retry, selectMenu,
        undo: () => binding.value?.handle.undo?.(), redo: () => binding.value?.handle.redo?.(),
    };
}
