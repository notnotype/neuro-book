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
    /** 目标进程的 pid：目标创建后 resolve；目标没创建成功就收口时 resolve 为 null。 */
    rootPid: Promise<number | null>;
    /**
     * 监督进程的 pid（拉起失败时为 null）。监督进程握着收口用的句柄（Windows 的 Job Object 唯一句柄）：`completion` 失败、
     * 所有权确认不了时，调用方可以结束它来收掉整棵树（Windows 上 Job 句柄关闭即结束全部成员），再自己确认它不在了。
     */
    supervisorPid: number | null;
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
