/**
 * 桌面快捷方式的同步（docs/specs/runtime/desktop-shell.md 输出 33）：页面每交来一次值，按这次与上一次的值决定要不要动桌面上的
 * `NeuroBook.lnk`；真正的读写由 Windows 端口（`desktop/src/bun/desktop-shortcut.ts`）在一条命令里先重查再动手。
 *
 * 动作串行：同一时刻只有一次在做，排队的只留最新的一个。两次相反的改动若并行，先发的“建”可能在后发的“删”之后才落盘，桌面上
 * 的结果就和最后的值不一致；每次动作又都先重查现状，所以只做最新的那一个就够了。
 */

export type ShortcutAction = "ensure-absent" | "ensure-present";

export interface ShortcutDecision {
    /** 页面交来的值。 */
    readonly value: boolean;
    /** 本进程里上一次收到的值；这次运行第一次收到为 null。不取壳的缓存：缓存是上次运行的，拿它当上一次会在启动时补建。 */
    readonly previous: boolean | null;
    /** 这次运行是安装版、状态根来自缺省位置（输出 34 的“安装事实”）。 */
    readonly applies: boolean;
}

/** 关着时每次都确保没有（更新换上后又出现的那个由第一次收到的值删掉）；只有这次运行里从关改成开才补建。 */
export function desktopShortcutAction(decision: ShortcutDecision): ShortcutAction | null {
    if (!decision.applies) return null;
    if (!decision.value) return "ensure-absent";
    return decision.previous === false ? "ensure-present" : null;
}

/**
 * 端口做完一次动作的结果：删掉了、建出来了、本来就没有、本来就有（指向本安装），或同名文件不是本安装的快捷方式而没动。
 * 失败的原因只进日志。
 */
export type ShortcutResult =
    | {readonly ok: true; readonly outcome: "removed" | "created" | "absent" | "present" | "kept-other"}
    | {readonly ok: false; readonly reason: string};

export interface ShortcutPort {
    /** 做一次动作；`signal` abort 时尽快结束（Windows 端口结束它起的 PowerShell 进程），结果按失败交回。 */
    apply(action: ShortcutAction, signal: AbortSignal): Promise<ShortcutResult>;
}

export interface ShortcutSync {
    /** 排一个动作；前一个还在做时只留最新的一个。关闭之后不再接。 */
    request(action: ShortcutAction): void;
    /** 不再接新动作，丢掉排队的；在做的那一次最多等 `deadlineMs`，到时 abort 它，再等它结束。 */
    close(deadlineMs: number): Promise<void>;
}

export function createShortcutSync(port: ShortcutPort, report: (line: string) => void): ShortcutSync {
    const stop = new AbortController();
    let pending: ShortcutAction | null = null;
    let running: Promise<void> | null = null;
    let closed = false;

    const drain = async (): Promise<void> => {
        while (pending !== null && !closed) {
            const action = pending;
            pending = null;
            try {
                const result = await port.apply(action, stop.signal);
                report(result.ok ? `desktop.shortcut.${result.outcome} action=${action}` : `desktop.shortcut.failed action=${action} ${result.reason}`);
            } catch (error) {
                report(`desktop.shortcut.failed action=${action} ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        running = null;
    };

    return {
        request(action) {
            if (closed) return;
            pending = action;
            running ??= drain();
        },
        async close(deadlineMs) {
            closed = true;
            pending = null;
            const inFlight = running;
            if (inFlight === null) return;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const expired = new Promise<"expired">((resolve) => {
                timer = setTimeout(() => resolve("expired"), deadlineMs);
            });
            const first = await Promise.race([inFlight.then(() => "done" as const), expired]);
            clearTimeout(timer);
            if (first === "expired") {
                stop.abort();
                await inFlight;
            }
        },
    };
}
