import {createError, type H3Error} from "h3";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";
import {
    isProjectLifecycleError,
    isProjectLifecycleLockReleaseFailedError,
    isProjectLifecycleTransactionError,
    type ProjectLifecycleErrorCode,
    type ProjectLifecycleOperation,
    type ProjectLifecycleTransactionErrorCode,
    type ProjectLifecycleTransactionPhase,
} from "nbook/server/workspace-files/project-lifecycle";
import {
    isProjectInUseError,
    isProjectLockCompromisedError,
    isProjectLockReleaseFailedError,
    type ProjectLockKind,
} from "nbook/server/workspace-files/project-lock";
import {
    isProjectNotReadyError,
    isProjectSessionCloseError,
    isProjectSessionExistsError,
    isProjectSessionOpenError,
    isProjectSessionRuntimeClosedError,
} from "nbook/server/workspace-files/project-session-runtime";
import {isProjectNotOpenError} from "nbook/server/workspace-files/project-session-service";

type ProjectLifecycleHttpErrorData = {
    readonly code: ProjectLifecycleErrorCode;
};

type ProjectTransactionHttpErrorData = {
    readonly code: ProjectLifecycleTransactionErrorCode;
    readonly operation: ProjectLifecycleOperation;
    readonly phase: ProjectLifecycleTransactionPhase;
    readonly committed: boolean | "unknown";
};

type ProjectLockReleaseHttpErrorData = {
    readonly code: "PROJECT_LOCK_RELEASE_FAILED";
    readonly kind: ProjectLockKind;
    readonly staleMs: number;
    /** 仅在值仍是合法单段 Project root 时公开。 */
    readonly projectRoot?: string;
    /** 仅 Lifecycle mutation release failure 非空。 */
    readonly operation?: ProjectLifecycleOperation;
    /** 仅 Lifecycle mutation release failure 非空。 */
    readonly phase?: "release";
    /** 仅 Lifecycle mutation release failure 非空。 */
    readonly committed?: boolean | "unknown";
};

type ProjectRootHttpErrorData = {
    readonly code:
        | "PROJECT_IN_USE"
        | "PROJECT_SESSION_CLOSE_FAILED"
        | "PROJECT_SESSION_EXISTS"
        | "PROJECT_SESSION_OPEN_FAILED"
        | "PROJECT_NOT_OPEN";
    /** 异常对象携带非法 locator 时省略，避免把绝对路径带进 HTTP data。 */
    readonly projectRoot?: string;
};

type ProjectServiceHttpErrorData = {
    readonly code: "PROJECT_LOCK_COMPROMISED" | "PROJECT_SESSION_RUNTIME_CLOSED";
};

/** Project 控制面允许公开的全部 typed error data；不包含 cause 或 Module failure。 */
export type ProjectHttpErrorData =
    | ProjectLifecycleHttpErrorData
    | ProjectTransactionHttpErrorData
    | ProjectLockReleaseHttpErrorData
    | ProjectRootHttpErrorData
    | ProjectServiceHttpErrorData;

/**
 * 将已知 Project 领域错误映射为 H3 error；未知错误返回 null，由 route 原样抛出。
 *
 * 判定顺序必须先覆盖派生类，尤其 Lifecycle release failure 不能降级成普通 Lock failure。
 */
export function createProjectHttpError(error: unknown): H3Error<ProjectHttpErrorData> | null {
    if (isProjectLifecycleLockReleaseFailedError(error)) {
        return projectError(
            error.statusCode,
            "Project lock release failed",
            "Project 操作已结束，但协作锁释放状态无法确认",
            {
                code: error.code,
                kind: error.kind,
                staleMs: error.staleMs,
                ...safeProjectRootData(error.projectRoot),
                operation: error.operation,
                phase: error.phase,
                committed: error.committed,
            },
        );
    }
    if (isProjectLifecycleTransactionError(error)) {
        return projectError(
            error.statusCode,
            "Project transaction failed",
            transactionMessage(error.code),
            {
                code: error.code,
                operation: error.operation,
                phase: error.phase,
                committed: error.committed,
            },
        );
    }
    if (isProjectInUseError(error)) {
        return projectError(
            error.statusCode,
            "Project in use",
            "Project 正在被另一个 NeuroBook 或 workspace CLI 进程使用",
            {
                code: error.code,
                ...safeProjectRootData(error.projectRoot),
            },
        );
    }
    if (isProjectLockReleaseFailedError(error)) {
        return projectError(
            error.statusCode,
            "Project lock release failed",
            "Project 协作锁释放状态无法确认",
            {
                code: error.code,
                kind: error.kind,
                staleMs: error.staleMs,
                ...safeProjectRootData(error.projectRoot),
            },
        );
    }
    if (isProjectLockCompromisedError(error)) {
        return projectError(
            409,
            "Project lock compromised",
            "Project 协作锁已经失效，请重新打开 Project",
            {code: error.code},
        );
    }
    if (isProjectSessionOpenError(error)) {
        return projectError(
            error.statusCode,
            "Project session open failed",
            "Project Session 启动失败，请检查 Project 后重试",
            {
                code: error.code,
                ...safeProjectRootData(error.projectRoot),
            },
        );
    }
    if (isProjectSessionExistsError(error)) {
        return projectError(
            error.statusCode,
            "Project session exists",
            "Project Session 已存在，请重试打开操作",
            {
                code: error.code,
                ...safeProjectRootData(error.projectRoot),
            },
        );
    }
    if (isProjectSessionCloseError(error)) {
        return projectError(
            error.statusCode,
            "Project session close failed",
            "Project Session 关闭不完整，请稍后重试",
            {
                code: error.code,
                ...safeProjectRootData(error.projectRoot),
            },
        );
    }
    if (isProjectSessionRuntimeClosedError(error)) {
        return projectError(
            error.statusCode,
            "Project session runtime closed",
            "Project Session 服务正在关闭，请稍后重试",
            {code: error.code},
        );
    }
    if (isProjectNotReadyError(error)) {
        return projectError(
            409,
            "Project not open",
            "Project 未打开，请先打开 Project",
            {
                code: "PROJECT_NOT_OPEN",
                ...safeProjectRootData(error.projectRoot),
            },
        );
    }
    if (isProjectNotOpenError(error)) {
        return projectError(
            error.statusCode,
            "Project not open",
            "Project 未打开，请先打开 Project",
            {
                code: error.code,
                ...safeProjectRootData(error.projectRoot),
            },
        );
    }
    if (isProjectLifecycleError(error)) {
        return projectError(
            error.statusCode,
            "Project lifecycle error",
            lifecycleMessage(error.code),
            {code: error.code},
        );
    }
    return null;
}

/** 已知错误抛出映射后的 H3 error，未知错误保持原对象与堆栈。 */
export function throwProjectHttpError(error: unknown): never {
    throw createProjectHttpError(error) ?? error;
}

/** Project HTTP seam 的唯一异步 wrapper；未知错误保持原对象与堆栈。 */
export async function withProjectHttpError<TResult>(handler: () => Promise<TResult> | TResult): Promise<TResult> {
    try {
        return await handler();
    } catch (error) {
        throwProjectHttpError(error);
    }
}

/** 使用字符串入口避免 H3 把配置对象保存在 cause；随后只赋值白名单公开字段。 */
function projectError(
    statusCode: number,
    statusMessage: string,
    message: string,
    data: ProjectHttpErrorData,
): H3Error<ProjectHttpErrorData> {
    const error = createError<ProjectHttpErrorData>(message);
    error.statusCode = statusCode;
    error.statusMessage = statusMessage;
    error.data = data;
    return error;
}

/** 只允许经过最终 Project root DTO 校验的单段 locator 进入公开 error data。 */
function safeProjectRootData(projectRoot: string | undefined): {readonly projectRoot?: string} {
    const parsed = ProjectRootDtoSchema.safeParse(projectRoot);
    return parsed.success ? {projectRoot: parsed.data} : {};
}

/** Lifecycle identity/persistence error 使用固定公开文案，不复用可能携带路径的内部 message。 */
function lifecycleMessage(code: ProjectLifecycleErrorCode): string {
    const messages: Record<ProjectLifecycleErrorCode, string> = {
        INVALID_PROJECT_ROOT: "Project 目录名无效",
        PROJECT_ROOT_LINK_UNSUPPORTED: "Project 目录不能是链接或重解析点",
        PROJECT_ROOT_CASE_COLLISION: "Project 目录存在大小写冲突",
        PROJECT_ROOT_IO: "无法访问 Project 目录",
        PROJECT_ROOT_REPLACED: "Project 目录在操作期间发生变化",
        PROJECT_NOT_FOUND: "Project 不存在",
        PROJECT_MANIFEST_IO: "无法安全访问 Project manifest",
        PROJECT_MANIFEST_CONFLICT: "Project manifest 在操作期间发生变化",
        PROJECT_LIFECYCLE_CLOSED: "Project 生命周期服务已关闭",
    };
    return messages[code];
}

/** Mutation failure 使用固定公开文案，事务细节只通过白名单 data 字段表达。 */
function transactionMessage(code: ProjectLifecycleTransactionErrorCode): string {
    const messages: Record<ProjectLifecycleTransactionErrorCode, string> = {
        PROJECT_EXISTS: "Project 已存在",
        PROJECT_TEMPLATE_FAILED: "Project 模板初始化失败",
        PROJECT_IMPORT_FAILED: "Project 导入失败",
        PROJECT_VALIDATION_FAILED: "Project 请求无效",
        PROJECT_PUBLISH_FAILED: "Project 发布失败",
        PROJECT_ROLLBACK_FAILED: "Project 回滚失败",
    };
    return messages[code];
}
