/** Session Current Project 无法继续执行时的稳定领域错误。 */
export class SessionCurrentProjectError extends Error {
    readonly statusCode = 409;

    constructor(
        readonly code: "current_project_missing" | "migration_review_required" | "current_project_rebind_forbidden",
        message: string,
        readonly projectRoot?: string,
    ) {
        super(message);
        this.name = "SessionCurrentProjectError";
    }
}

/** 跨HMR/HTTP seam按稳定name与code识别Session Current Project错误。 */
export function isSessionCurrentProjectError(error: unknown): error is SessionCurrentProjectError {
    if (!(error instanceof Error) || error.name !== "SessionCurrentProjectError" || !("code" in error)) return false;
    const code = error.code;
    return code === "current_project_missing"
        || code === "migration_review_required"
        || code === "current_project_rebind_forbidden";
}
