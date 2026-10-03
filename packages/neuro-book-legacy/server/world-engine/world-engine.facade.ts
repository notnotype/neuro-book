import {createClient, type Client} from "@libsql/client";
import {WorldCalendarLoader} from "nbook/server/world-engine/calendar";
import type {WorldCalendar} from "nbook/server/world-engine/calendar";
import {flattenAttrs, WorldSchemaLoader} from "nbook/server/world-engine/schema-loader";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import type {RuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
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
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldSubjectListItem,
    WorldIssue,
} from "nbook/server/world-engine/types";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import type {ProjectDatabaseModuleHandle} from "nbook/server/workspace-files/project-database-module";

type WorldEngineModule = {
    service: WorldEngineService;
    repository: WorldEngineRepository;
    calendar: WorldCalendar;
};

type WorldEngineClientEntry = {
    client: Client;
    closed: boolean;
};

type TransactionMode = "write" | "read" | "deferred";

export type ExecuteWorldMode = "readonly" | "readwrite";

export type ExecuteWorldResult = {
    data: unknown;
    issues: WorldIssue[];
};

export type ExecuteWorldOptions = {
    timeout?: number;
};

/** 世界引擎后端门面。 */
export class WorldEngineFacade {
    private readonly schemaLoader: WorldSchemaLoader;
    private readonly calendarLoader: WorldCalendarLoader;
    private readonly clients = new Set<WorldEngineClientEntry>();
    private accepting = true;
    private closed = false;
    private closing: Promise<void> | null = null;

    constructor(
        private readonly workspaceRoot: AbsoluteFsPath,
        private readonly workspace: ResolvedProjectWorkspace,
        private readonly database: ProjectDatabaseModuleHandle,
        compilerContext: RuntimeArtifactCompilerContext | Promise<RuntimeArtifactCompilerContext>,
    ) {
        this.schemaLoader = new WorldSchemaLoader(compilerContext);
        this.calendarLoader = new WorldCalendarLoader(compilerContext);
    }

    /**
     * 关闭当前generation仍持有的全部World Engine client。
     *
     * client只有在close成功后才从本handle registry移除；失败保留原entry供同一generation重试。
     */
    async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        if (this.closing) {
            return this.closing;
        }
        this.accepting = false;
        const attempt = (async () => {
            for (const entry of [...this.clients]) {
                await this.closeClientEntry(entry);
            }
            collectReleasedSqliteHandles({force: true});
            this.closed = true;
        })();
        this.closing = attempt;
        try {
            await attempt;
        } finally {
            if (!this.closed && this.closing === attempt) {
                this.closing = null;
            }
        }
    }

    /** 创建 subject + 初始化切面。 */
    async createSubject(input: CreateWorldSubjectInput): Promise<CreateWorldSubjectResult> {
        return this.runInTransaction((module) => module.service.createSubject(input));
    }

    /** 写入新切面。 */
    async writeSlice(input: SliceInput): Promise<SliceWriteResult> {
        return this.runInTransaction((module) => module.service.writeSlice(input));
    }

    /** 整块编辑已有切面。 */
    async editSlice(sliceId: string, input: SliceInput): Promise<SliceWriteResult> {
        return this.runInTransaction((module) => module.service.editSlice(sliceId, input));
    }

    /** 物理删除一个切面。 */
    async deleteSlice(sliceId: string): Promise<DeleteSliceResult> {
        return this.runInTransaction((module) => module.service.deleteSlice(sliceId));
    }

    /** 读取单个切面及 patch。 */
    async getSlice(sliceId: string): Promise<SliceListItem> {
        return this.runWithModule((module) => module.service.getSlice(sliceId));
    }

    /** 查询世界状态；公开入口负责决定是否允许全量查询。 */
    async queryState(query: {subjectIds?: string[]; type?: string; attrs?: string[]; at?: bigint; listLimit?: number}): Promise<QueryStateResult> {
        return this.runWithModule((module) => module.service.queryState(query));
    }

    /** 列出切面。 */
    async listSlices(query: {from?: bigint; to?: bigint; limit?: number; withPatches?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode} = {}): Promise<SliceListItem[]> {
        return this.runWithModule((module) => module.service.listSlices(query));
    }

    /** 列出 subject 身份。 */
    async listSubjects(query: {type?: string} = {}): Promise<WorldSubjectListItem[]> {
        return this.runWithModule((module) => module.service.listSubjects(query));
    }

    /** 语义搜索 EmbeddingText 字段。 */
    async searchText(query: string, options: {k?: number; threshold?: number; types?: string[]; attrs?: string[]; at?: bigint} = {}): Promise<Array<{subjectId: string; attr: string; text: string; score: number}>> {
        return this.runWithModule((module) => module.service.searchText(query, options));
    }

    /**
     * 列出 subject 身份元数据，不加载 World Engine schema/calendar。
     *
     * 该入口只服务 Plot ↔ World Engine 桥接读取：Plot 需要判断 subject 是否已登记，
     * 但不应该因为旧 Project 尚未初始化 calendar.ts 而无法打开。
     */
    async listSubjectIdentities(query: {ids?: string[]; type?: string} = {}): Promise<WorldSubjectListItem[]> {
        const entry = await this.createClientEntry();
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
    async getWorldSchema(): Promise<WorldSchemaProjection> {
        this.assertAccepting();
        const schema = await this.schemaLoader.load(this.workspace.root);
        const calendar = await this.calendarLoader.load(this.workspace.root);
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
    async parseTime(input: string): Promise<bigint> {
        this.assertAccepting();
        const calendar = await this.calendarLoader.load(this.workspace.root);
        return calendar.parse(input);
    }

    /** 格式化项目时间。 */
    async formatTime(instant: bigint): Promise<string> {
        this.assertAccepting();
        const calendar = await this.calendarLoader.load(this.workspace.root);
        return calendar.format(instant);
    }

    /** 执行 CodeAct 查询代码。 */
    async executeCodeActQuery(code: string): Promise<unknown> {
        return (await this.executeCodeActWorld(code, "readonly")).data;
    }

    /** 在同一 deferred 事务内执行 CodeAct 世界读写代码。 */
    async executeCodeActWorld(code: string, mode: ExecuteWorldMode = "readwrite", options: ExecuteWorldOptions = {}): Promise<ExecuteWorldResult> {
        return this.runInTransaction(async (module) => {
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
            return {
                data: data === undefined ? "执行完成" : data,
                issues: dedupeWorldIssues(issues),
            };
        }, "deferred");
    }

    private async runInTransaction<TResult>(callback: (module: WorldEngineModule) => Promise<TResult>, mode: TransactionMode = "write"): Promise<TResult> {
        const entry = await this.createClientEntry();
        const client = this.requireClient(entry);
        await client.execute(transactionBeginStatement(mode));
        try {
            const result = await callback(await this.createModuleFromExecutor(client));
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

    private async runWithModule<TResult>(callback: (module: WorldEngineModule) => Promise<TResult>): Promise<TResult> {
        const entry = await this.createClientEntry();
        const client = this.requireClient(entry);
        try {
            return await callback(await this.createModuleFromExecutor(client));
        } finally {
            await this.closeClientEntry(entry);
        }
    }

    private async createClientEntry(): Promise<WorldEngineClientEntry> {
        this.assertAccepting();
        const databasePath = await this.database.databasePath;
        const entry = {client: createClient({url: toSqliteFileUrl(databasePath)}), closed: false};
        this.clients.add(entry);
        return entry;
    }

    private async closeClientEntry(entry: WorldEngineClientEntry): Promise<void> {
        if (entry.closed) {
            this.clients.delete(entry);
            return;
        }
        entry.client.close();
        entry.closed = true;
        await Promise.resolve();
        collectReleasedSqliteHandles();
        this.clients.delete(entry);
    }

    private requireClient(entry: WorldEngineClientEntry): Client {
        if (entry.closed) {
            throw new Error("World Engine SQLite client 已关闭");
        }
        return entry.client;
    }

    private async createModuleFromExecutor(executor: Client): Promise<WorldEngineModule> {
        this.assertAccepting();
        const schema = await this.schemaLoader.load(this.workspace.root);
        const calendar = await this.calendarLoader.load(this.workspace.root);
        const repository = new WorldEngineRepository(executor);
        return {
            service: new WorldEngineService(repository, schema, calendar, {
                workspaceRoot: this.workspaceRoot,
                projectWorkspace: this.workspace,
            }),
            repository,
            calendar,
        };
    }

    /** generation开始关闭后拒绝创建新连接或读取配置文件。 */
    private assertAccepting(): void {
        if (!this.accepting) {
            throw new Error(`World Engine facade已进入关闭状态：${this.workspace.ref.projectRoot}`);
        }
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
