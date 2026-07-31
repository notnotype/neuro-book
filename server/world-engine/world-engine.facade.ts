import fs from "node:fs/promises";
import {join} from "node:path";
import {createClient, type Client} from "@libsql/client";
import {WorldCalendarLoader} from "nbook/server/world-engine/calendar";
import type {WorldCalendar} from "nbook/server/world-engine/calendar";
import {flattenAttrs, WorldSchemaLoader} from "nbook/server/world-engine/schema-loader";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import {WorldEngineService} from "nbook/server/world-engine/world-engine.service";
import {executeCodeAct} from "nbook/server/world-engine/codeact-sandbox";
import {createWorldApi} from "nbook/server/world-engine/codeact-api";
import {dedupeWorldIssues} from "nbook/server/world-engine/world-issue-builder";
import type {
    CreateWorldSubjectInput,
    DeleteSliceResult,
    QueryStateResult,
    SliceInput,
    SliceListItem,
    SliceWriteResult,
    CreateWorldSubjectResult,
    WorldEngineWorldKey,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldSubjectListItem,
    WorldIssue,
} from "nbook/server/world-engine/types";
import superjson from "superjson";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";
import {resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {ensureRpWorldDatabase, resolveProjectDatabasePath, resolveProjectRpWorldDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

type WorldEngineModule = {
    service: WorldEngineService;
    repository: WorldEngineRepository;
    calendar: WorldCalendar;
};

type WorldEngineClientEntry = {
    client: Client | null;
};

type TransactionMode = "write" | "read" | "deferred";

export type WorldEngineStatus = {
    worldKey: WorldEngineWorldKey;
    initialized: boolean;
    missing: string[];
    errors: Array<{path: string; message: string}>;
};

export type ExecuteWorldMode = "readonly" | "readwrite";

export type ExecuteWorldResult = {
    /** 执行脚本时固定的原始 World Engine Instant。 */
    instant: bigint;
    data: unknown;
    issues: WorldIssue[];
};

export type ExecuteWorldOptions = {
    timeout?: number;
    /** 世界线：main = 写作模式主世界线（默认），rp = RP 模式独立世界线。 */
    worldKey?: WorldEngineWorldKey;
    /** readwrite 操作的幂等键；相同世界线内重复调用直接返回首次已提交结果。 */
    operationId?: string;
};

/** 世界引擎后端门面。 */
export class WorldEngineFacade {
    private readonly schemaLoader = new WorldSchemaLoader();
    private readonly calendarLoader = new WorldCalendarLoader();

    constructor(private readonly workspaceRoot: AbsoluteFsPath) {}

    /**
     * 释放 World Engine 对该 Project 的句柄占用。World Engine 不缓存 client（每次调用即开即关），
     * 方法体只做强制 GC 兜底。Task 94 后已不再注册为 ProjectSession 资源属主——生产的删除/关停
     * 由 ProjectSession closeProject 统一收尾，本方法现仅供测试清理直接调用。
     */
    async closeProject(_projectPath: string): Promise<void> {
        collectReleasedSqliteHandles({force: true});
    }

    /** 创建 subject + 初始化切面。 */
    async createSubject(projectPath: string, input: CreateWorldSubjectInput, worldKey: WorldEngineWorldKey = "main"): Promise<CreateWorldSubjectResult> {
        return this.runInTransaction(projectPath, (module) => module.service.createSubject(input), "write", worldKey);
    }

    /** 写入新切面。 */
    async writeSlice(projectPath: string, input: SliceInput, worldKey: WorldEngineWorldKey = "main"): Promise<SliceWriteResult> {
        return this.runInTransaction(projectPath, (module) => module.service.writeSlice(input), "write", worldKey);
    }

    /** 整块编辑已有切面。 */
    async editSlice(projectPath: string, sliceId: string, input: SliceInput, worldKey: WorldEngineWorldKey = "main"): Promise<SliceWriteResult> {
        return this.runInTransaction(projectPath, (module) => module.service.editSlice(sliceId, input), "write", worldKey);
    }

    /** 物理删除一个切面。 */
    async deleteSlice(projectPath: string, sliceId: string, worldKey: WorldEngineWorldKey = "main"): Promise<DeleteSliceResult> {
        return this.runInTransaction(projectPath, (module) => module.service.deleteSlice(sliceId), "write", worldKey);
    }

    /** 读取单个切面及 patch。 */
    async getSlice(projectPath: string, sliceId: string, worldKey: WorldEngineWorldKey = "main"): Promise<SliceListItem> {
        return this.runWithModule(projectPath, (module) => module.service.getSlice(sliceId), worldKey);
    }

    /** 查询世界状态；公开入口负责决定是否允许全量查询。 */
    async queryState(projectPath: string, query: {subjectIds?: string[]; type?: string; attrs?: string[]; at?: bigint; listLimit?: number}, worldKey: WorldEngineWorldKey = "main"): Promise<QueryStateResult> {
        return this.runWithModule(projectPath, (module) => module.service.queryState(query), worldKey);
    }

    /** 列出切面。 */
    async listSlices(projectPath: string, query: {from?: bigint; to?: bigint; limit?: number; withPatches?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode} = {}, worldKey: WorldEngineWorldKey = "main"): Promise<SliceListItem[]> {
        return this.runWithModule(projectPath, (module) => module.service.listSlices(query), worldKey);
    }

    /** 列出 subject 身份。 */
    async listSubjects(projectPath: string, query: {type?: string} = {}, worldKey: WorldEngineWorldKey = "main"): Promise<WorldSubjectListItem[]> {
        return this.runWithModule(projectPath, (module) => module.service.listSubjects(query), worldKey);
    }

    /** 语义搜索 EmbeddingText 字段。 */
    async searchText(projectPath: string, query: string, options: {k?: number; threshold?: number; types?: string[]; attrs?: string[]; at?: bigint} = {}, worldKey: WorldEngineWorldKey = "main"): Promise<Array<{subjectId: string; attr: string; text: string; score: number}>> {
        return this.runWithModule(projectPath, (module) => module.service.searchText(query, options), worldKey);
    }

    /**
     * 列出 subject 身份元数据，不加载 World Engine schema/calendar。
     *
     * 该入口只服务 Plot ↔ World Engine 桥接读取：Plot 需要判断 subject 是否已登记，
     * 但不应该因为旧 Project 尚未初始化 calendar.ts 而无法打开。
     */
    async listSubjectIdentities(projectPath: string, query: {ids?: string[]; type?: string} = {}): Promise<WorldSubjectListItem[]> {
        const entry = await this.createClientEntry(projectPath);
        const client = this.requireClient(entry);
        try {
            const repository = new WorldEngineRepository(client);
            const subjects = await repository.listSubjects(query);
            return subjects.map((subject) => ({
                id: subject.id,
                type: subject.type,
                name: subject.name,
            }));
        } finally {
            await this.closeClientEntry(entry);
        }
    }

    /** 返回 Agent 友好的 world schema 投影。 */
    async getWorldSchema(projectPath: string, worldKey: WorldEngineWorldKey = "main"): Promise<WorldSchemaProjection> {
        const configRoot = this.configRoot(projectPath, worldKey);
        const schema = await this.schemaLoader.load(configRoot);
        const calendar = await this.calendarLoader.load(configRoot);
        return {
            subjectTypes: Object.entries(schema.subjectTypes).map(([type, subjectType]) => ({
                type,
                desc: subjectType.desc,
                attrs: flattenAttrs(subjectType.attrs),
            })),
            calendar: calendar.projection(),
        };
    }

    /** 解析项目日历字符串。 */
    async parseTime(projectPath: string, input: string, worldKey: WorldEngineWorldKey = "main"): Promise<bigint> {
        const calendar = await this.calendarLoader.load(this.configRoot(projectPath, worldKey));
        return calendar.parse(input);
    }

    /** 格式化项目时间。 */
    async formatTime(projectPath: string, instant: bigint, worldKey: WorldEngineWorldKey = "main"): Promise<string> {
        const calendar = await this.calendarLoader.load(this.configRoot(projectPath, worldKey));
        return calendar.format(instant);
    }

    /**
     * 世界线配置就绪状态：检查 schema 与 calendar 文件是否存在，供前端区分
     * 「尚未初始化」与真实错误（rp 世界线在 bootstrap 前属于正常的未初始化态）。
     */
    async getWorldStatus(projectPath: string, worldKey: WorldEngineWorldKey = "main"): Promise<WorldEngineStatus> {
        const configRoot = this.configRoot(projectPath, worldKey);
        const prefix = worldKey === "rp" ? "rp/world-engine" : "world-engine";
        const missing: string[] = [];
        const errors: WorldEngineStatus["errors"] = [];
        if (!await fileExists(join(configRoot, "world-engine", "schema", "index.ts"))) {
            missing.push(`${prefix}/schema/index.ts`);
        }
        if (!await fileExists(join(configRoot, "world-engine", "calendar.ts"))) {
            missing.push(`${prefix}/calendar.ts`);
        }
        if (!missing.includes(`${prefix}/schema/index.ts`)) {
            try {
                await this.schemaLoader.load(configRoot);
            } catch (error) {
                errors.push({path: `${prefix}/schema/index.ts`, message: errorText(error)});
            }
        }
        if (!missing.includes(`${prefix}/calendar.ts`)) {
            try {
                await this.calendarLoader.load(configRoot);
            } catch (error) {
                errors.push({path: `${prefix}/calendar.ts`, message: errorText(error)});
            }
        }
        return {worldKey, initialized: missing.length === 0 && errors.length === 0, missing, errors};
    }

    /**
     * 世界线配置根：main = 项目根（world-engine/），rp = rp/ 子树（rp/world-engine/）。
     * 写作与 RP 的 schema/calendar 完全分离，互不读取。
     */
    private configRoot(projectPath: string, worldKey: WorldEngineWorldKey): AbsoluteFsPath {
        const projectRoot = resolveProjectWorkspaceRoot(this.workspaceRoot, normalizeProjectPath(projectPath));
        return absoluteFsPath(worldKey === "rp" ? join(projectRoot, "rp") : projectRoot);
    }

    /** 执行 CodeAct 查询代码。 */
    async executeCodeActQuery(projectPath: string, code: string, options: ExecuteWorldOptions = {}): Promise<unknown> {
        return (await this.executeCodeActWorld(projectPath, code, "readonly", options)).data;
    }

    /** 在同一 deferred 事务内执行 CodeAct 世界读写代码。 */
    async executeCodeActWorld(projectPath: string, code: string, mode: ExecuteWorldMode = "readwrite", options: ExecuteWorldOptions = {}): Promise<ExecuteWorldResult> {
        if (options.operationId && mode !== "readwrite") {
            throw new Error("World Engine operationId 只用于 readwrite 操作。");
        }
        if (options.operationId && (options.operationId.length > 200 || !/^[\w:.-]+$/u.test(options.operationId))) {
            throw new Error("World Engine operationId 只能包含字母、数字、下划线、冒号、点和短横线，且不超过 200 字符。");
        }
        return this.runInTransaction(projectPath, async (module) => {
            if (options.operationId) {
                const cached = await module.repository.findOperation(options.operationId);
                if (cached !== null) return superjson.parse<ExecuteWorldResult>(cached);
            }
            const currentInstant = await module.service.getCurrentInstant();
            const issues: WorldIssue[] = [];

            const worldApi = createWorldApi({
                service: module.service,
                repository: module.repository,
                currentInstant,
                mode,
                issueCollector: issues,
                parseTime: (input) => module.calendar.parse(input),
                formatTime: (instant) => module.calendar.format(instant),
            });

            const data = await executeCodeAct(code, worldApi, {
                timeout: options.timeout ?? (mode === "readwrite" ? 15_000 : 5_000),
            });
            const result: ExecuteWorldResult = {
                instant: currentInstant,
                data: data === undefined ? "执行完成" : data,
                issues: dedupeWorldIssues(issues),
            };
            if (options.operationId) await module.repository.createOperation(options.operationId, superjson.stringify(result));
            return result;
        }, "deferred", options.worldKey ?? "main");
    }

    private async runInTransaction<TResult>(projectPath: string, callback: (module: WorldEngineModule) => Promise<TResult>, mode: TransactionMode = "write", worldKey: WorldEngineWorldKey = "main"): Promise<TResult> {
        const entry = await this.createClientEntry(projectPath, worldKey);
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const client = this.requireClient(entry);
        await client.execute(transactionBeginStatement(mode));
        try {
            const result = await callback(await this.createModuleFromExecutor(client, normalizedProjectPath, worldKey));
            await client.execute("COMMIT");
            return result;
        } catch (error) {
            try {
                await client.execute("ROLLBACK");
            } catch {
                // 保留原始业务错误，rollback 失败只说明连接已不可恢复或事务已结束。
            }
            throw error;
        } finally {
            await this.closeClientEntry(entry);
        }
    }

    private async runWithModule<TResult>(projectPath: string, callback: (module: WorldEngineModule) => Promise<TResult>, worldKey: WorldEngineWorldKey = "main"): Promise<TResult> {
        const entry = await this.createClientEntry(projectPath, worldKey);
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const client = this.requireClient(entry);
        try {
            return await callback(await this.createModuleFromExecutor(client, normalizedProjectPath, worldKey));
        } finally {
            await this.closeClientEntry(entry);
        }
    }

    private async createClientEntry(projectPath: string, worldKey: WorldEngineWorldKey = "main"): Promise<WorldEngineClientEntry> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        assertProjectOpen(normalizedProjectPath);
        markProjectActivity(normalizedProjectPath);
        if (worldKey === "rp") {
            const rpDatabasePath = resolveProjectRpWorldDatabasePath(this.workspaceRoot, normalizedProjectPath);
            await ensureRpWorldDatabase(rpDatabasePath);
            return {client: createClient({url: toSqliteFileUrl(rpDatabasePath)})};
        }
        const databasePath = resolveProjectDatabasePath(this.workspaceRoot, normalizedProjectPath);
        return {client: createClient({url: toSqliteFileUrl(databasePath)})};
    }

    private async closeClientEntry(entry: WorldEngineClientEntry): Promise<void> {
        const client = this.requireClient(entry);
        client.close();
        entry.client = null;
        await Promise.resolve();
        collectReleasedSqliteHandles();
    }

    private requireClient(entry: WorldEngineClientEntry): Client {
        if (!entry.client) {
            throw new Error("World Engine SQLite client 已关闭");
        }
        return entry.client;
    }

    private async createModuleFromExecutor(executor: Client, projectPath: string, worldKey: WorldEngineWorldKey = "main"): Promise<WorldEngineModule> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const configRoot = this.configRoot(normalizedProjectPath, worldKey);
        const schema = await this.schemaLoader.load(configRoot);
        const calendar = await this.calendarLoader.load(configRoot);
        const repository = new WorldEngineRepository(executor);
        return {
            service: new WorldEngineService(repository, schema, calendar, projectPath),
            repository,
            calendar,
        };
    }
}

async function fileExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

function transactionBeginStatement(mode: TransactionMode): string {
    if (mode === "write") {
        return "BEGIN IMMEDIATE";
    }
    if (mode === "read") {
        return "BEGIN TRANSACTION READONLY";
    }
    return "BEGIN DEFERRED";
}

/** 提取配置 loader 错误中的稳定消息。 */
function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
