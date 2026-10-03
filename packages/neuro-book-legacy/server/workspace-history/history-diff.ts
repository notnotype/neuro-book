import type {TextDiffResult, WorkspaceHistory} from "@notnotype/nb-history";
import type {WorkspaceHistoryInboxGroupDto, WorkspaceHistoryDiffDto} from "nbook/shared/dto/workspace-history.dto";

export type WorkspaceHistoryDiffMode = "inline" | "full";
type WorkspaceHistoryDiffTarget = Pick<WorkspaceHistoryInboxGroupDto, "path" | "baseHash" | "endHash">;

const INLINE_MAX_BYTES = 24 * 1024;
const INLINE_MAX_CHANGED_LINES = 120;

const SENSITIVE_BASENAMES = new Set([
    ".envrc",
    ".git-credentials",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "credentials",
    "credentials.json",
    "credential.json",
    "application_default_credentials.json",
    "application-default-credentials.json",
    "service-account.json",
    "service_account.json",
    "service-account-key.json",
    "service_account_key.json",
    "secret.json",
    "secrets.json",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
]);

const SENSITIVE_DIRECTORY_SEGMENTS = new Set([".ssh", ".aws", ".azure", ".kube", ".docker", ".gnupg"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"]);

/**
 * 判断 history diff 是否属于禁止向浏览器返回正文的敏感路径。
 * 这是服务端安全边界；前端只能消费结果，不能自行放宽。
 */
export function isSensitiveHistoryDiffPath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/gu, "").toLowerCase();
    const segments = normalized.split("/").filter(Boolean);
    const basename = segments.at(-1) ?? "";
    if (isEnvironmentFileName(basename)) {
        return true;
    }
    if (SENSITIVE_BASENAMES.has(basename)) {
        return true;
    }
    const extensionIndex = basename.lastIndexOf(".");
    const extension = extensionIndex >= 0 ? basename.slice(extensionIndex) : "";
    if (SENSITIVE_EXTENSIONS.has(extension)) {
        return true;
    }
    return segments.some((segment) => SENSITIVE_DIRECTORY_SEGMENTS.has(segment));
}

/** `.env`、`.env.local`、`.env-production`、`.envrc` 与 `production.env` 均视为环境凭据文件。 */
function isEnvironmentFileName(basename: string): boolean {
    return basename === ".envrc"
        || basename === ".env"
        || basename.startsWith(".env.")
        || (basename.startsWith(".env-") && !basename.slice(".env-".length).includes("."))
        || basename.endsWith(".env");
}

/**
 * 读取一个已由 inbox 授权的文件 diff，并应用敏感路径与 inline 大小策略。
 */
export async function readWorkspaceHistoryDiff(input: {
    history: Pick<WorkspaceHistory, "textDiff">;
    group: WorkspaceHistoryDiffTarget;
    mode: WorkspaceHistoryDiffMode;
}): Promise<WorkspaceHistoryDiffDto> {
    if (isSensitiveHistoryDiffPath(input.group.path)) {
        return {status: "blocked", reason: "sensitive_path"};
    }
    const result = await input.history.textDiff(input.group.baseHash, input.group.endHash);
    if (!result.available) {
        return {status: "unavailable", reason: result.reason};
    }
    return toAvailableDiff(result, input.mode);
}

function toAvailableDiff(result: Extract<TextDiffResult, {available: true}>, mode: WorkspaceHistoryDiffMode): WorkspaceHistoryDiffDto {
    const byteSize = new TextEncoder().encode(result.beforeText).byteLength
        + new TextEncoder().encode(result.afterText).byteLength;
    const changedLineCount = result.changes.reduce((total, change) => {
        if (!change.added && !change.removed) {
            return total;
        }
        return total + (change.count ?? countLines(change.value));
    }, 0);
    if (mode === "inline" && (byteSize > INLINE_MAX_BYTES || changedLineCount > INLINE_MAX_CHANGED_LINES)) {
        return {
            status: "too_large",
            reason: "inline_limit",
            byteSize,
            changedLineCount,
        };
    }
    return {
        status: "available",
        original: result.beforeText,
        modified: result.afterText,
        changes: result.changes,
        byteSize,
        changedLineCount,
    };
}

function countLines(value: string): number {
    if (!value) {
        return 0;
    }
    const lineBreaks = value.match(/\n/gu)?.length ?? 0;
    return lineBreaks + (value.endsWith("\n") ? 0 : 1);
}
