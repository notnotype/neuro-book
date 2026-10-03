import {readFile, stat} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import {z} from "zod";
import {reanalyzeBrowserEvidence, type ProfileEvidence, type Sample} from "./files-baseline-observations";
import type {SamplePlan} from "./files-sample-generator";

const finite = z.number().finite();
const timing = z.object({name: z.string(), entryType: z.string(), startTime: finite, duration: finite}).passthrough();
const sampleSchema = z.object({
    id: z.string(), environment: z.literal("production"), scenario: z.enum(["A", "B", "C"]), variant: z.string(), iteration: z.number().int().nonnegative(),
    status: z.literal("pass"), error: z.null(), operationStartTime: finite, operationEndTime: finite, durationMs: finite,
    readiness: z.record(z.string(), z.unknown()), loadAverage: z.array(finite), observerSupport: z.array(z.string()),
    requests: z.array(timing.extend({
        initiatorType: z.string(), requestStart: finite, responseStart: finite, responseEnd: finite,
        transferSize: finite, encodedBodySize: finite, decodedBodySize: finite, nextHopProtocol: z.string(),
        serverTiming: z.array(z.object({name: z.string(), duration: finite, description: z.string()})),
    })), userTiming: z.array(timing), longTasks: z.array(timing), longAnimationFrames: z.array(timing),
}).passthrough();
const profileSchema = z.object({
    label: z.string(), kind: z.literal("browser"), sample: sampleSchema.omit({iteration: true}).extend({iteration: z.number().int()}),
    artifacts: z.array(z.object({path: z.string(), bytes: z.number().int().nonnegative(), retainedInTemp: z.boolean()})),
    cpu: z.object({
        sampleCount: z.number().int().nonnegative(), spanMs: finite, negativeDeltaCount: z.number().int().nonnegative(), categories: z.record(z.string(), finite),
        topFunctions: z.array(z.object({functionName: z.string(), url: z.string(), lineNumber: z.number().int(), sampledMs: finite}).passthrough()),
    }).nullable(), timeline: z.record(z.string(), finite).nullable(),
    analysisWindow: z.object({startTime: finite, endTime: finite, clock: z.string(), pid: z.number().optional(), tid: z.number().optional()}),
}).passthrough();
const productionSchema = z.object({
    schema: z.literal("nbook.perf/files-baseline/v2"), generatedAt: z.string(), completed: z.boolean(), sourceRevision: z.string(),
    build: z.object({logPath: z.string(), image: z.object({imageId: z.string(), sourceDigest: z.string()}).passthrough()}),
    environment: z.record(z.string(), z.unknown()),
    sample: z.object({
        seed: z.number().int(), fileCount: z.number().int(), minBytes: z.number().int(), maxBytes: z.number().int(),
        totalBytes: z.number().int(), wideDirectoryChildren: z.number().int(), cleanedAfterRun: z.boolean(), retainedProfiles: z.array(z.string()),
        options: z.object({iterations: z.number().int(), openIterations: z.number().int()}),
    }), raw: z.array(sampleSchema), profiles: z.array(profileSchema), diagnostics: z.array(z.string()),
});

export type ProductionProvenance = {
    reportPath: string; generatedAt: string; sourceRevision: string; sourceCompleted: boolean; sourceDiagnostics: string[];
    environment: Record<string, unknown>; stateCleaned: boolean; rawCount: number;
};
export type ProductionBaseline = {raw: Sample[]; profiles: ProfileEvidence[]; retainedProfiles: string[]; provenance: ProductionProvenance};

/** 已完成的生产矩阵才能续跑；历史失败仍登记，原报告与 raw 不改写。 */
export async function loadProductionBaseline(path: string, plan: SamplePlan, iterations: number, openIterations: number, image: unknown, clientRoot: string): Promise<ProductionBaseline> {
    const source = productionSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const currentImage = z.object({imageId: z.string(), sourceDigest: z.string()}).parse(image);
    if (source.build.image.imageId !== currentImage.imageId || source.build.image.sourceDigest !== currentImage.sourceDigest) throw new Error("续跑生产镜像与原测量不一致");
    for (const key of ["seed", "fileCount", "minBytes", "maxBytes", "wideDirectoryChildren"] as const) {
        if (source.sample[key] !== plan[key]) throw new Error(`续跑样本参数不一致：${key}`);
    }
    if (source.sample.totalBytes !== plan.entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
        || source.sample.options.iterations !== iterations || source.sample.options.openIterations !== openIterations) throw new Error("续跑规模或重复次数不一致");
    const expected = new Map<string, number>([["A/service-cold", openIterations], ["A/reopen", openIterations], ["B/notes-wide", iterations]]);
    for (const mode of ["rich", "source"]) for (const groups of [1, 2]) for (const variant of ["cold", "hot-tree", "hot-tab"]) {
        const name = variant === "cold" ? `cold-${mode}-${groups}-group-tree` : `hot-${mode}-${groups}-group-${variant.slice(4)}`;
        expected.set(`C/${name}`, iterations);
    }
    const seen = new Set<string>();
    const seenIds = new Set<string>();
    const markers = new Map(plan.entries.map((entry) => [entry.relativePath, entry.uniqueMarker]));
    for (const sample of source.raw) {
        const key = `${sample.scenario}/${sample.variant}`;
        const count = expected.get(key);
        const position = `${key}/${sample.iteration}`;
        if (count === undefined || sample.iteration >= count || seen.has(position) || seenIds.has(sample.id)) throw new Error(`续跑矩阵缺项、重复或含额外操作：${sample.id}`);
        seen.add(position); seenIds.add(sample.id);
        if (sample.operationEndTime < sample.operationStartTime || Math.abs(sample.operationEndTime - sample.operationStartTime - sample.durationMs) > 0.01
            || sample.readiness.capturedClick !== true || sample.readiness.completed !== true) throw new Error(`续跑操作窗口无效：${sample.id}`);
        if (sample.scenario === "A" && sample.readiness.treeOperable !== true) throw new Error(`续跑文件树不可操作：${sample.id}`);
        if (sample.scenario === "B" && (sample.readiness.directoryOperable !== true || sample.readiness.animationComplete !== true
            || sample.readiness.renderedChildren !== plan.wideDirectoryChildren)) throw new Error(`续跑目录展开证据无效：${sample.id}`);
        if (sample.scenario === "C") {
            const path = sample.readiness.path;
            const groups = sample.variant.includes("-2-group-") ? 2 : 1;
            if (typeof path !== "string" || markers.get(path) !== sample.readiness.marker || sample.readiness.markerVisible !== true
                || sample.readiness.writable !== true || sample.readiness.inputVerified !== true || sample.readiness.actualGroups !== groups) throw new Error(`续跑输入证据无效：${sample.id}`);
        }
    }
    if (seen.size !== [...expected.values()].reduce((sum, count) => sum + count, 0)) throw new Error("续跑生产矩阵未完整结束");
    const profiles: ProfileEvidence[] = [];
    for (const profile of source.profiles) {
        const artifacts = [];
        for (const artifact of profile.artifacts) {
            const actualPath = artifact.retainedInTemp ? artifact.path : join(dirname(path), basename(artifact.path));
            const info = await stat(actualPath);
            if (!info.isFile() || info.size !== artifact.bytes) throw new Error(`续跑原始证据缺失或大小不一致：${actualPath}`);
            artifacts.push({...artifact, path: actualPath});
        }
        profiles.push(await reanalyzeBrowserEvidence({...profile, artifacts}, clientRoot));
    }
    const profileVariants = new Set(profiles.filter((profile) => profile.sample?.scenario === "C" && profile.sample.readiness.inputVerified === true).map((profile) => profile.sample!.variant));
    if (profiles.length !== 5 || !profiles.some((profile) => profile.sample?.scenario === "B") || profileVariants.size !== 4
        || !["rich", "source"].every((mode) => [1, 2].every((groups) => profileVariants.has(`cold-${mode}-${groups}-group-tree`)))) throw new Error("续跑缺少生产目录与四个编辑器代表 profile");
    return {
        raw: source.raw, profiles, retainedProfiles: source.sample.retainedProfiles,
        provenance: {reportPath: path, generatedAt: source.generatedAt, sourceRevision: source.sourceRevision, sourceCompleted: source.completed,
            sourceDiagnostics: source.diagnostics, environment: source.environment, stateCleaned: source.sample.cleanedAfterRun, rawCount: source.raw.length},
    };
}
