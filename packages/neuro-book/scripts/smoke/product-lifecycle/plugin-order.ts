import {readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {isOwnedServerLogFile} from "nbook/server/app-logs/jsonl-log-writer";
import type {Observation} from "./types";

const entrySchema = z.object({
    plugin: z.string().min(1),
    entry: z.string().min(1),
    dependencies: z.array(z.string().min(1)),
    provides: z.array(z.string().min(1)),
}).strict();
const diagnosticSchema = z.object({
    sequence: z.number().int().positive(),
    plugin: z.string().nullable(),
    entry: z.string().nullable(),
    generation: z.number().int().positive().nullable(),
    stage: z.enum(["register", "activate", "publish", "revoke", "recover", "close"]),
    reason: z.string(),
    capability: z.string().nullable(),
    contribution: z.string().nullable(),
    error: z.object({name: z.string(), message: z.string()}).strict().nullable(),
}).strict();
const catalogSchema = z.object({entries: z.array(entrySchema)}).strict();
const logSchema = z.object({event: z.string(), data: z.unknown().optional()});

type Entry = z.infer<typeof entrySchema>;
type Diagnostic = z.infer<typeof diagnosticSchema>;
type Generation = Diagnostic & {plugin: string; entry: string; generation: number};
type Edge = {provider: Entry; dependent: Entry; key: string};
const entryId = (entry: {plugin: string; entry: string}): string => `${entry.plugin}/${entry.entry}`;
const generationId = (diagnostic: Generation): string => `${entryId(diagnostic)}#${diagnostic.generation}`;

function isGeneration(diagnostic: Diagnostic): diagnostic is Generation {
    return diagnostic.plugin !== null && diagnostic.entry !== null && diagnostic.generation !== null;
}

/** 图来自产品目录；仅必需的最短服务链作为缺插件防误报门禁。 */
export function assessPluginOrder(lines: string, kind: "activation-order" | "close-order"): Observation {
    const catalogs: Array<z.infer<typeof catalogSchema>> = [];
    const diagnostics: Diagnostic[] = [];
    const failures: string[] = [];
    try {
        for (const line of lines.split("\n")) {
            if (!line.trim()) continue;
            const value: unknown = JSON.parse(line);
            const log = logSchema.parse(value);
            if (log.event === "runtime.plugins.catalog") catalogs.push(catalogSchema.parse(log.data));
            if (log.event === "runtime.plugins.diagnostic") diagnostics.push(diagnosticSchema.parse(log.data));
        }
        if (catalogs.length !== 1) throw new Error(`目录记录应恰有一条，实际 ${catalogs.length}`);
        const entries = catalogs[0]!.entries;
        const providers = new Map<string, Entry>();
        const identities = new Set<string>();
        for (const entry of entries) {
            const id = entryId(entry);
            if (identities.has(id)) throw new Error(`重复目录入口 ${id}`);
            identities.add(id);
            for (const key of entry.provides) {
                if (providers.has(key)) throw new Error(`服务提供方不唯一 ${key}`);
                providers.set(key, entry);
            }
        }
        const edges: Edge[] = [];
        for (const dependent of entries) {
            for (const key of dependent.dependencies) {
                const provider = providers.get(key);
                if (!provider) throw new Error(`服务缺少提供方 ${entryId(dependent)} -> ${key}`);
                edges.push({provider, dependent, key});
            }
        }
        if (edges.length === 0) throw new Error("依赖边集为空");
        const chain = ["nbook.app-state", "nbook.session-store", "nbook.project", "nbook.agent"];
        for (let index = 1; index < chain.length; index += 1) {
            if (!edges.some((edge) => edge.provider.plugin === chain[index - 1] && edge.dependent.plugin === chain[index])) {
                throw new Error(`缺少必需依赖链 ${chain[index - 1]} -> ${chain[index]}`);
            }
        }
        diagnostics.sort((first, second) => first.sequence - second.sequence);
        const sequences = new Set<number>();
        for (const diagnostic of diagnostics) {
            if (sequences.has(diagnostic.sequence)) throw new Error(`重复诊断 sequence=${diagnostic.sequence}`);
            sequences.add(diagnostic.sequence);
        }
        const published = diagnostics.filter((diagnostic) => diagnostic.reason === "published").map((diagnostic) => {
            if (!isGeneration(diagnostic) || diagnostic.stage !== "publish") throw new Error("published 缺少代次身份或阶段错误");
            return diagnostic;
        });
        const generations = new Set<string>();
        for (const generation of published) {
            const id = generationId(generation);
            if (generations.has(id)) throw new Error(`重复 published ${id}`);
            if (!identities.has(entryId(generation))) throw new Error(`published 不在目录中 ${id}`);
            generations.add(id);
        }
        for (const entry of entries) {
            if (!published.some((generation) => entryId(generation) === entryId(entry))) failures.push(`入口未发布 ${entryId(entry)}`);
        }
        const closed = diagnostics.filter((diagnostic) => diagnostic.reason === "closed" && isGeneration(diagnostic));
        const closing = diagnostics.filter((diagnostic) => diagnostic.reason === "close-started" && isGeneration(diagnostic));
        const closedByGeneration = new Map<string, Diagnostic>();
        if (kind === "close-order") {
            for (const generation of published) {
                const sameGeneration = (diagnostic: Diagnostic): boolean => isGeneration(diagnostic) && generationId(diagnostic) === generationId(generation);
                const starts = closing.filter(sameGeneration);
                const finishes = closed.filter(sameGeneration);
                if (starts.length !== 1 || finishes.length !== 1) {
                    failures.push(`${generationId(generation)} close-started=${starts.length}, closed=${finishes.length}（各应为 1）`);
                    continue;
                }
                if (starts[0]!.stage !== "close" || finishes[0]!.stage !== "close"
                    || generation.sequence >= starts[0]!.sequence || starts[0]!.sequence >= finishes[0]!.sequence) {
                    failures.push(`${generationId(generation)} 发布与关闭阶段顺序错误`);
                }
                closedByGeneration.set(generationId(generation), finishes[0]!);
            }
        }
        for (const edge of edges) {
            for (const dependent of published.filter((generation) => entryId(generation) === entryId(edge.dependent))) {
                const provider = published.findLast((generation) => entryId(generation) === entryId(edge.provider)
                    && generation.sequence < dependent.sequence
                    && !closed.some((finish) => isGeneration(finish) && generationId(finish) === generationId(generation) && finish.sequence < dependent.sequence));
                if (!provider) {
                    failures.push(`${generationId(dependent)} 发布前没有可用提供方 ${entryId(edge.provider)}（${edge.key}）`);
                    continue;
                }
                if (kind === "close-order") {
                    const dependentClosed = closedByGeneration.get(generationId(dependent));
                    const providerClosed = closedByGeneration.get(generationId(provider));
                    if (dependentClosed && providerClosed && dependentClosed.sequence >= providerClosed.sequence) {
                        failures.push(`${generationId(dependent)} 未先于 ${generationId(provider)} 关闭`);
                    }
                }
            }
        }
        const format = (records: Diagnostic[]): string => records.map((record) => isGeneration(record) ? `${record.sequence}:${generationId(record)}` : String(record.sequence)).join(" -> ");
        return {
            id: kind,
            result: failures.length === 0 ? "pass" : "fail",
            evidence: `边=${edges.map((edge) => `${entryId(edge.provider)} -> ${entryId(edge.dependent)} [${edge.key}]`).join("；")}；published=${format(published)}${kind === "close-order" ? `；close-started=${format(closing)}；closed=${format(closed)}` : ""}${failures.length > 0 ? `；失败=${failures.join("；")}` : ""}`,
        };
    } catch (error) {
        return {id: kind, result: "fail", evidence: `插件日志判定失败：${error instanceof Error ? error.message : String(error)}`};
    }
}

export async function observePluginOrder(
    stateRoot: string,
    evidencePath: string,
    kind: "activation-order" | "close-order",
): Promise<Observation> {
    try {
        const directory = join(stateRoot, "logs");
        const files = (await readdir(directory)).filter(isOwnedServerLogFile).sort();
        const lines = (await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")))).join("\n");
        await writeFile(evidencePath, lines, "utf8");
        const observation = assessPluginOrder(lines, kind);
        return {...observation, evidence: `${observation.evidence}；JSONL=${evidencePath}`};
    } catch (error) {
        return {id: kind, result: "fail", evidence: `无法读取产品插件日志：${error instanceof Error ? error.message : String(error)}`};
    }
}
