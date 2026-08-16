import {randomUUID} from "node:crypto";
import {mkdir, rename, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep, win32} from "node:path";

export const RESEARCH_RUN_MANIFEST_SCHEMA = "nbook.repository-research-run/v1";
export const REPOSITORY_RESEARCH_ADAPTER_SCHEMA = "nbook.repository-research-adapter/v1";

export type ResearchRunResult = "passed" | "environment-blocked" | "product-failure" | "unverified";

export type ResearchAnnotationMark = Readonly<{
    kind: "arrow" | "rectangle" | "label";
    x: number;
    y: number;
    width?: number;
    height?: number;
    toX?: number;
    toY?: number;
    text?: string;
}>;

export type ResearchAnnotation = Readonly<{
    stepId: string;
    mediaFile: string;
    source: string;
    profile: string;
    marks: readonly ResearchAnnotationMark[];
}>;
export type ResearchTutorialStep = Readonly<{
    id: string;
    title: string;
    instruction: string;
    source: string;
    mediaFile: string;
}>;
export type ResearchVisionRegion = Readonly<{
    id: string;
    description: string;
    source: string;
    marks: readonly ResearchAnnotationMark[];
}>;

export type ResearchVisionPlan = Readonly<{
    success: boolean;
    profile: string;
    regions: readonly ResearchVisionRegion[];
    tutorialSteps: readonly Readonly<{
        id: string;
        title: string;
        instruction: string;
        source: string;
        regionId: string;
    }>[];
    failureReason?: string;
}>;

/** 解析视觉子代理返回的结构化计划；每个教程步骤必须绑定一个独立标注区域。 */
export function parseResearchVisionPlan(value: unknown): ResearchVisionPlan {
    const root = object(value, "Research Vision Plan");
    exactKeys(root, ["success", "profile", "regions", "tutorialSteps"], "Research Vision Plan", ["failureReason"]);
    const success = booleanValue(root.success, "success");
    const profile = boundedPublicString(root.profile, "profile", 96);
    const failureReason = root.failureReason === undefined ? undefined : boundedPublicString(root.failureReason, "failureReason", 400);
    if (!Array.isArray(root.regions) || root.regions.length < 1 || root.regions.length > MAX_MEDIA_FILES) {
        throw new Error("regions 数量必须在 1 到 4 之间。");
    }
    if (!Array.isArray(root.tutorialSteps) || root.tutorialSteps.length < 1 || root.tutorialSteps.length > MAX_MEDIA_FILES) {
        throw new Error("tutorialSteps 数量必须在 1 到 4 之间。");
    }
    const regions = root.regions.map((item, index) => parseVisionRegion(item, index));
    const regionsById = new Map<string, ResearchVisionRegion>();
    for (const region of regions) {
        if (regionsById.has(region.id)) throw new Error(`regions.id 不能重复：${region.id}`);
        regionsById.set(region.id, region);
    }
    const stepIds = new Set<string>();
    const referencedRegionIds = new Set<string>();
    const tutorialSteps = root.tutorialSteps.map((item, index) => {
        const label = `tutorialSteps[${String(index)}]`;
        const step = object(item, label);
        exactKeys(step, ["id", "title", "instruction", "source", "regionId"], label);
        const id = boundedPublicString(step.id, `${label}.id`, 64);
        if (stepIds.has(id)) throw new Error(`${label}.id 不能重复。`);
        stepIds.add(id);
        const title = boundedPublicString(step.title, `${label}.title`, 160);
        const instruction = boundedPublicString(step.instruction, `${label}.instruction`, 400);
        const source = evidencePath(step.source, `${label}.source`);
        const regionId = boundedPublicString(step.regionId, `${label}.regionId`, 64);
        const region = regionsById.get(regionId);
        if (!region) throw new Error(`${label}.regionId 未引用已声明区域：${regionId}`);
        if (region.source !== source) throw new Error(`${label}.source 必须与其 regionId 的 source 一致。`);
        if (referencedRegionIds.has(regionId)) throw new Error(`${label}.regionId 不能被多个步骤复用：${regionId}`);
        referencedRegionIds.add(regionId);
        return {id, title, instruction, source, regionId};
    });
    if (referencedRegionIds.size !== regions.length) throw new Error("每个标注区域必须恰好归属于一个教程步骤。");
    if (!success && !failureReason) throw new Error("success=false 时必须提供 failureReason。");
    return {success, profile, regions, tutorialSteps, ...(failureReason === undefined ? {} : {failureReason})};
}


function parseVisionRegion(value: unknown, index: number): ResearchVisionRegion {
    const label = `regions[${String(index)}]`;
    const root = object(value, label);
    exactKeys(root, ["id", "description", "source", "marks"], label);
    if (!Array.isArray(root.marks) || root.marks.length < 1 || root.marks.length > 16) {
        throw new Error(`${label}.marks 数量必须在 1 到 16 之间。`);
    }
    return {
        id: boundedPublicString(root.id, `${label}.id`, 64),
        description: boundedPublicString(root.description, `${label}.description`, 240),
        source: evidencePath(root.source, `${label}.source`),
        marks: root.marks.map((mark, markIndex) => parseAnnotationMark(mark, `${label}.marks[${String(markIndex)}]`)),
    };
}

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
    evidence: {
        files: string[];
        mediaFiles: string[];
        profile?: string;
        annotations?: ResearchAnnotation[];
        tutorialSteps?: ResearchTutorialStep[];
    };
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
    exactKeys(root, ["files", "mediaFiles"], "evidence", ["profile", "annotations", "tutorialSteps"]);
    const files = evidencePaths(root.files, "evidence.files", MAX_EVIDENCE_FILES);
    const mediaFiles = absolutePaths(root.mediaFiles, "evidence.mediaFiles", MAX_MEDIA_FILES);
    const profile = optionalString(root.profile, "evidence.profile");
    const annotations = parseAnnotations(root.annotations, files, mediaFiles);
    const tutorialSteps = parseTutorialSteps(root.tutorialSteps, files, mediaFiles);
    if ((annotations === undefined) !== (tutorialSteps === undefined)) {
        throw new Error("annotations 与 tutorialSteps 必须同时存在或同时缺失。");
    }
    assertTutorialAnnotationLinks(annotations, tutorialSteps);
    return {
        files,
        mediaFiles,
        ...(profile === undefined ? {} : {profile}),
        ...(annotations === undefined ? {} : {annotations}),
        ...(tutorialSteps === undefined ? {} : {tutorialSteps}),
    };
}

function parseAnnotations(
    value: unknown,
    files: readonly string[],
    mediaFiles: readonly string[],
): ResearchAnnotation[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MEDIA_FILES) {
        throw new Error("evidence.annotations 数量必须在 1 到 4 之间。");
    }
    const stepIds = new Set<string>();
    const mediaTargets = new Set<string>();
    return value.map((item, index) => {
        const label = `evidence.annotations[${String(index)}]`;
        const root = object(item, label);
        exactKeys(root, ["stepId", "mediaFile", "source", "profile", "marks"], label);
        const stepId = boundedPublicString(root.stepId, `${label}.stepId`, 64);
        if (stepIds.has(stepId)) throw new Error(`${label}.stepId 不能重复。`);
        stepIds.add(stepId);
        const mediaFile = absolutePath(root.mediaFile, `${label}.mediaFile`);
        if (!mediaFiles.includes(mediaFile)) throw new Error(`${label}.mediaFile 必须来自 mediaFiles。`);
        if (mediaTargets.has(mediaFile)) throw new Error(`${label}.mediaFile 不能被多个步骤复用。`);
        mediaTargets.add(mediaFile);
        const source = evidencePath(root.source, `${label}.source`);
        if (!files.includes(source)) throw new Error(`${label}.source 必须来自 evidence.files。`);
        const profile = nonEmptyString(root.profile, `${label}.profile`);
        if (!Array.isArray(root.marks) || root.marks.length < 1 || root.marks.length > 16) {
            throw new Error(`${label}.marks 数量必须在 1 到 16 之间。`);
        }
        const marks = root.marks.map((mark, markIndex) => parseAnnotationMark(
            mark,
            `${label}.marks[${String(markIndex)}]`,
        ));
        return {stepId, mediaFile, source, profile, marks};
    });
}

function parseTutorialSteps(
    value: unknown,
    files: readonly string[],
    mediaFiles: readonly string[],
): ResearchTutorialStep[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MEDIA_FILES) {
        throw new Error("evidence.tutorialSteps 数量必须在 1 到 4 之间。");
    }
    const ids = new Set<string>();
    const mediaTargets = new Set<string>();
    return value.map((item, index) => {
        const label = `evidence.tutorialSteps[${String(index)}]`;
        const root = object(item, label);
        exactKeys(root, ["id", "title", "instruction", "source", "mediaFile"], label);
        const id = boundedPublicString(root.id, `${label}.id`, 64);
        if (ids.has(id)) throw new Error(`${label}.id 不能重复。`);
        ids.add(id);
        const title = boundedPublicString(root.title, `${label}.title`, 160);
        const instruction = boundedPublicString(root.instruction, `${label}.instruction`, 400);
        const source = evidencePath(root.source, `${label}.source`);
        if (!files.includes(source)) throw new Error(`${label}.source 必须来自 evidence.files。`);
        const mediaFile = absolutePath(root.mediaFile, `${label}.mediaFile`);
        if (!mediaFiles.includes(mediaFile)) throw new Error(`${label}.mediaFile 必须来自 mediaFiles。`);
        if (mediaTargets.has(mediaFile)) throw new Error(`${label}.mediaFile 不能被多个步骤复用。`);
        mediaTargets.add(mediaFile);
        return {id, title, instruction, source, mediaFile};
    });
}

function assertTutorialAnnotationLinks(
    annotations: ResearchAnnotation[] | undefined,
    tutorialSteps: ResearchTutorialStep[] | undefined,
): void {
    if (!annotations || !tutorialSteps) return;
    if (annotations.length !== tutorialSteps.length) throw new Error("annotations 与 tutorialSteps 必须一一对应。");
    const annotationsByStep = new Map(annotations.map((annotation) => [annotation.stepId, annotation]));
    for (const step of tutorialSteps) {
        const annotation = annotationsByStep.get(step.id);
        if (!annotation) throw new Error(`教程步骤缺少对应标注：${step.id}`);
        if (annotation.mediaFile !== step.mediaFile || annotation.source !== step.source) {
            throw new Error(`教程步骤与标注媒体不一致：${step.id}`);
        }
    }
}


function parseAnnotationMark(value: unknown, label: string): ResearchAnnotationMark {
    const root = object(value, label);
    exactKeys(root, ["kind", "x", "y"], label, ["width", "height", "toX", "toY", "text"]);
    const kind = member(root.kind, ["arrow", "rectangle", "label"] as const, `${label}.kind`);
    const x = unitInterval(root.x, `${label}.x`);
    const y = unitInterval(root.y, `${label}.y`);
    const width = root.width === undefined ? undefined : unitInterval(root.width, `${label}.width`);
    const height = root.height === undefined ? undefined : unitInterval(root.height, `${label}.height`);
    const toX = root.toX === undefined ? undefined : unitInterval(root.toX, `${label}.toX`);
    const toY = root.toY === undefined ? undefined : unitInterval(root.toY, `${label}.toY`);
    const text = root.text === undefined ? undefined : boundedPublicString(root.text, `${label}.text`, 160);
    if (kind === "arrow" && (toX === undefined || toY === undefined)) throw new Error(`${label} 箭头必须提供 toX 和 toY。`);
    if (kind === "rectangle" && (width === undefined || height === undefined)) throw new Error(`${label} 框选必须提供 width 和 height。`);
    if (kind === "label" && text === undefined) throw new Error(`${label} 文字标注必须提供 text。`);
    return {
        kind,
        x,
        y,
        ...(width === undefined ? {} : {width}),
        ...(height === undefined ? {} : {height}),
        ...(toX === undefined ? {} : {toX}),
        ...(toY === undefined ? {} : {toY}),
        ...(text === undefined ? {} : {text}),
    };
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
function unitInterval(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${label} 必须是 0 到 1 之间的数字。`);
    }
    return value;
}

function optionalUnitInterval(value: unknown, label: string): number | undefined {
    if (value === undefined) return undefined;
    return unitInterval(value, label);
}

function boundedPublicString(value: unknown, label: string, maxLength: number): string {
    const text = nonEmptyString(value, label);
    if (text.length > maxLength) throw new Error(`${label} 长度不能超过 ${String(maxLength)}。`);
    if (/(?:sk-[A-Za-z0-9]{8,}|bearer\s+[A-Za-z0-9._-]{16,})/iu.test(text)) {
        throw new Error(`${label} 不能包含凭据内容。`);
    }
    return text;
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
