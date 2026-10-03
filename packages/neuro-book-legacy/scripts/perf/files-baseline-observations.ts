import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {createSourceFile, forEachChild, isFunctionDeclaration, ScriptKind, ScriptTarget, type Node} from "typescript";
import {z} from "zod";
import type {Page} from "playwright-core";

export type Environment = "production" | "development";
export type EditorMode = "rich" | "source";
export type GroupCount = 1 | 2;
export type TimingEntry = {name: string; entryType: string; startTime: number; duration: number};
export type ResourceEntry = TimingEntry & {
    initiatorType: string;
    requestStart: number;
    responseStart: number;
    responseEnd: number;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
    nextHopProtocol: string;
    serverTiming: {name: string; duration: number; description: string}[];
};
export type BrowserObservation = {
    operationStartTime: number;
    operationEndTime: number;
    durationMs: number;
    readiness: Record<string, unknown>;
    requests: ResourceEntry[];
    userTiming: TimingEntry[];
    longTasks: TimingEntry[];
    longAnimationFrames: TimingEntry[];
    observerSupport: string[];
};
export type Sample = BrowserObservation & {
    id: string;
    environment: Environment;
    scenario: "A" | "B" | "C";
    variant: string;
    iteration: number;
    status: "pass" | "fail";
    error: string | null;
    loadAverage: number[];
};
export type Stats = {count: number; min: number | null; p50: number | null; p95: number | null; max: number | null};
const CpuProfileSchema = z.object({
    nodes: z.array(z.object({
        id: z.number().int(),
        callFrame: z.object({functionName: z.string(), url: z.string(), lineNumber: z.number().int(), columnNumber: z.number().int().optional()}).passthrough(),
        children: z.array(z.number().int()).optional(),
    }).passthrough()),
    samples: z.array(z.number().int()).optional(),
    timeDeltas: z.array(z.number().finite()).optional(),
    startTime: z.number().finite(),
    endTime: z.number().finite(),
}).passthrough();
export type CpuProfile = z.infer<typeof CpuProfileSchema>;
export type CpuSymbolMapping = {
    sourceSymbol: string; compiledName: string; url: string;
    lineNumber: number; columnNumber: number; endLineNumber: number; endColumnNumber: number;
    category: string; matchedBy: readonly string[];
};
export type CpuSummary = {
    sampleCount: number;
    spanMs: number;
    negativeDeltaCount: number;
    categories: Record<string, number>;
    topFunctions: {functionName: string; url: string; lineNumber: number; sampledMs: number}[];
};
export type ProfileEvidence = {
    label: string;
    kind: "browser" | "server";
    sample: Sample | null;
    artifacts: {path: string; bytes: number; retainedInTemp: boolean}[];
    cpu: CpuSummary | null;
    timeline: Record<string, number> | null;
    analysisWindow?: {startTime: number; endTime: number; clock: string; pid?: number; tid?: number};
    symbolMappings?: CpuSymbolMapping[];
};

export function stats(values: readonly number[]): Stats {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = (fraction: number): number | null => {
        if (sorted.length === 0) return null;
        const position = (sorted.length - 1) * fraction;
        const low = Math.floor(position);
        return sorted[low]! + (sorted[Math.ceil(position)]! - sorted[low]!) * (position - low);
    };
    return {count: sorted.length, min: sorted[0] ?? null, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? null};
}


/** 互斥的关键路径区间；控件与解析计时是嵌套子阶段，不能再次相加。 */
export function composition(sample: Sample): Record<string, number> {
    const activation = sample.userTiming.find((item) => item.entryType === "measure" && item.name === "files.activation");
    const session = sample.userTiming.filter((item) => item.entryType === "measure" && item.name === "editor.session.publish");
    const views = sample.userTiming.filter((item) => item.entryType === "measure" && item.name === "editor.view.publish");
    const reads = sample.requests.filter((item) => new URL(item.name).pathname === "/api/workspace-files/read");
    const start = sample.operationStartTime;
    const end = sample.operationEndTime;
    const intent = Math.max(start, Math.min(end, activation?.startTime ?? start));
    const readEnd = Math.min(end, Math.max(intent, ...reads.map((item) => item.responseEnd)));
    const sessionEnd = Math.min(end, Math.max(readEnd, ...session.map((item) => item.startTime + item.duration)));
    const viewEnd = Math.min(end, Math.max(sessionEnd, ...views.map((item) => item.startTime + item.duration)));
    return {
        clickToActivation: intent - start,
        activationToReadEnd: readEnd - intent,
        readEndToSession: sessionEnd - readEnd,
        sessionToView: viewEnd - sessionEnd,
        viewToEditable: end - viewEnd,
    };
}

export function summarize(samples: readonly Sample[]): Record<string, Record<string, Stats>> {
    const groups: Record<string, Map<string, number[]>> = {};
    const add = (group: string, name: string, value: number): void => {
        const map = groups[group] ??= new Map();
        const values = map.get(name);
        if (values) values.push(value);
        else map.set(name, [value]);
    };
    for (const sample of samples) {
        if (sample.status !== "pass") continue;
        const key = `${sample.environment}/${sample.scenario}/${sample.variant}`;
        add("duration", key, sample.durationMs);
        add("requestCount", key, sample.requests.length);
        add("longestTask", key, Math.max(0, ...sample.longTasks.map((item) => item.duration)));
        for (const request of sample.requests) {
            const endpoint = new URL(request.name).pathname;
            add("requestDuration", `${key}/${endpoint}`, request.duration);
            add("requestBytes", `${key}/${endpoint}`, request.encodedBodySize);
            add("firstByteWait", `${key}/${endpoint}`, Math.max(0, request.responseStart - request.requestStart));
            add("transfer", `${key}/${endpoint}`, Math.max(0, request.responseEnd - request.responseStart));
            for (const item of request.serverTiming) add("serverTiming", `${key}/${item.name}`, item.duration);
        }
        for (const item of sample.userTiming) {
            if (item.entryType === "measure" && !item.name.startsWith("files.baseline.")) {
                add("userTiming", `${key}/${item.name}`, item.duration);
            }
        }
        if (sample.scenario === "C") {
            for (const [stage, duration] of Object.entries(composition(sample))) add("composition", `${key}/${stage}`, duration);
            for (const metric of ["selectionMs", "tabMs"]) {
                const duration = sample.readiness[metric];
                if (typeof duration === "number") add("feedback", `${key}/${metric}`, duration);
            }
            for (const endpoint of ["stat", "read"]) {
                add("fileRequestCount", `${key}/${endpoint}`, sample.requests.filter((item) => new URL(item.name).pathname === `/api/workspace-files/${endpoint}`).length);
            }
        }
    }
    return Object.fromEntries(Object.entries(groups).map(([group, entries]) => [group, Object.fromEntries([...entries].map(([key, values]) => [key, stats(values)]))]));
}

export function summarizeCpu(profile: CpuProfile, kind: "browser" | "server", window?: {startTime: number; endTime: number}, symbolMappings: readonly CpuSymbolMapping[] = []): CpuSummary {
    const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
    const parentById = new Map<number, number>();
    for (const node of profile.nodes) for (const child of node.children ?? []) parentById.set(child, node.id);
    const categories: Record<string, number> = {};
    const functions = new Map<number, number>();
    const samples = profile.samples ?? [];
    const fallback = samples.length ? (profile.endTime - profile.startTime) / samples.length : 0;
    const startTime = Math.max(profile.startTime, window?.startTime ?? profile.startTime);
    const endTime = Math.min(profile.endTime, window?.endTime ?? profile.endTime);
    let timestamp = profile.startTime;
    let negativeDeltaCount = 0;
    const ordered = samples.map((id, index) => {
        const delta = profile.timeDeltas?.[index] ?? fallback;
        if (delta < 0) negativeDeltaCount += 1;
        timestamp += delta;
        return {id, timestamp};
    }).sort((left, right) => left.timestamp - right.timestamp);
    let previous = profile.startTime;
    let sampleCount = 0;
    for (let index = 0; index < ordered.length; index += 1) {
        const sample = ordered[index]!;
        const intervalEnd = index === ordered.length - 1 ? profile.endTime : sample.timestamp;
        const elapsed = Math.max(0, Math.min(endTime, intervalEnd) - Math.max(startTime, previous)) / 1_000;
        previous = Math.max(previous, intervalEnd);
        if (elapsed === 0) continue;
        const id = sample.id;
        const leaf = nodeById.get(id);
        if (!leaf) continue;
        sampleCount += 1;
        functions.set(id, (functions.get(id) ?? 0) + elapsed);
        const stack: CpuProfile["nodes"][number]["callFrame"][] = [];
        let current: number | undefined = id;
        const visited = new Set<number>();
        while (current !== undefined && !visited.has(current)) {
            visited.add(current);
            const node = nodeById.get(current);
            if (node) stack.push(node.callFrame);
            current = parentById.get(current);
        }
        const names = stack.map((frame) => `${frame.functionName} ${frame.url}`).join("\n");
        const mappedCategory = stack.map((frame) => symbolMappings.find((mapping) => {
            const column = frame.columnNumber ?? -1;
            return frame.functionName === mapping.compiledName && frame.url === mapping.url
                && (frame.lineNumber > mapping.lineNumber || frame.lineNumber === mapping.lineNumber && column >= mapping.columnNumber)
                && (frame.lineNumber < mapping.endLineNumber || frame.lineNumber === mapping.endLineNumber && column < mapping.endColumnNumber);
        })?.category).find(Boolean);
        let category = "未归类 CPU";
        if (/\(idle\)|idle|program$/iu.test(leaf.callFrame.functionName)) category = "空闲或原生未归类";
        else if (/garbage collector|\bgc\b|collectGarbage/iu.test(leaf.callFrame.functionName)) category = "垃圾回收";
        else if (kind === "server") {
            if (mappedCategory) category = mappedCategory;
            else if (/parseMarkdownDocument|parseDocument|parseAllDocuments|parseBlockMap|parseBlockSeq|resolveBlockMap|composeDoc|Composer|yaml\/|yaml\./u.test(names)) category = "frontmatter 与 YAML";
            else if (/readdir|visitPath|scanWorkspaceTree|buildWorkspaceNode|assertRealPathContained|realpath|projectWorkspacePathPolicy|readWorkspaceContentState/u.test(names)) category = "目录与索引（含路径校验）";
            else if (/createProjectIssues|createWorkspaceContentIssues|validateFrontmatter/u.test(names)) category = "索引问题校验";
            else if (/readWorkspaceTextFile|readUtf8TextFile|readFile/u.test(names)) category = "文件读取 CPU";
        } else {
            if (mappedCategory) category = mappedCategory;
            else if (/parseMarkdown|createDocument|createDoc|createSchema|normalizeMarkdown|DOMParser|parseTokens|parseBlockChildren/iu.test(names)) category = "富文本解析与模型";
            else if (/tiptap|prosemirror|EditorView|createView|updateState|MarkdownEditor/iu.test(names)) category = "富文本控件与视图";
            else if (/monaco|createTextModel|createModel|CodeEditorWidget|tokenize/iu.test(names)) category = "Monaco 模型与控件";
            else if (/buildWorkspaceFileTree|projectWorkspaceFileNodes|flattenVisibleWorkspaceNodes/u.test(names)) category = "前端建树";
            else if (/patch|render|flushJobs|ReactiveEffect|componentUpdateFn/u.test(names)) category = "Vue 更新";
        }
        categories[category] = (categories[category] ?? 0) + elapsed;
    }
    const topFunctions = [...functions].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([id, sampledMs]) => ({...nodeById.get(id)!.callFrame, sampledMs}));
    return {sampleCount, spanMs: (endTime - startTime) / 1_000, negativeDeltaCount, categories, topFunctions};
}

/** 压缩名字只由本次真实构建的独特函数体识别；无法唯一定位时保留未归类。 */
function serverSymbolMappings(source: string, url: string): CpuSymbolMapping[] {
    const syntax = createSourceFile(url, source, ScriptTarget.Latest, true, ScriptKind.JS);
    const signatures = [
        {sourceSymbol: "parseMarkdownDocument", category: "frontmatter 与 YAML", needles: ["frontmatter 必须是对象", "frontmatter 解析失败"]},
        {sourceSymbol: "scanWorkspaceTree", category: "目录与索引（含路径校验）", needles: ["zh-Hans-CN", ".targets", ".depth", "localeCompare"]},
        {sourceSymbol: "visitPath", category: "目录与索引（含路径校验）", needles: ["zh-Hans-CN", "readdir(", ".depth", "isDirectory()"]},
        {sourceSymbol: "buildWorkspaceNode", category: "目录与索引（含路径校验）", needles: ["frontmatterError", "words:", "mtimeMs:", "hasIndex"]},
        {sourceSymbol: "createProjectIssues", category: "索引问题校验", needles: ["invalid-project-manifest"]},
        {sourceSymbol: "readWorkspaceTextFile", category: "文件读取 CPU", needles: ["This file type cannot be read as text", "Only files can be read"]},
    ];
    const matches = new Map<string, CpuSymbolMapping[]>();
    const visit = (node: Node): void => {
        if (isFunctionDeclaration(node) && node.name && node.body) {
            const body = node.body.getText(syntax);
            const position = syntax.getLineAndCharacterOfPosition(node.getStart(syntax));
            const end = syntax.getLineAndCharacterOfPosition(node.end);
            for (const signature of signatures) {
                if (!signature.needles.every((needle) => body.includes(needle))) continue;
                const mappings = matches.get(signature.sourceSymbol) ?? [];
                mappings.push({sourceSymbol: signature.sourceSymbol, compiledName: node.name.text, url, lineNumber: position.line, columnNumber: position.character, endLineNumber: end.line, endColumnNumber: end.character, category: signature.category, matchedBy: signature.needles});
                matches.set(signature.sourceSymbol, mappings);
            }
        }
        forEachChild(node, visit);
    };
    visit(syntax);
    return [...matches.values()].filter((mappings) => mappings.length === 1).flat();
}

/** 当前页面加载的真实脚本参与映射，URL 与函数范围防止压缩名字碰撞。 */
function vueSymbolMappings(source: string, url: string): CpuSymbolMapping[] {
    const needles = ["__v_skip", "new Map", "Object.getOwnPropertySymbols", "propertyIsEnumerable"];
    if (!needles.every((needle) => source.includes(needle))) return [];
    const syntax = createSourceFile(url, source, ScriptTarget.Latest, true, ScriptKind.JS);
    const mappings: CpuSymbolMapping[] = [];
    const visit = (node: Node): void => {
        if (isFunctionDeclaration(node) && node.name && node.body && needles.every((needle) => node.body!.getText(syntax).includes(needle))) {
            const start = syntax.getLineAndCharacterOfPosition(node.getStart(syntax));
            const end = syntax.getLineAndCharacterOfPosition(node.end);
            mappings.push({sourceSymbol: "Vue traverse", compiledName: node.name.text, url, lineNumber: start.line, columnNumber: start.character, endLineNumber: end.line, endColumnNumber: end.character, category: "Vue 深度遍历", matchedBy: needles});
        }
        forEachChild(node, visit);
    };
    visit(syntax);
    return mappings;
}

async function browserSymbolMappings(page: Page, profile: CpuProfile): Promise<CpuSymbolMapping[]> {
    const origin = new URL(page.url()).origin;
    const mappings: CpuSymbolMapping[] = [];
    const urls = [...new Set(profile.nodes.map((node) => node.callFrame.url))].filter((url) => url.startsWith(`${origin}/`) && new URL(url).pathname.endsWith(".js"));
    for (const url of urls) {
        const response = await page.context().request.get(url, {timeout: 30_000});
        if (!response.ok()) throw new Error(`CPU 函数映射读取失败：HTTP ${response.status()} ${url}`);
        mappings.push(...vueSymbolMappings(await response.text(), url));
    }
    return mappings.length === 1 ? mappings : [];
}

/** 续跑只重算归类，不改写已测 raw、profile 或原报告。 */
export async function reanalyzeBrowserEvidence(evidence: ProfileEvidence, clientRoot: string): Promise<ProfileEvidence> {
    const artifact = evidence.artifacts.find((item) => item.path.endsWith(".cpuprofile"));
    if (!artifact || !evidence.analysisWindow) throw new Error(`浏览器证据 ${evidence.label} 缺少 CPU profile 或分析窗口`);
    const profile = CpuProfileSchema.parse(JSON.parse(await readFile(artifact.path, "utf8")));
    const urls = [...new Set(profile.nodes.map((node) => node.callFrame.url))].filter((url) => /^https?:\/\//u.test(url) && new URL(url).pathname.startsWith("/_nuxt/") && url.endsWith(".js"));
    const mappings: CpuSymbolMapping[] = [];
    for (const url of urls) {
        const pathname = new URL(url).pathname;
        if (!/^\/_nuxt\/[A-Za-z0-9_.-]+\.js$/u.test(pathname)) throw new Error(`CPU 脚本路径不合法：${url}`);
        mappings.push(...vueSymbolMappings(await readFile(join(clientRoot, pathname), "utf8"), url));
    }
    const symbolMappings = mappings.length === 1 ? mappings : [];
    return {...evidence, symbolMappings, cpu: summarizeCpu(profile, "browser", evidence.analysisWindow, symbolMappings)};
}

async function saveArtifact(root: string, retainedRoot: string, name: string, content: string): Promise<ProfileEvidence["artifacts"][number]> {
    const bytes = Buffer.byteLength(content);
    const retainedInTemp = bytes > 5 * 1024 * 1024;
    const path = join(retainedInTemp ? retainedRoot : root, name);
    await mkdir(retainedInTemp ? retainedRoot : root, {recursive: true});
    await writeFile(path, content);
    return {path, bytes, retainedInTemp};
}

export async function profileBrowser(page: Page, root: string, retainedRoot: string, label: string, action: () => Promise<Sample>): Promise<ProfileEvidence> {
    const session = await page.context().newCDPSession(page);
    const events: (Record<string, unknown> & {name: string; ph: string; dur?: number})[] = [];
    let finishTrace!: () => void;
    const traceDone = new Promise<void>((resolve) => {finishTrace = resolve;});
    session.on("Tracing.dataCollected", (data) => {
        for (const value of data.value) {
            const event: unknown = value;
            if (typeof event !== "object" || event === null || !("name" in event) || typeof event.name !== "string" || !("ph" in event) || typeof event.ph !== "string") {
                throw new Error("Chrome Trace 事件缺少 name 或 ph");
            }
            if ("dur" in event && typeof event.dur !== "number") throw new Error("Chrome Trace dur 不是数值");
            events.push(event as Record<string, unknown> & {name: string; ph: string; dur?: number});
        }
    });
    session.on("Tracing.tracingComplete", finishTrace);
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", {interval: 1_000});
    await session.send("Profiler.start");
    await session.send("Tracing.start", {categories: "devtools.timeline,blink.user_timing,v8.execute", transferMode: "ReportEvents"});
    const clockMark = "files.baseline.profile-clock";
    const clockStart = await page.evaluate((name) => performance.mark(name).startTime, clockMark);
    let sample: Sample | null = null;
    try {
        sample = await action();
    } finally {
        const {profile} = await session.send("Profiler.stop");
        await session.send("Tracing.end");
        let timer: NodeJS.Timeout | undefined;
        try {
            await Promise.race([traceDone, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(new Error("Chrome Trace 在 20 秒内未结束")), 20_000);})]);
        } finally {
            clearTimeout(timer);
            await session.detach();
        }
        const artifacts = await Promise.all([
            saveArtifact(root, retainedRoot, `${label}.cpuprofile`, JSON.stringify(profile)),
            saveArtifact(root, retainedRoot, `${label}.trace.json`, JSON.stringify({traceEvents: events})),
        ]);
        const clockEvent = events.find((event) => event.name === clockMark && typeof event.ts === "number" && typeof event.pid === "number" && typeof event.tid === "number");
        if (!clockEvent || typeof clockEvent.ts !== "number" || typeof clockEvent.pid !== "number" || typeof clockEvent.tid !== "number") throw new Error("Chrome Trace 缺少页面时钟校准事件");
        const offset = clockEvent.ts - clockStart * 1_000;
        const startTime = sample ? offset + sample.operationStartTime * 1_000 : profile.startTime;
        const endTime = sample ? offset + sample.operationEndTime * 1_000 : profile.endTime;
        const analysisWindow = {startTime, endTime, clock: "User Timing mark 对齐 Chrome monotonic 微秒时钟", pid: clockEvent.pid, tid: clockEvent.tid};
        const timeline: Record<string, number> = {};
        for (const event of events) {
            if (event.ph !== "X" || typeof event.ts !== "number" || event.dur === undefined || event.pid !== clockEvent.pid || event.tid !== clockEvent.tid) continue;
            if (["Layout", "UpdateLayoutTree", "Paint", "ParseHTML", "FunctionCall", "RunTask"].includes(event.name)) {
                const duration = Math.max(0, Math.min(endTime, event.ts + event.dur) - Math.max(startTime, event.ts)) / 1_000;
                timeline[event.name] = (timeline[event.name] ?? 0) + duration;
            }
        }
        await page.evaluate((name) => performance.clearMarks(name), clockMark);
        const validatedProfile = CpuProfileSchema.parse(profile);
        const symbolMappings = await browserSymbolMappings(page, validatedProfile);
        const evidence = {label, kind: "browser" as const, sample, artifacts, cpu: summarizeCpu(validatedProfile, "browser", analysisWindow, symbolMappings), timeline, analysisWindow, symbolMappings};
        await writeFile(join(root, `${label}-summary.json`), `${JSON.stringify(evidence, null, 2)}\n`);
        if (sample && sample.status === "pass") return evidence;
    }
    throw new Error(`浏览器采样 ${label} 未取得完整样本`);
}

export async function readServerProfile(path: string, serverScript: string, root: string, retainedRoot: string, label: string, sample: Sample): Promise<ProfileEvidence> {
    const content = await readFile(path, "utf8");
    const profile = CpuProfileSchema.parse(JSON.parse(content));
    const artifact = await saveArtifact(root, retainedRoot, `${label}.cpuprofile`, content);
    const timeOrigin = sample.readiness.timeOrigin;
    if (typeof timeOrigin !== "number" || !Number.isFinite(timeOrigin)) throw new Error("浏览器样本缺少有效的 performance.timeOrigin");
    const operationStart = (timeOrigin + sample.operationStartTime) * 1_000;
    const operationEnd = (timeOrigin + sample.operationEndTime) * 1_000;
    const symbolMappings = serverSymbolMappings(await readFile(serverScript, "utf8"), pathToFileURL(serverScript).href);
    const analysisWindow = {startTime: operationStart, endTime: operationEnd, clock: "performance.timeOrigin 对齐 Bun Unix 微秒时钟"};
    const cpu = summarizeCpu(profile, "server", analysisWindow, symbolMappings);
    if (cpu.sampleCount === 0) throw new Error("服务 CPU profile 与浏览器操作窗口没有重叠采样");
    return {label, kind: "server", sample, artifacts: [artifact], cpu, timeline: null, analysisWindow, symbolMappings};
}
