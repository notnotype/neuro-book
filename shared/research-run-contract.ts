import {randomUUID} from "node:crypto";
import {mkdir, rename, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep, win32} from "node:path";

export const RESEARCH_RUN_MANIFEST_SCHEMA = "nbook.repository-research-run/v1";
export const REPOSITORY_RESEARCH_ADAPTER_SCHEMA = "nbook.repository-research-adapter/v1";

export type ResearchRunResult = "passed" | "environment-blocked" | "product-failure" | "unverified";

export type ResearchRunManifest = Readonly<{
    schema: typeof RESEARCH_RUN_MANIFEST_SCHEMA;
    runId: string;
    adapter: string;
    startedAt: string;
    finishedAt: string;
    repository: {root: string; revision: string | null; dirty: boolean | null};
    service: {
        mode: "product" | "source-dev";
        url: string;
        port: number;
        expectedVersion: string;
        startupNoncePresent: boolean;
        productAttempt: "not-attempted" | "ready" | "unavailable" | "failed";
        fallbackReason?: string;
    };
    browser: {
        executable: string | null;
        viewports: Array<{width: number; height: number; screenshot: string; horizontalOverflow: boolean}>;
        consoleErrors: number;
        pageErrors: number;
    };
    evidence: {files: string[]; mediaFiles: string[]};
    cleanup: {
        browser: "closed" | "killed" | "failed";
        service: "not-started" | "graceful" | "forced" | "failed";
        portClosed: boolean;
        ownedTempRootsRemoved: boolean;
        sharedCachePreserved: true;
    };
    result: {status: ResearchRunResult; reason?: string};
}>;

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const RELATIVE_EVIDENCE_PATTERN = /^(?!\.\.?$)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?![\\/])[A-Za-z0-9._/-]+$/u;
const MAX_VIEWPORTS = 4;
const MAX_EVIDENCE_FILES = 32;
const MAX_MEDIA_FILES = 4;

/** 严格解析来自文件或外部 adapter 的研究运行回执。 */
export function parseResearchRunManifest(value: unknown): ResearchRunManifest {
    const root = object(value, "Research Run Manifest");
    exactKeys(root, [
        "schema", "runId", "adapter", "startedAt", "finishedAt", "repository", "service", "browser", "evidence", "cleanup", "result",
    ], "Research Run Manifest");
    literal(root.schema, RESEARCH_RUN_MANIFEST_SCHEMA, "schema");
    const runId = safeRunId(root.runId);
    const adapter = nonEmptyString(root.adapter, "adapter");
    const startedAt = isoDate(root.startedAt, "startedAt");
    const finishedAt = isoDate(root.finishedAt, "finishedAt");
    const repository = parseRepository(root.repository);
    const service = parseService(root.service);
    const browser = parseBrowser(root.browser);
    const evidence = parseEvidence(root.evidence);
    const cleanup = parseCleanup(root.cleanup);
    const result = parseResult(root.result, cleanup);
    if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("finishedAt 不能早于 startedAt。");
    return {
        schema: RESEARCH_RUN_MANIFEST_SCHEMA,
        runId,
        adapter,
        startedAt,
        finishedAt,
        repository,
        service,
        browser,
        evidence,
        cleanup,
        result,
    };
}

/** 使用同目录随机临时文件与 rename 发布回执；写入失败不会覆盖旧文件。 */
export async function writeResearchRunManifest(path: string, manifest: ResearchRunManifest): Promise<void> {
    const target = resolve(path);
    if (!isAbsolute(path) || !target) throw new Error("Research Run Manifest 路径必须是绝对路径。");
    const parsed = parseResearchRunManifest(manifest);
    await mkdir(dirname(target), {recursive: true});
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(parsed, null, 4)}\n`, {encoding: "utf8", flag: "wx"});
        await rename(temporary, target);
    } finally {
        await rm(temporary, {force: true}).catch(() => undefined);
    }
}

function parseRepository(value: unknown): ResearchRunManifest["repository"] {
    const root = object(value, "repository");
    exactKeys(root, ["root", "revision", "dirty"], "repository");
    const repositoryRoot = absolutePath(root.root, "repository.root");
    const revision = root.revision === null ? null : nonEmptyString(root.revision, "repository.revision");
    const dirty = root.dirty === null ? null : booleanValue(root.dirty, "repository.dirty");
    return {root: repositoryRoot, revision, dirty};
}

function parseService(value: unknown): ResearchRunManifest["service"] {
    const root = object(value, "service");
    exactKeys(root, ["mode", "url", "port", "expectedVersion", "startupNoncePresent", "productAttempt"], "service", ["fallbackReason"]);
    const mode = member(root.mode, ["product", "source-dev"] as const, "service.mode");
    const url = loopbackUrl(root.url);
    const port = portNumber(root.port, "service.port");
    const expectedVersion = nonEmptyString(root.expectedVersion, "service.expectedVersion");
    const startupNoncePresent = booleanValue(root.startupNoncePresent, "service.startupNoncePresent");
    const productAttempt = member(root.productAttempt, ["not-attempted", "ready", "unavailable", "failed"] as const, "service.productAttempt");
    const fallbackReason = optionalString(root.fallbackReason, "service.fallbackReason");
    if (mode === "source-dev" && productAttempt === "ready") throw new Error("source-dev 服务不能把 Product attempt 标为 ready。");
    return {mode, url, port, expectedVersion, startupNoncePresent, productAttempt, ...(fallbackReason === undefined ? {} : {fallbackReason})};
}

function parseBrowser(value: unknown): ResearchRunManifest["browser"] {
    const root = object(value, "browser");
    exactKeys(root, ["executable", "viewports", "consoleErrors", "pageErrors"], "browser");
    const executable = root.executable === null
        ? null
        : absolutePath(root.executable, "browser.executable");
    if (!Array.isArray(root.viewports) || root.viewports.length < 1 || root.viewports.length > MAX_VIEWPORTS) {
        throw new Error(`browser.viewports 必须包含 1 到 ${String(MAX_VIEWPORTS)} 个视口。`);
    }
    const viewports = root.viewports.map((item, index) => {
        const viewport = object(item, `browser.viewports[${String(index)}]`);
        exactKeys(viewport, ["width", "height", "screenshot", "horizontalOverflow"], `browser.viewports[${String(index)}]`);
        const width = positiveInteger(viewport.width, `browser.viewports[${String(index)}].width`);
        const height = positiveInteger(viewport.height, `browser.viewports[${String(index)}].height`);
        const screenshot = evidencePath(viewport.screenshot, `browser.viewports[${String(index)}].screenshot`);
        const horizontalOverflow = booleanValue(viewport.horizontalOverflow, `browser.viewports[${String(index)}].horizontalOverflow`);
        return {width, height, screenshot, horizontalOverflow};
    });
    return {
        executable,
        viewports,
        consoleErrors: nonNegativeInteger(root.consoleErrors, "browser.consoleErrors"),
        pageErrors: nonNegativeInteger(root.pageErrors, "browser.pageErrors"),
    };
}

function parseEvidence(value: unknown): ResearchRunManifest["evidence"] {
    const root = object(value, "evidence");
    exactKeys(root, ["files", "mediaFiles"], "evidence");
    const files = evidencePaths(root.files, "evidence.files", MAX_EVIDENCE_FILES);
    const mediaFiles = absolutePaths(root.mediaFiles, "evidence.mediaFiles", MAX_MEDIA_FILES);
    return {files, mediaFiles};
}

function parseCleanup(value: unknown): ResearchRunManifest["cleanup"] {
    const root = object(value, "cleanup");
    exactKeys(root, ["browser", "service", "portClosed", "ownedTempRootsRemoved", "sharedCachePreserved"], "cleanup");
    const browser = member(root.browser, ["closed", "killed", "failed"] as const, "cleanup.browser");
    const service = member(root.service, ["not-started", "graceful", "forced", "failed"] as const, "cleanup.service");
    const portClosed = booleanValue(root.portClosed, "cleanup.portClosed");
    const ownedTempRootsRemoved = booleanValue(root.ownedTempRootsRemoved, "cleanup.ownedTempRootsRemoved");
    if (root.sharedCachePreserved !== true) throw new Error("cleanup.sharedCachePreserved 必须为 true。");
    return {browser, service, portClosed, ownedTempRootsRemoved, sharedCachePreserved: true};
}

function parseResult(value: unknown, cleanup: ResearchRunManifest["cleanup"]): ResearchRunManifest["result"] {
    const root = object(value, "result");
    exactKeys(root, ["status", "reason"], "result", ["reason"]);
    const status = member(root.status, ["passed", "environment-blocked", "product-failure", "unverified"] as const, "result.status");
    const reason = optionalString(root.reason, "result.reason");
    if (status === "passed" && (
        cleanup.browser === "failed"
        || cleanup.service === "failed"
        || !cleanup.portClosed
        || !cleanup.ownedTempRootsRemoved
        || cleanup.sharedCachePreserved !== true
    )) {
        throw new Error("cleanup 失败时不能把 Research Run 标为 passed。");
    }
    return {status, ...(reason === undefined ? {} : {reason})};
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
    return value as Record<string, unknown>;
}

function exactKeys(root: Record<string, unknown>, expected: readonly string[], label: string, optional: readonly string[] = []): void {
    const allowed = new Set([...expected, ...optional]);
    const actual = Object.keys(root).sort();
    const missing = expected.filter((key) => !Object.hasOwn(root, key) && !optional.includes(key));
    const unknown = actual.filter((key) => !allowed.has(key));
    if (missing.length || unknown.length) {
        throw new Error(`${label} 字段不匹配：missing=${missing.join(",") || "-"}; unknown=${unknown.join(",") || "-"}`);
    }
}

function literal(value: unknown, expected: string, label: string): void {
    if (value !== expected) throw new Error(`${label} 必须是 ${expected}。`);
}

function nonEmptyString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} 必须是非空字符串。`);
    assertPublicString(value, label);
    return value;
}

function optionalString(value: unknown, label: string): string | undefined {
    if (value === undefined) return undefined;
    return nonEmptyString(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") throw new Error(`${label} 必须是 boolean。`);
    return value;
}

function positiveInteger(value: unknown, label: string): number {
    if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${label} 必须是正整数。`);
    return value as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
    if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} 必须是非负整数。`);
    return value as number;
}

function portNumber(value: unknown, label: string): number {
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65_535) throw new Error(`${label} 必须在 1 到 65535 之间。`);
    return value as number;
}

function member<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
    if (typeof value !== "string" || !values.includes(value)) throw new Error(`${label} 值无效：${String(value)}`);
    return value as T[number];
}

function isoDate(value: unknown, label: string): string {
    const text = nonEmptyString(value, label);
    if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} 必须是 ISO 日期。`);
    return text;
}

function absolutePath(value: unknown, label: string): string {
    const text = nonEmptyString(value, label);
    if (!isAbsolutePath(text)) throw new Error(`${label} 必须是绝对路径。`);
    return resolve(text);
}

function loopbackUrl(value: unknown): string {
    const text = nonEmptyString(value, "service.url");
    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        throw new Error("service.url 必须是 URL。");
    }
    if (parsed.protocol !== "http:" || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "[::1]")) {
        throw new Error("service.url 必须是 loopback HTTP URL。");
    }
    return text;
}

function evidencePath(value: unknown, label: string): string {
    const text = nonEmptyString(value, label).replaceAll("\\", "/");
    if (!RELATIVE_EVIDENCE_PATTERN.test(text)) throw new Error(`${label} 必须是 evidence 根下的相对路径。`);
    return text;
}

function evidencePaths(value: unknown, label: string, max: number): string[] {
    if (!Array.isArray(value) || value.length > max) throw new Error(`${label} 数量超限。`);
    const paths = value.map((item, index) => evidencePath(item, `${label}[${String(index)}]`));
    if (new Set(paths).size !== paths.length) throw new Error(`${label} 不能包含重复路径。`);
    return paths;
}

function absolutePaths(value: unknown, label: string, max: number): string[] {
    if (!Array.isArray(value) || value.length > max) throw new Error(`${label} 数量超限。`);
    const paths = value.map((item, index) => absolutePath(item, `${label}[${String(index)}]`));
    if (new Set(paths).size !== paths.length) throw new Error(`${label} 不能包含重复路径。`);
    return paths;
}

function isAbsolutePath(value: string): boolean {
    return isAbsolute(value) || win32.isAbsolute(value);
}

function safeRunId(value: unknown): string {
    const runId = nonEmptyString(value, "runId");
    if (!RUN_ID_PATTERN.test(runId)) throw new Error("runId 包含非法路径字符。");
    return runId;
}

/** 禁止把凭据或完整启动关联秘密放进公开回执。 */
function assertPublicString(value: string, label: string): void {
    if (/(?:shutdown[_-]?token|access[_-]?token|api[_-]?key|password|secret|credential)/iu.test(label)) {
        throw new Error(`${label} 不能包含敏感字段。`);
    }
}

void relative;
void sep;
