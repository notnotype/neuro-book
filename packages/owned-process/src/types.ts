import type {Readable, Writable} from "node:stream";

/** NeuroBook结束自有进程时记录的领域无关原因。 */
export type OwnedProcessTerminationReason =
    | "timeout"
    | "abort"
    | "cancel"
    | "shutdown"
    | "startup-failure"
    | "host-disconnect";

/** 自有进程成功收口后的唯一终态。 */
export type OwnedProcessCompletion = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    /** 仅主动终止时非空；自然退出时为空。 */
    terminationReason?: OwnedProcessTerminationReason;
};

export type OwnedProcessStdio = "pipe" | "inherit" | "ignore";

/** 调用方声明启动条件；平台所有权细节由Module隐藏。 */
export type OwnedProcessSpec = {
    command: string;
    args?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: "inherit" | "ignore" | "pipe";
    stdout?: OwnedProcessStdio;
    stderr?: OwnedProcessStdio;
    windowsHide?: boolean;
    /** 优雅退出等待窗口；默认500ms。 */
    graceMs?: number;
    /** 强制终止后的完成等待窗口；默认3000ms。 */
    hardKillWaitMs?: number;
};

/** 调用方持有的自有进程lease；终止操作幂等。 */
export type OwnedProcessLease = {
    stdin?: Writable;
    stdout?: Readable;
    stderr?: Readable;
    completion: Promise<OwnedProcessCompletion>;
    terminate(reason: OwnedProcessTerminationReason): Promise<OwnedProcessCompletion>;
};

/** 进程树所有权无法建立或无法确认收口。 */
export class OwnedProcessError extends Error {
    readonly stage: string;
    readonly osError?: number;

    /** 构造带平台阶段与可选OS错误码的所有权错误。 */
    constructor(message: string, input: {stage: string; osError?: number; cause?: unknown}) {
        super(message, input.cause === undefined ? undefined : {cause: input.cause});
        this.name = "OwnedProcessError";
        this.stage = input.stage;
        this.osError = input.osError;
    }
}
