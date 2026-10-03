/** Project typed error 的稳定精确种类；只用于进程内 nominal 判定，不进入 HTTP DTO。 */
export type ProjectDomainErrorKind =
    | "lifecycle"
    | "lifecycle-transaction"
    | "lifecycle-lock-release"
    | "lock-in-use"
    | "lock-compromised"
    | "lock-release"
    | "session-not-ready"
    | "session-exists"
    | "session-open"
    | "session-close"
    | "session-runtime-closed"
    | "session-not-open";

/**
 * Project typed error 的 HMR 稳定 nominal 基类定义。
 *
 * 具体错误 class 可以随模块重载，但旧 Service 与新 HTTP 模块必须共享同一个基类构造器，
 * 否则跨 reload 的 instanceof 会把已知领域错误误判为未知错误。
 */
class ProjectDomainErrorDefinition extends Error {
    declare readonly projectErrorKind: ProjectDomainErrorKind;

    /** 建立带 exact kind 的 Project 领域错误；kind 保持非枚举，避免意外进入响应。 */
    constructor(projectErrorKind: ProjectDomainErrorKind, message: string, options?: ErrorOptions) {
        super(message, options);
        Object.defineProperty(this, "projectErrorKind", {
            configurable: false,
            enumerable: false,
            value: projectErrorKind,
            writable: false,
        });
    }
}

type ProjectDomainErrorConstructor = typeof ProjectDomainErrorDefinition;

const globalForProjectDomainError = globalThis as typeof globalThis & {
    __nbookProjectDomainErrorV1?: ProjectDomainErrorConstructor;
};

/** 版本化全局构造器只保存 nominal identity，不持有 Lifecycle、Session 或文件资源。 */
export const ProjectDomainError = globalForProjectDomainError.__nbookProjectDomainErrorV1
    ??= ProjectDomainErrorDefinition;

export type ProjectDomainError = InstanceType<ProjectDomainErrorConstructor>;

/** 先验证 HMR 稳定基类，再比较 exact kind；不接受 name/code 形似的普通对象。 */
export function isProjectDomainError(
    error: unknown,
    projectErrorKind: ProjectDomainErrorKind,
): error is ProjectDomainError {
    return error instanceof ProjectDomainError && error.projectErrorKind === projectErrorKind;
}
