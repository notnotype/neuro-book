/**
 * 编辑工作台的编排层：把 Store 的会话/正文权威接到视图层。
 *
 * 分工（多组下的关键约束）：
 * - **Store 是 authority**：组集合、标签实例、正文缓冲、保存与冲突登记都在那里；本组合函数
 *   只派发动作、生成呈现（tabs/document/menus/actions）并管理视图实例的绑定。
 * - **逐组隔离**：绑定、句柄、动作、分辨率、诊断、保存都在 groupId 维度上；一个组的实例
 *   回调不能覆盖另一个组，后台组就绪也不抢焦点。
 * - **输入有回执**：`commitChange` 是唯一的内容入口，返回 accepted/conflict/stale；
 *   冲突进入 Store 的未解决登记，由 `conflictRequest` 这条一次性通道驱动实例执行
 *   "采用当前正文"或"保留此视图内容"。
 */
import {computed, nextTick, onMounted, onScopeDispose, reactive, ref, shallowRef, watch} from "vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useEditorConfiguration} from "nbook/app/composables/useEditorConfiguration";
import {createBuiltinEditorContributions, type BuiltinEditorBindings} from "nbook/app/utils/editor-workbench/builtin-editors";
import {createEditorRegistry, resolveEditorAssociation} from "nbook/app/utils/editor-workbench/registry";
import {resolveEditorLanguage} from "nbook/shared/editor-associations";
import {loadMonacoEditor} from "nbook/app/components/markdown-studio/load-monaco-editor";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {matchesEditorDocument} from "nbook/app/components/editor-workbench/editor-view.types";
import type {
    CommandEditorBinding,
    EditorAction,
    EditorChangeRequest,
    EditorChangeResult,
    EditorDocumentSnapshot,
    EditorDocumentTarget,
    EditorFlushResult,
    EditorSplitDirection,
    EditorTabPresentation,
    EditorViewHandle,
} from "nbook/app/components/editor-workbench/editor-view.types";
import type {EditorSplitPayload, TabTransferPayload} from "nbook/app/components/editor-workbench/editor-intents";
import type {MenubarItemData, MenubarMenuData} from "@notnotype/nb-ui/components";

type Resolution = {id: string; languageId: string; diagnosis: string | null};

/** 一个组的运行期绑定状态；不含会话事实（那些在 Store 里）。 */
type GroupRuntime = {
    handle: EditorViewHandle | null;
    token: string | null;
    releaseFlush: (() => void) | null;
    actions: readonly EditorAction[];
    error: string | null;
};

export type EditorGroupPresentation = Readonly<{
    id: string;
    tabs: readonly EditorTabPresentation[];
    activePath: string;
    document: EditorDocumentSnapshot | null;
    editorId: string | null;
    menus: MenubarMenuData[];
    actions: readonly EditorAction[];
    busy: boolean;
    diagnosis: string | null;
}>;

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
    const editorFocused = ref(false);
    const runtimes = reactive<Record<string, GroupRuntime>>({});
    /** 逐组解析缓存必须可响应：它晚于缓冲建立时，组的呈现要能重新求值并绑定编辑器。 */
    const resolutions = reactive(new Map<string, Resolution>());
    let groupSequence = 0;
    let disposed = false;

    /** 冲突裁决的一次性请求：页面把它喂给对应组的宿主，宿主执行后回报 token。 */
    const conflictRequest = ref<Readonly<{groupId: string; token: string; choice: "adopt-current" | "keep-view"}> | null>(null);

    const resolutionKey = (groupId: string, documentId: string): string => `${groupId}:${documentId}`;
    function runtimeOf(groupId: string): GroupRuntime {
        runtimes[groupId] ??= {handle: null, token: null, releaseFlush: null, actions: [], error: null};
        return runtimes[groupId]!;
    }

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
        for (const key of Object.keys(runtimes)) delete runtimes[key];
        conflictRequest.value = null;
    }, {flush: "sync"});

    /** 组集合与每组的活动路径、标签（来自 Store 的投影）。 */
    const groupIds = computed(() => store.editorGroups.map((group) => group.id));
    const activeGroupId = computed(() => store.activeEditorGroupId);
    const tabsOf = (groupId: string): EditorTabPresentation[] => store.workspaceTabs
        .filter((tab) => tab.editorGroupId === groupId)
        .map((tab) => ({
            ...tab,
            iconClass: registry.get(tab.editorId ?? resolutionOf(groupId, tab.path)?.id ?? "code")?.iconClass ?? "i-lucide-file",
        }));
    const activePathOf = (groupId: string): string => store.editorGroups.find((group) => group.id === groupId)?.activePath ?? "";
    /** 逐组读取状态：每个组读它自己的登记，活动组与后台组同一份判据。 */
    const groupIsLoading = (groupId: string): boolean => Boolean(store.editorGroupLoading[groupId]);
    const groupErrorOf = (groupId: string): string | null => store.editorGroupErrors[groupId] ?? null;

    const documentTargetOf = (groupId: string): EditorDocumentTarget | null => {
        const path = activePathOf(groupId);
        const buffer = store.workspaceBuffers[path];
        return path && buffer ? store.editorDocumentTarget(path) : null;
    };

    function documentOf(groupId: string): EditorDocumentSnapshot | null {
        const path = activePathOf(groupId);
        const buffer = store.workspaceBuffers[path];
        const resolution = resolutionOf(groupId, path);
        if (!path || !buffer || !resolution || !buffer.node.editable) return null;
        return {
            target: store.editorDocumentTarget(path),
            content: buffer.content,
            contentRevision: buffer.contentRevision,
            languageId: resolution.languageId,
            readonly: groupIsLoading(groupId),
        };
    }

    /** 逐组解析（编辑器选择 + 语言）：同一文档在不同组可以呈现不同视图。 */
    function resolutionOf(groupId: string, path: string): Resolution | null {
        const buffer = store.workspaceBuffers[path];
        if (!buffer) return null;
        return resolutions.get(resolutionKey(groupId, store.editorDocumentTarget(path).documentId)) ?? null;
    }

    watch([() => store.editorSession, () => store.workspaceTabs.length, config.settings, languages], () => {
        for (const group of store.editorGroups) {
            const path = group.activePath;
            const buffer = store.workspaceBuffers[path];
            if (!path || !buffer?.node.editable) continue;
            const target = store.editorDocumentTarget(path);
            const key = resolutionKey(group.id, target.documentId);
            const cached = resolutions.get(key);
            const requestedId = store.workspaceTabs.find((tab) => tab.editorGroupId === group.id && tab.path === path)?.editorId ?? null;
            if (cached && (requestedId === null || cached.id === requestedId)) continue;
            if (!languages.value || (!config.settings.value && !requestedId)) continue;
            const language = resolveEditorLanguage(path, config.settings.value?.languageAssociations ?? {}, languages.value);
            const selected = resolveEditorAssociation({
                registry,
                resource: {path, languageId: language.languageId, editable: true},
                requestedId,
                associations: config.settings.value?.associations ?? {},
            });
            resolutions.set(key, {id: selected.editor?.id ?? "code", languageId: language.languageId, diagnosis: selected.diagnosis ?? language.diagnosis});
        }
    }, {immediate: true, deep: true});

    const diagnoseOf = (groupId: string): string | null => runtimes[groupId]?.error
        ?? groupErrorOf(groupId)
        ?? engineError.value
        ?? config.diagnosis.value
        ?? resolutionOf(groupId, activePathOf(groupId))?.diagnosis
        ?? null;

    const presentationOf = (groupId: string): EditorGroupPresentation => {
        const document = documentOf(groupId);
        const runtime = runtimeOf(groupId);
        const busy = !document || groupIsLoading(groupId)
            || Boolean(document && !diagnoseOf(groupId) && !runtime.handle);
        return {
            id: groupId,
            tabs: tabsOf(groupId),
            activePath: activePathOf(groupId),
            document,
            editorId: resolutionOf(groupId, activePathOf(groupId))?.id ?? null,
            menus: menusOf(groupId),
            actions: runtime.actions,
            busy,
            diagnosis: diagnoseOf(groupId),
        };
    };

    const groups = computed<EditorGroupPresentation[]>(() => store.editorGroups.map((group) => presentationOf(group.id)));

    /** 命令宿主需要的活动组绑定：只暴露目标与句柄，不暴露会话。 */
    const activeBinding = computed<CommandEditorBinding | null>(() => {
        const groupId = store.activeEditorGroupId;
        const runtime = runtimes[groupId];
        const target = documentTargetOf(groupId);
        if (!runtime?.handle || !target) return null;
        return {target, handle: runtime.handle, readonly: groupIsLoading(groupId)};
    });

    /** 视图实例的回执入口：Store 判定 accepted/conflict/stale，这里补上视图层事实（语言/只读）。 */
    function commitChange(groupId: string, request: EditorChangeRequest): EditorChangeResult {
        const outcome = store.commitEditorChange(request);
        if (outcome.status === "stale") return {status: "stale"};
        const resolution = resolutionOf(groupId, request.target.path);
        return {
            status: outcome.status,
            snapshot: {
                target: outcome.snapshot.target,
                content: outcome.snapshot.content,
                contentRevision: outcome.snapshot.contentRevision,
                languageId: resolution?.languageId ?? "plaintext",
                readonly: groupIsLoading(groupId),
            },
        };
    }

    function bindViewHandle(groupId: string, target: EditorDocumentTarget, token: string, handle: EditorViewHandle | null): void {
        const runtime = runtimeOf(groupId);
        if (!handle) {
            if (runtime.token === token) {
                runtime.releaseFlush?.();
                runtime.handle = null;
                runtime.token = null;
                runtime.releaseFlush = null;
                runtime.actions = [];
            }
            return;
        }
        if (runtime.token === token && runtime.handle === handle) return;
        runtime.releaseFlush?.();
        runtime.handle = handle;
        runtime.token = token;
        runtime.actions = [];
        runtime.error = null;
        runtime.releaseFlush = store.registerEditorFlush(target, token, () => handle.flushPendingChange());
        if (groupId === store.activeEditorGroupId) {
            void nextTick(() => {
                if (runtimes[groupId]?.token === token) handle.focus();
            });
        }
    }

    function setActions(groupId: string, _target: EditorDocumentTarget, token: string, actions: readonly EditorAction[]): void {
        const runtime = runtimeOf(groupId);
        if (runtime.token === token) runtime.actions = actions;
    }
    function setFocus(groupId: string, _target: EditorDocumentTarget, _token: string, focused: boolean): void {
        if (groupId === store.activeEditorGroupId) editorFocused.value = focused;
    }
    function viewError(groupId: string, _target: EditorDocumentTarget, token: string, message: string): void {
        const runtime = runtimeOf(groupId);
        if (runtime.token === token) runtime.error = message;
    }
    function runViewAction(groupId: string, id: string): void {
        const runtime = runtimeOf(groupId);
        if (!runtime.handle) return;
        if (runtime.actions.some((action) => action.id === id && !action.disabled)) runtime.handle.runAction?.(id);
    }

    /** 结算某组（不传即全部）的待上报输入；conflict 表示有候选等待用户裁决。 */
    function flush(groupId?: string): EditorFlushResult {
        return store.flushEditorPending(groupId);
    }

    async function selectGroup(groupId: string): Promise<void> {
        if (store.activeEditorGroupId === groupId) return;
        if (flush(store.activeEditorGroupId) === "conflict") return;
        store.selectEditorGroup(groupId);
        editorFocused.value = false;
        const path = activePathOf(groupId);
        if (!path) return;
        if (!store.workspaceBuffers[path]) {
            await loadPath(groupId, path);
        }
    }

    /** 某组当前视图的展示名（状态栏与菜单共用；未解析时回退到源码视图）。 */
    function editorLabelOf(groupId: string): string | null {
        const id = presentationOf(groupId).editorId;
        if (!id) return null;
        const contribution = registry.get(id);
        return contribution ? t(contribution.titleKey) : id;
    }

    /** 把焦点交给某组的活动实例（面包屑等宿主入口用）；后台组先切为活动组。 */
    async function focusGroup(groupId: string): Promise<void> {
        if (store.activeEditorGroupId !== groupId) {
            await selectGroup(groupId);
            await nextTick();
        }
        runtimes[groupId]?.handle?.focus();
    }

    async function loadPath(groupId: string, path: string): Promise<void> {
        try {
            await store.selectWorkspacePathInGroup(groupId, path);
        } catch (error) {
            runtimeOf(groupId).error = resolveApiErrorMessage(error, t("editorWorkbench.loadFailed"));
        }
    }

    async function selectTab(groupId: string, path: string): Promise<void> {
        if (flush(groupId) === "conflict") return;
        runtimeOf(groupId).error = null;
        await loadPath(groupId, path);
    }

    async function switchEditor(groupId: string, id: string): Promise<void> {
        if (flush(groupId) === "conflict") return;
        const path = activePathOf(groupId);
        const buffer = store.workspaceBuffers[path];
        if (!path || !buffer?.node.editable) return;
        const languageId = resolutionOf(groupId, path)?.languageId ?? "plaintext";
        if (!registry.get(id)?.supports({path, languageId, editable: true})) return;
        runtimeOf(groupId).error = null;
        const target = store.editorDocumentTarget(path);
        resolutions.delete(resolutionKey(groupId, target.documentId));
        store.setWorkspaceTabEditor(groupId, path, id);
        await nextTick();
    }

    async function save(groupId?: string): Promise<boolean> {
        const targetGroup = groupId ?? store.activeEditorGroupId;
        if (flush(targetGroup) === "conflict") return false;
        const target = documentTargetOf(targetGroup);
        const buffer = target ? store.workspaceBuffers[target.path] : undefined;
        if (!target || !buffer?.node.editable) return false;
        const runtime = runtimeOf(targetGroup);
        runtime.error = null;
        try {
            const saved = await store.saveDocumentByTarget(target);
            if (!matchesEditorDocument(target, documentTargetOf(targetGroup))) return false;
            flush(targetGroup);
            const bufferAfter = store.workspaceBuffers[target.path];
            return saved !== null && Boolean(bufferAfter && bufferAfter.content === bufferAfter.lastSyncedContent);
        } catch (error) {
            if (matchesEditorDocument(target, documentTargetOf(targetGroup))) {
                runtime.error = resolveApiErrorMessage(error, t("editorWorkbench.saveFailed"));
            }
            return false;
        }
    }

    async function closeTab(groupId: string, path: string): Promise<void> {
        if (flush(groupId) === "conflict") return;
        const generation = store.workspaceGeneration;
        const tab = store.workspaceTabs.find((item) => item.editorGroupId === groupId && item.path === path);
        if (!tab) return;
        if (!tab.dirty) {
            await store.closeWorkspaceTab(groupId, path);
            return;
        }
        const choice = await options.chooseClose(tab.title);
        if (generation !== store.workspaceGeneration || !store.workspaceTabs.some((item) => item.editorGroupId === groupId && item.path === path)) return;
        if (choice === "discard") {
            await store.closeWorkspaceTab(groupId, path, true);
            return;
        }
        if (choice !== "save") return;
        if ((activePathOf(groupId)) !== path) await selectTab(groupId, path);
        if (generation !== store.workspaceGeneration || activePathOf(groupId) !== path) return;
        if (await save(groupId)) await store.closeWorkspaceTab(groupId, path);
    }

    /** 关闭整组：逐标签走既有关闭流程；任一标签被取消（脏且未确认）就保留整组。 */
    async function closeGroup(groupId: string): Promise<void> {
        const paths = store.editorGroups.find((group) => group.id === groupId)?.tabs.map((tab) => tab.path) ?? [];
        for (const path of paths) {
            if (!store.workspaceTabs.some((tab) => tab.editorGroupId === groupId && tab.path === path)) continue;
            await closeTab(groupId, path);
            if (store.workspaceTabs.some((tab) => tab.editorGroupId === groupId && tab.path === path)) return;
        }
    }

    /** 新组 id：跳过已占用的编号（恢复出来的组可能已经叫 g2、g3）。 */
    function nextGroupId(): string {
        let candidate = `g${++groupSequence}`;
        while (store.editorGroups.some((group) => group.id === candidate)) {
            candidate = `g${++groupSequence}`;
        }
        return candidate;
    }

    /**
     * 分屏唯一入口：模式由载荷给出，不由宿主猜测。
     * 工具栏复制（`source === target` 且 `copy`）保留来源标签的第二视图；拖到组边缘是 `move`，
     * 源组因此为空时塌陷。唯一标签拖到本组边缘在事件边界就不发意图，这里只执行收到的载荷。
     */
    function splitToEdge(payload: EditorSplitPayload): boolean {
        if (flush(payload.sourceGroupId) === "conflict") return false;
        return store.splitEditorTab({...payload, newGroupId: nextGroupId()});
    }
    function transfer(payload: Readonly<TabTransferPayload>): boolean {
        if (flush(payload.sourceGroupId) === "conflict") return false;
        return store.transferEditorTab(payload);
    }
    function moveTab(groupId: string, path: string, targetPath: string | null, targetPinned: boolean, position: "before" | "after"): void {
        store.moveWorkspaceTab(groupId, path, targetPath, targetPinned, position);
    }
    function setPin(groupId: string, path: string, pinned: boolean): void {
        store.setWorkspaceTabPinned(groupId, path, pinned);
    }
    function keepTab(groupId: string, path: string): void {
        store.keepWorkspaceTab(groupId, path);
    }

    function menusOf(groupId: string): MenubarMenuData[] {
        const path = activePathOf(groupId);
        const buffer = store.workspaceBuffers[path];
        const resolution = resolutionOf(groupId, path);
        const resource = buffer?.node.editable && resolution ? {path, editable: true, languageId: resolution.languageId} : null;
        return [{id: "file", label: t("editorWorkbench.file"), items: [
            {value: "save", label: t("editorWorkbench.save"), shortcut: "Ctrl+S", disabled: !buffer?.node.editable || store.savingFile},
            {value: "close", label: t("editorWorkbench.close"), disabled: !path},
            {value: "reload", label: t("editorWorkbench.reloadConfiguration"), disabled: config.loading.value},
        ]}, {id: "open-with", label: t("editorWorkbench.openWith"), disabled: !buffer?.node.editable, items: (resource ? registry.available(resource) : [registry.get("code")!]).map((entry) => ({
            value: `editor:${entry.id}`, label: t(entry.titleKey), checked: entry.id === resolution?.id, type: "checkbox" as const,
        }))}, ...(runtimeOf(groupId).actions.length ? [{id: "view-actions", label: t("editorWorkbench.viewActions"), items: runtimeOf(groupId).actions.map((action) => ({...action, value: `action:${action.id}`, type: action.checked === undefined ? "default" as const : "checkbox" as const}))}] : [])];
    }

    async function selectMenu(groupId: string, item: MenubarItemData): Promise<void> {
        if (item.disabled) return;
        if (item.value === "save") await save(groupId);
        else if (item.value === "close") await closeTab(groupId, activePathOf(groupId));
        else if (item.value === "reload") await config.reload();
        else if (item.value.startsWith("editor:")) await switchEditor(groupId, item.value.slice(7));
        else if (item.value.startsWith("action:")) runViewAction(groupId, item.value.slice(7));
    }

    function runViewActionById(groupId: string, id: string): void {
        runViewAction(groupId, id);
    }

    async function retry(groupId: string): Promise<void> {
        runtimeOf(groupId).error = null;
        if (engineError.value) await loadLanguages();
        await config.reload();
        const path = activePathOf(groupId);
        const buffer = store.workspaceBuffers[path];
        if (path && buffer?.node.editable) {
            const target = store.editorDocumentTarget(path);
            resolutions.delete(resolutionKey(groupId, target.documentId));
            await nextTick();
        }
        if (groupErrorOf(groupId) && path) await loadPath(groupId, path);
    }

    /** 冲突裁决：把请求交给持有该实例的组；adopt-current 由 Store 侧丢弃登记，keep-view 等实例重提。 */
    function resolveConflict(groupId: string, token: string, choice: "adopt-current" | "keep-view"): void {
        conflictRequest.value = {groupId, token, choice};
    }
    /** 宿主执行完裁决后的回报：adopt-current 立即清登记（采用当前正文），keep-view 等受理回执清。 */
    function acknowledgeConflict(token: string, result: EditorFlushResult): void {
        const request = conflictRequest.value;
        if (request?.token === token && request.choice === "adopt-current") {
            store.discardUnresolvedEditorChange(token);
        }
        if (conflictRequest.value?.token === token) {
            conflictRequest.value = null;
        }
        if (result === "conflict") {
            // 仍未解决：保持登记，等用户再次裁决。
        }
    }

    onScopeDispose(() => {
        disposed = true;
        for (const runtime of Object.values(runtimes)) runtime.releaseFlush?.();
    });

    /**
     * 未解决输入的呈现：带上持有该实例的组，页面据此把裁决送回正确的宿主。
     * 找不到组的（实例已卸载）标记为 null，页面只提示、不提供裁决。
     */
    const unresolvedChanges = computed(() => store.unresolvedEditorChanges.map((change) => ({
        token: change.token,
        path: change.target.path,
        groupId: Object.keys(runtimes).find((groupId) => runtimes[groupId]?.token === change.token) ?? null,
    })));

    /**
     * 分栏手势的宿主接缝：工作面身份与编辑会话修订一起构成"按下时的外部事实"，
     * 渲染层据此作废跨上下文的进行中手势；落账只有 `acceptGesture` 一个入口，
     * 一场手势（含交汇处两根轴）一次批量提交、一次修订。
     */
    const gestureContextKey = computed(() => store.currentWorkspaceRoot);
    const gestureRevision = computed(() => store.editorSessionRevision);

    return {
        registry,
        groupIds,
        groups,
        activeGroupId,
        editorFocused,
        editorTree: computed(() => store.editorTree),
        editorLayout: computed(() => store.editorLayout),
        editorGroupIds: computed(() => store.editorGroups.map((group) => group.id)),
        setContainer: (extent: {width: number; height: number}) => store.setEditorExtent(extent),
        gestureContextKey,
        gestureRevision,
        acceptGesture: store.commitEditorGesture,
        activeBinding,
        conflictRequest,
        unresolvedChanges,
        selectGroup,
        focusGroup,
        editorLabelOf,
        selectTab,
        closeTab,
        closeGroup,
        switchEditor,
        save,
        splitToEdge,
        transfer,
        moveTab,
        setPin,
        keepTab,
        flush,
        selectMenu,
        retry,
        runViewAction: runViewActionById,
        bindViewHandle,
        setActions,
        setFocus,
        viewError,
        commitChange,
        resolveConflict,
        acknowledgeConflict,
        undo: (groupId?: string) => runtimes[groupId ?? store.activeEditorGroupId]?.handle?.undo?.(),
        redo: (groupId?: string) => runtimes[groupId ?? store.activeEditorGroupId]?.handle?.redo?.(),
        presentationOf,
    };
}
