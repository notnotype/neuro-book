/**
 * 编辑器变更上报防抖。
 *
 * 大文档下每次按键做全文序列化 / 全文 getValue 是输入卡顿的主因，
 * TipTap 与 Monaco 统一走本协议：输入时只 schedule，停顿 delayMs 后才读值上报；
 * 失焦、保存快捷键、外部同步覆盖、组件卸载等边界由调用方选择 flush / cancel。
 *
 * ⚠️ flush 语义约定（与 novel-ide store 的 activeEditorFlush 钩子配合）：
 * 切换文件、磁盘同步等会读取 store 内容的路径，必须先经 store 钩子触发 flush，
 * 保证 store 拿到编辑器最新内容后再做 dirty 判定 / buffer 持久化，
 * 否则防抖窗口内的输入会被误判为「无修改」而丢失（文本回退 bug 的根源）。
 */
export interface EditorChangeDebounce {
    /** 排一次防抖上报；输入事件里调用 */
    schedule: () => void;
    /** 立即读值上报（无论是否有 pending）；评论增删改等低频编辑操作用 */
    emitNow: () => void;
    /** 有 pending 才读值上报；blur / 保存快捷键 / store flush 钩子用 */
    flush: () => void;
    /** 丢弃 pending（外部权威内容即将覆盖本地状态时用） */
    cancel: () => void;
    /** 是否存在未上报的输入 */
    pending: () => boolean;
}

interface EditorChangeDebounceOptions {
    /** 防抖窗口，默认 300ms */
    delayMs?: number;
    /** 读取编辑器当前值；返回 null 表示编辑器不可用，本次上报跳过 */
    readValue: () => string | null;
    /** 上报出口（emit change 等） */
    onEmit: (value: string) => void;
}

export function useEditorChangeDebounce(options: EditorChangeDebounceOptions): EditorChangeDebounce {
    const delayMs = options.delayMs ?? 300;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;

    const clearTimer = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const emitNow = (): void => {
        clearTimer();
        pending = false;
        const value = options.readValue();
        if (value === null) {
            return;
        }
        options.onEmit(value);
    };

    return {
        schedule: () => {
            pending = true;
            clearTimer();
            timer = setTimeout(emitNow, delayMs);
        },
        emitNow,
        flush: () => {
            if (!pending) {
                return;
            }
            emitNow();
        },
        cancel: () => {
            clearTimer();
            pending = false;
        },
        pending: () => pending,
    };
}
