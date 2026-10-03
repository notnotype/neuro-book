import type {InvocationErrorInfo, InvocationErrorPhase} from "nbook/server/agent/session/types";
import type {RunKernelPhase} from "nbook/server/agent/harness/run-kernel-types";
import {providerErrorText} from "nbook/server/agent/observability/provider-error-sanitizer";

/**
 * Run Kernel 内部 stage 抛错时使用的轻量包装。
 *
 * 它保留原始 cause，同时把错误归因固定到更准确的 kernel phase。
 */
export class RunKernelStageError extends Error {
    readonly phase: RunKernelPhase;
    override readonly cause: unknown;

    constructor(phase: RunKernelPhase, cause: unknown) {
        super(errorMessage(cause));
        this.name = "RunKernelStageError";
        this.phase = phase;
        this.cause = cause;
    }
}

/**
 * 包装一个 Run Kernel stage，确保 stage 内异常携带准确 phase。
 */
export async function withRunKernelPhase<T>(phase: RunKernelPhase, action: () => Promise<T>): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof RunKernelStageError) {
            throw error;
        }
        throw new RunKernelStageError(phase, error);
    }
}

/**
 * 将普通错误或 stage 包装错误转成 lifecycle 使用的结构化错误。
 */
export function toRunKernelErrorInfo(error: unknown, fallbackPhase: InvocationErrorPhase): InvocationErrorInfo {
    if (error instanceof RunKernelStageError) {
        return {
            message: error.message,
            phase: error.phase,
        };
    }
    return {
        message: errorMessage(error),
        phase: fallbackPhase,
    };
}

function errorMessage(error: unknown): string {
    return providerErrorText(error);
}
