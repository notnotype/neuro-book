import {defineStore} from "pinia";
import type {ComfyUiJobDto} from "nbook/shared/dto/comfyui.dto";

/**
 * ComfyUI 生图运行态 store（不持久化）。
 *
 * 持有：生图参数草稿、引用来源与插入上下文、任务列表（SSE 同步）、连接状态。
 * 面板显隐的持久开关在 novel-ide store（comfyUiPanelOpen）；API 调用在面板组件内完成，
 * store 只承载跨组件共享的状态。
 */

/** 生成完成后图片的插入目标。markdown = 编辑器文档位置；rp = tick prose 锚点。 */
export type ComfyUiInsertTarget =
    | {kind: "markdown"; insertPos: number}
    | {kind: "rp"; tickDir: string; anchorText: string; occurrence: number};

/** 面板参数草稿。宽高步数等初始为 null，面板首次打开时从全局配置填充。 */
export type ComfyUiDraftParams = {
    positive: string;
    negative: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    /** null = 随机种子。 */
    seed: number | null;
    /** null = 内置模板。 */
    workflowId: string | null;
};

export const useComfyUiStore = defineStore("comfyUi", () => {
    /** 参数草稿；defaultsLoaded 表示已从全局配置初始化过一次。 */
    const params = ref<ComfyUiDraftParams>({
        positive: "",
        negative: "",
        width: 832,
        height: 1216,
        steps: 32,
        cfg: 4.5,
        seed: null,
        workflowId: null,
    });
    const defaultsLoaded = ref(false);

    /** 引用原文（选中文字），供蒸馏与面板展示。 */
    const sourceText = ref("");
    /** 生成完成后的插入目标；null 表示本次生图不插入正文（手动发起）。 */
    const insertTarget = ref<ComfyUiInsertTarget | null>(null);
    /** 本次生图归属的项目（图片落盘与 RP 写回都需要）。 */
    const projectPath = ref<string | null>(null);

    /** 任务列表（SSE 全量 + 增量维护），新在前。 */
    const jobs = ref<ComfyUiJobDto[]>([]);
    /** 面板正在追踪的任务 id（进度条与"插入"按钮的目标）。 */
    const activeJobId = ref<string | null>(null);
    const sseStatus = ref<"idle" | "connecting" | "connected" | "disconnected">("idle");

    const activeJob = computed(() => jobs.value.find((job) => job.jobId === activeJobId.value) ?? null);

    /** SSE snapshot：全量替换任务列表。 */
    function applySnapshot(items: ComfyUiJobDto[]): void {
        jobs.value = [...items].sort((left, right) => right.createdAt - left.createdAt);
    }

    /** SSE 增量：按 jobId 更新或插入。 */
    function applyJobUpdate(job: ComfyUiJobDto): void {
        const index = jobs.value.findIndex((item) => item.jobId === job.jobId);
        if (index >= 0) {
            jobs.value = jobs.value.map((item, itemIndex) => itemIndex === index ? job : item);
        } else {
            jobs.value = [job, ...jobs.value];
        }
    }

    /**
     * 从正文选区发起生图：记录引用文字、插入目标与项目，
     * 面板由调用方负责打开（novelIdeStore.comfyUiPanelOpen = true）。
     */
    function openForSelection(input: {target: ComfyUiInsertTarget; text: string; projectPath: string}): void {
        sourceText.value = input.text;
        insertTarget.value = input.target;
        projectPath.value = input.projectPath;
        activeJobId.value = null;
    }

    return {
        params,
        defaultsLoaded,
        sourceText,
        insertTarget,
        projectPath,
        jobs,
        activeJobId,
        activeJob,
        sseStatus,
        applySnapshot,
        applyJobUpdate,
        openForSelection,
    };
});
