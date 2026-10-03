import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {migrateSessionJsonlModels, type SessionModelEntryMappings} from "nbook/server/agent/session/session-model-redaction";
import {readGlobalConfigFileAtWorkspaceRoot} from "nbook/server/config/config-service";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

type MappingEntry = {
    sessionId: string;
    entryId: string;
    providerConfigId: string;
    modelId: string;
};

export type SessionModelMigrationReport = {
    dryRun: boolean;
    planned: string[];
    explicit: string[];
    blocked: Array<{fileName: string; message: string}>;
    unusedMappings: string[];
    artifacts: Array<{fileName: string; names: string[]}>;
    removedArtifacts: number;
};

/** 使用逐Session entry显式映射脱敏历史Agent Session模型。 */
async function main(): Promise<void> {
    const report = await runSessionModelRefMigration(process.argv.slice(2));
    console.info(JSON.stringify(report, null, 2));
    if (!report.dryRun) {
        console.info(`Agent Session model migration完成：${String(report.planned.length)}个Session，清理${String(report.removedArtifacts)}个敏感临时副本。`);
    }
}

/** 执行一次只读预检或逐Session原子脱敏迁移。 */
export async function runSessionModelRefMigration(args: string[]): Promise<SessionModelMigrationReport> {
    const options = parseArguments(args);
    const mappings = await readMappings(options.mappingPath);
    await validateMappingTargets(options.workspaceRoot, mappings);
    const sessionsRoot = resolve(options.workspaceRoot, ".nbook", "agent", "sessions");
    const files = (await readdir(sessionsRoot, {withFileTypes: true}).catch(() => []))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .sort((left, right) => left.name.localeCompare(right.name));
    const planned: string[] = [];
    const explicit: string[] = [];
    const blocked: Array<{fileName: string; message: string}> = [];
    const usedMappings = new Set<string>();
    const artifacts: Array<{fileName: string; names: string[]}> = [];

    for (const file of files) {
        try {
            const result = await migrateSessionJsonlModels(resolve(sessionsRoot, file.name), mappings, {dryRun: true});
            for (const key of result.usedMappings) usedMappings.add(key);
            if (result.artifacts.length > 0) artifacts.push({fileName: file.name, names: result.artifacts});
            (result.changed ? planned : explicit).push(file.name);
        } catch (error) {
            blocked.push({fileName: file.name, message: error instanceof Error ? error.message : String(error)});
        }
    }
    const unusedMappings = Object.keys(mappings).filter((key) => !usedMappings.has(key));
    const report: SessionModelMigrationReport = {
        dryRun: options.dryRun,
        planned,
        explicit,
        blocked,
        unusedMappings,
        artifacts,
        removedArtifacts: 0,
    };
    if (blocked.length > 0 || unusedMappings.length > 0) {
        throw new Error("Session model mapping预检失败；未修改任何Session。" );
    }
    if (options.dryRun) return report;

    for (const fileName of [...planned, ...explicit]) {
        const result = await migrateSessionJsonlModels(resolve(sessionsRoot, fileName), mappings);
        report.removedArtifacts += result.removedArtifacts.length;
    }
    return report;
}

function parseArguments(args: string[]): {workspaceRoot: string; mappingPath: string; dryRun: boolean} {
    let workspaceRoot = "";
    let mappingPath = "";
    let dryRun = false;
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--workspace-root") {
            workspaceRoot = resolve(args[index + 1] ?? "");
            index += 1;
        } else if (argument === "--mapping") {
            mappingPath = resolve(args[index + 1] ?? "");
            index += 1;
        } else if (argument === "--dry-run") {
            dryRun = true;
        } else {
            throw new Error(`未知参数：${argument ?? ""}`);
        }
    }
    if (!workspaceRoot || !mappingPath) {
        throw new Error("需要--workspace-root <root>与--mapping <mapping.json>。" );
    }
    return {workspaceRoot, mappingPath, dryRun};
}

async function readMappings(path: string): Promise<SessionModelEntryMappings> {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value) || !("mappings" in value) || !Array.isArray(value.mappings)) {
        throw new Error("mapping.json必须是{mappings:[...]}。" );
    }
    const result: Record<string, {providerConfigId: string; modelId: string}> = {};
    for (const item of value.mappings) {
        const entry = parseMappingEntry(item);
        const key = `${entry.sessionId}:${entry.entryId}`;
        if (result[key]) throw new Error(`mapping.json包含重复entry：${key}`);
        result[key] = {providerConfigId: entry.providerConfigId, modelId: entry.modelId};
    }
    return result;
}

function parseMappingEntry(value: unknown): MappingEntry {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mapping entry必须是对象。" );
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some((key) => !["sessionId", "entryId", "providerConfigId", "modelId"].includes(key))) {
        throw new Error("mapping entry包含未知字段。" );
    }
    const sessionId = identity(record.sessionId);
    const entryId = identity(record.entryId);
    const providerConfigId = text(record.providerConfigId);
    const modelId = text(record.modelId);
    if (!sessionId || !entryId || !providerConfigId || !modelId) throw new Error("mapping entry四个身份字段都必须非空。" );
    return {sessionId, entryId, providerConfigId, modelId};
}

async function validateMappingTargets(workspaceRoot: string, mappings: SessionModelEntryMappings): Promise<void> {
    const config = await readGlobalConfigFileAtWorkspaceRoot(absoluteFsPath(workspaceRoot));
    const providers = new Map((config.models?.providers ?? []).map((provider) => [provider.id, provider]));
    for (const [key, mapping] of Object.entries(mappings)) {
        const provider = providers.get(mapping.providerConfigId);
        if (!provider) throw new Error(`mapping ${key}指向不存在的Provider Config：${mapping.providerConfigId}`);
        if (!provider.models.some((model) => model.id === mapping.modelId)) {
            throw new Error(`mapping ${key}指向不存在的模型：${mapping.providerConfigId}/${mapping.modelId}`);
        }
    }
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identity(value: unknown): string | null {
    if (typeof value === "number" && Number.isInteger(value)) return String(value);
    return text(value);
}

if (import.meta.main) await main();
