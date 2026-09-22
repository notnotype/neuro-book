import {onScopeDispose, ref, watch, type Ref} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

export type SectionDraft<TDraft, TPayload> = {
    /** 本地草稿；视图直接绑它，写回成功后由来源回声校正。 */
    draft: Ref<TDraft>;
    saving: Ref<boolean>;
    /** 非空表示上一次写回失败；草稿保留，改回原值或成功写回后自动清空。 */
    saveError: Ref<string>;
    /** 立即写一次（跳过防抖），用于切区段等需要确定性落盘的时机。 */
    flush: () => Promise<void>;
    /** 丢弃本地草稿，按当前来源重建（取代旧面板的 restoreSettings）。 */
    reset: () => void;
};

export type SectionDraftOptions<TDraft, TPayload, TContext = undefined> = {
    /**
     * 草稿来源（配置快照的某个段）。来源每次读取都是新引用，所以按 JSON 值判断变化，
     * 而不是按引用——这正是「写回成功 → revision 变更 → 快照重取」不打断输入的原因。
     */
    source: () => unknown;
    /** 来源 → 草稿（纯函数）。 */
    create: (source: unknown) => TDraft;
    /** 草稿 → 写回体（纯函数）；`context` 同上，作用域决定写回哪个段时用它。 */
    toPayload: (draft: TDraft, context: TContext) => TPayload;
    /**
     * 写回；`context` 是构建这份草稿时捕获的上下文（例如当时的作用域与查询），
     * 于是晚到的防抖写回仍落在正确的目标上——宿主因此可以立刻切作用域，不必等写回。
     */
    write: (payload: TPayload, context: TContext) => Promise<unknown>;
    /** 每次按来源重建草稿时捕获一次上下文；不传则 `context` 为 undefined。 */
    captureContext?: () => TContext;
    /**
     * 写回失败时的上报口（宿主传 `notification.error`）。失败绝不能静默：
     * 视图不再内联保存状态，这里是唯一的用户可见失败通道。
     */
    notifyError?: (message: string) => void;
    /** 后端没有给出可读原因时用的本地化兜底文案（调用方传 `t(...)`）。 */
    fallbackErrorMessage: string;
    /** 防抖窗口，默认 500ms。 */
    delayMs?: number;
};

/**
 * 「受控视图草稿 → 防抖自动写回」的唯一实现。
 *
 * 状态机：草稿变化进入防抖；写回串行（在写期间的多次触发合并成一次补写）；
 * 写回体与最近一次从配置派生的写回体相等时跳过（挂载、切作用域回声、改回原值都不写盘）。
 * 失败只记录 saveError 并发系统通知，不回滚草稿。
 */
export function useSectionDraft<TDraft, TPayload, TContext = undefined>(options: SectionDraftOptions<TDraft, TPayload, TContext>): SectionDraft<TDraft, TPayload> {
    const delayMs = options.delayMs ?? 500;
    const draft = ref(options.create(options.source())) as Ref<TDraft>;
    const saving = ref(false);
    const saveError = ref("");
    /** 构建这份草稿时捕获的写回上下文；草稿换来源时一起换。 */
    let writeContext = options.captureContext?.() as TContext;
    /** 最近一次从配置派生的写回体；与它相等说明没有需要落盘的改动。 */
    let baseline = JSON.stringify(options.toPayload(draft.value, writeContext));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let writing: Promise<void> | null = null;
    let queued = false;

    function cancelTimer(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    async function writeNow(payload: TPayload): Promise<void> {
        saving.value = true;
        saveError.value = "";
        try {
            await options.write(payload, writeContext);
            baseline = JSON.stringify(payload);
        } catch (error) {
            // 失败走系统通知：区段视图不再内联保存状态，静默失败是不可接受的。
            saveError.value = resolveApiErrorMessage(error, options.fallbackErrorMessage);
            options.notifyError?.(saveError.value);
        } finally {
            saving.value = false;
        }
    }

    async function flush(): Promise<void> {
        cancelTimer();
        if (writing) {
            queued = true;
            return writing;
        }
        const payload = options.toPayload(draft.value, writeContext);
        if (JSON.stringify(payload) === baseline) {
            saveError.value = "";
            return;
        }
        writing = writeNow(payload).finally(() => {
            writing = null;
            if (queued) {
                queued = false;
                void flush();
            }
        });
        return writing;
    }

    watch(draft, () => {
        cancelTimer();
        timer = setTimeout(() => {
            timer = null;
            void flush();
        }, delayMs);
    }, {deep: true});

    watch(() => JSON.stringify(options.source()), () => {
        const next = options.create(options.source());
        // 判「草稿是否干净」必须用旧上下文：当前草稿的写回体是按旧上下文算出来的，
        // 拿新上下文去比会因为基准段不同而永远不相等，于是永远判脏、每次切档都写盘。
        const nextPayload = JSON.stringify(options.toPayload(next, writeContext));
        const clean = JSON.stringify(options.toPayload(draft.value, writeContext)) === baseline;
        // 只有干净的草稿才接受来源：写回成功后的快照回声、以及编译状态轮询引起的重取，
        // 都不该覆盖用户正在编辑的内容。源不可接受时连上下文也不换——草稿还是原来那份。
        if (!clean) {
            return;
        }
        writeContext = options.captureContext?.() as TContext;
        baseline = JSON.stringify(options.toPayload(next, writeContext));
        if (JSON.stringify(next) !== JSON.stringify(draft.value)) {
            draft.value = next;
        }
    });

    function reset(): void {
        cancelTimer();
        saveError.value = "";
        draft.value = options.create(options.source());
        writeContext = options.captureContext?.() as TContext;
        baseline = JSON.stringify(options.toPayload(draft.value, writeContext));
    }

    onScopeDispose(cancelTimer);

    return {draft, saving, saveError, flush, reset};
}
