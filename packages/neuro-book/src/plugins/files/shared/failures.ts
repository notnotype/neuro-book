/**
 * 真实目录型提供者的业务失败码（docs/specs/workspace/resources.md 的“失败与恢复”）。路由层的失败码（`denied`、
 * `unavailable`、`unknown-outcome` 等）不在这里：它们由内核给出，不能声明为业务失败码。
 */

export const FILES_FAILURES = [
    "invalid-address",
    "unknown-scheme",
    "root-gone",
    "outside-root",
    "protected-path",
    "permission-denied",
    "not-found",
    "not-a-file",
    "not-a-directory",
    "not-text",
    "too-large",
    "conflict",
    "into-itself",
    "source-changed",
    "unsupported",
    "invalid-order",
    "busy",
    "io-failed",
] as const;

export type FilesFailureCode = (typeof FILES_FAILURES)[number];
