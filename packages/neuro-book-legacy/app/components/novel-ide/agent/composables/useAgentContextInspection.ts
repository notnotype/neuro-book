import {ref, watch, type ComputedRef, type Ref} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {AgentContextInspectionDto} from "nbook/shared/dto/agent-context-inspection.dto";

export interface UseAgentContextInspectionOptions {
    open: Ref<boolean> | ComputedRef<boolean>;
    sessionId: Ref<number | null> | ComputedRef<number | null>;
}

export function useAgentContextInspection(options: UseAgentContextInspectionOptions) {
    const inspection = ref<AgentContextInspectionDto | null>(null);
    const loading = ref(false);
    const error = ref("");
    const selectedTraceId = ref<string | null>(null);
    let requestRevision = 0;

    /** 拉取面板数据。traceId 为空时后端取最近一次 turn。 */
    async function load(traceId?: string | null): Promise<void> {
        const sid = options.sessionId.value;
        if (sid === null || !options.open.value) {
            return;
        }
        const currentRevision = ++requestRevision;
        loading.value = true;
        error.value = "";
        try {
            const query = traceId ? {traceId} : undefined;
            const data = await $fetch<AgentContextInspectionDto>(
                `/api/agent/sessions/${encodeURIComponent(String(sid))}/context-inspection`,
                {query},
            );
            if (currentRevision !== requestRevision) {
                return;
            }
            inspection.value = data;
            // 未指定 traceId 时，将当前展示的 request id 同步到 selectedTraceId
            if (!traceId && data.selected?.traceId) {
                selectedTraceId.value = data.selected.traceId;
            }
        } catch (cause) {
            if (currentRevision !== requestRevision) {
                return;
            }
            error.value = resolveApiErrorMessage(cause, "拉取上下文检查数据失败");
        } finally {
            if (currentRevision === requestRevision) {
                loading.value = false;
            }
        }
    }

    function selectTrace(traceId: string | null): void {
        selectedTraceId.value = traceId;
        void load(traceId);
    }

    function refresh(): void {
        void load(selectedTraceId.value);
    }

    // 弹窗打开或 Session 改变时拉取
    watch([options.open, options.sessionId], ([isOpen, sid]) => {
        if (isOpen && sid !== null) {
            selectedTraceId.value = null;
            void load();
        } else if (!isOpen) {
            requestRevision++;
            inspection.value = null;
            error.value = "";
            loading.value = false;
        }
    }, {immediate: true});

    return {
        inspection,
        loading,
        error,
        selectedTraceId,
        selectTrace,
        refresh,
    };
}
