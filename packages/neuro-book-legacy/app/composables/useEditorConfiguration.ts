import {onScopeDispose, readonly, ref, shallowRef, watch} from "vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {EditorAssociationSettings} from "nbook/shared/editor-associations";

export function useEditorConfiguration() {
    const store = useNovelIdeStore();
    const api = useConfigApi();
    const settings = shallowRef<EditorAssociationSettings | null>(null);
    const loading = ref(false);
    const diagnosis = ref<string | null>(null);
    let revision = 0;
    async function reload(): Promise<void> {
        const request = ++revision;
        const generation = store.workspaceGeneration;
        const query = api.currentQuery();
        loading.value = true;
        diagnosis.value = null;
        try {
            const response = await api.bootstrap(query);
            if (request === revision && generation === store.workspaceGeneration) settings.value = response.editor;
        } catch (error) {
            if (request === revision && generation === store.workspaceGeneration) diagnosis.value = resolveApiErrorMessage(error, "打开方式配置读取失败");
        } finally {
            if (request === revision) loading.value = false;
        }
    }
    watch(() => [store.workspaceKind, store.currentProjectRoot, store.workspaceGeneration, store.configRevision] as const, () => {
        settings.value = null;
        if (import.meta.client) void reload();
    }, {immediate: true});
    onScopeDispose(() => {revision += 1;});
    return {settings: readonly(settings), loading: readonly(loading), diagnosis: readonly(diagnosis), reload};
}
