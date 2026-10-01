/**
 * 第二切片组合验收的真实装配：nbook.diagnostics、nbook.platform-files、nbook.sqlite 三个内置服务插件，
 * 加两个受信消费者。只用真实插件与真实 I/O（临时根下的日志目录、数据根与数据库目录），
 * 不初始化产品数据库、不执行产品 migration、不调用 Provider。
 *
 * - `notes`：依赖三项服务。write 阶段在数据根写整文件、在自己的 SQLite 资源里提交一行并记录诊断；
 *   read 阶段只读回文件与行。资源都登记在它自己的激活作用域上。
 * - `audit`：只加清单条目、不改内核的第二个独立消费者；验证同一解析作用域共享同一 SQLite 服务实例、
 *   不同 owner 作用域的同名资源互相隔离、同一物理文件不能有第二个 owner。
 */

import path from "node:path";

import type {ApplicationManifest} from "../../../runtime/application/application";
import type {DiagnosticsService, DiagnosticsStore} from "../../../runtime/diagnostics/diagnostics";
import {createDiagnosticsPlugin, diagnosticsKey, mechanismObservers} from "../../../runtime/diagnostics/diagnostics";
import type {PluginDefinition} from "../../../runtime/plugins/plugins";
import {defineServiceKey} from "../../../runtime/services/services";
import {createPlatformFilesPlugin, platformFilesKey} from "../../../server/features/platform-files/platform-files";
import type {PlatformFiles, RootGrant} from "../../../server/features/platform-files/platform-files";
import {createJsonlExporterFactory, createStderrFallback} from "../../../server/features/runtime-diagnostics/jsonl-exporter";
import {SqliteError, createSqlitePlugin, sqliteKey} from "../../../server/features/sqlite/sqlite";
import type {SqliteRow, SqliteService} from "../../../server/features/sqlite/sqlite";

import {NOTES_BODY, NOTES_FILE, NOTES_ROW, SECRET_SAMPLES, SERVICE_PLUGIN_IDS} from "./services-fixture";
import type {ServicePluginId} from "./services-fixture";

export type ServicesPhase = "write" | "read";

/** notes 消费者的授予：只读写数据根内的 notes 目录所需操作，不含删除。 */
export const notesGrantKey = defineServiceKey<RootGrant>("nbook.platform-files/notes-data");

export interface NotesResult {
    readonly phase: ServicesPhase;
    readonly text: string;
    readonly rows: ReadonlyArray<SqliteRow>;
    readonly files: PlatformFiles;
    readonly grant: RootGrant;
    readonly sqlite: SqliteService;
    readonly diagnostics: DiagnosticsService;
}

export interface AuditResult {
    readonly sharedSqliteInstance: boolean;
    readonly isolatedResourceFile: string;
    readonly secondOwnerCode: string | null;
}

/** 消费者把可观察结果放进宿主给的盒子；宿主只读它，不经它绕过服务解析。 */
export interface ServicesBox {
    notes: NotesResult | null;
    audit: AuditResult | null;
}

export interface ServicesManifestInput {
    readonly phase: ServicesPhase;
    readonly logDirectory: string;
    readonly dataRoot: string;
    readonly databaseDirectory: string;
    readonly store: DiagnosticsStore;
    readonly omit: ReadonlySet<ServicePluginId>;
    readonly box: ServicesBox;
}

export function createServicesManifest(input: ServicesManifestInput): ApplicationManifest {
    const providers: Record<ServicePluginId, PluginDefinition> = {
        "nbook.diagnostics": createDiagnosticsPlugin({
            location: "server",
            store: input.store,
            exporter: createJsonlExporterFactory({directory: input.logDirectory}),
            fallback: createStderrFallback(),
        }),
        "nbook.platform-files": createPlatformFilesPlugin({
            roots: [{id: "data", path: input.dataRoot, maxOperations: ["read", "write", "delete"]}],
            grants: [{key: notesGrantKey, root: "data", operations: ["read", "write"]}],
        }),
        "nbook.sqlite": createSqlitePlugin(),
    };
    return {
        keys: [diagnosticsKey, platformFilesKey, notesGrantKey, sqliteKey],
        receivers: [],
        plugins: [...SERVICE_PLUGIN_IDS.filter((id) => !input.omit.has(id)).map((id) => providers[id]), notesPlugin(input), auditPlugin(input)],
        gates: [
            {id: "diagnostics", kind: "activate", entry: {plugin: "nbook.diagnostics", entry: "main"}},
            {id: "notes", kind: "activate", entry: {plugin: "notes", entry: "main"}},
            {id: "audit", kind: "activate", entry: {plugin: "audit", entry: "main"}},
        ],
        observers: mechanismObservers(input.store),
    };
}

function notesPlugin(input: ServicesManifestInput): PluginDefinition {
    return {
        id: "notes",
        entries: [{
            id: "main",
            location: "server",
            dependencies: [{key: diagnosticsKey}, {key: platformFilesKey}, {key: notesGrantKey}, {key: sqliteKey}],
            activate: async (context) => {
                const diagnostics = context.services.require(diagnosticsKey);
                const files = context.services.require(platformFilesKey);
                const grant = context.services.require(notesGrantKey);
                const resolved = await context.services.resolve(sqliteKey);
                if (resolved.status !== "resolved") {
                    throw new Error(`sqlite 未解析：${resolved.reason}`);
                }
                const sqlite = resolved.instance;
                // 数据 owner 是本激活作用域：资源在消费者收口时关闭，且先于它借用的 sqlite 服务释放。
                const resource = await sqlite.register(
                    {
                        name: "notes",
                        location: {path: path.join(input.databaseDirectory, "notes.sqlite")},
                        access: "read-write",
                        create: input.phase === "write",
                        schemaOwner: "smoke.notes",
                    },
                    {scope: context.scope, dependsOn: [resolved.binding.dependency]},
                );
                const work = context.scope.createChild(`notes-${input.phase}`);
                const borrow = await resource.borrow({mode: input.phase === "write" ? "write" : "read", scope: work});
                let rows: ReadonlyArray<SqliteRow>;
                try {
                    if (input.phase === "write") {
                        borrow.execute("create table if not exists notes (id integer primary key, body text not null)");
                        borrow.begin("immediate");
                        borrow.execute("insert into notes (body) values (?)", [NOTES_ROW]);
                        const committed = borrow.commit();
                        if (committed.status !== "committed") {
                            throw committed.error;
                        }
                    }
                    rows = borrow.query("select id, body from notes order by id");
                } finally {
                    borrow.release();
                }
                const closedWork = await work.close();
                if (closedWork.status !== "closed") {
                    throw new Error(`借用作用域未收口：${closedWork.reason}`);
                }
                if (input.phase === "write") {
                    await files.mkdir(grant, "notes");
                    await files.replaceFile(grant, NOTES_FILE, NOTES_BODY, {durable: true});
                    diagnostics.record({
                        level: "warn",
                        event: "notes.secret-sample",
                        message: `token=${SECRET_SAMPLES.token} Bearer ${SECRET_SAMPLES.token}`,
                        data: {password: SECRET_SAMPLES.password, hint: `password=${SECRET_SAMPLES.password}`},
                        source: {plugin: "notes"},
                    });
                }
                const text = await files.readText(grant, NOTES_FILE);
                diagnostics.record({
                    level: "info",
                    event: `notes.${input.phase}`,
                    message: `notes ${input.phase} 完成`,
                    data: {rows: rows.length, bytes: text.length},
                    source: {plugin: "notes", scopeId: context.scope.id},
                });
                input.box.notes = {phase: input.phase, text, rows, files, grant, sqlite, diagnostics};
                return {};
            },
        }],
    };
}

function auditPlugin(input: ServicesManifestInput): PluginDefinition {
    return {
        id: "audit",
        entries: [{
            id: "main",
            location: "server",
            dependencies: [{key: sqliteKey}, {key: diagnosticsKey}],
            activate: async (context) => {
                const resolved = await context.services.resolve(sqliteKey);
                if (resolved.status !== "resolved") {
                    throw new Error(`sqlite 未解析：${resolved.reason}`);
                }
                const sqlite = resolved.instance;
                // 同名资源、不同 owner 作用域、不同文件：各自可见，互不串用。
                const own = await sqlite.register(
                    {name: "notes", location: {path: path.join(input.databaseDirectory, "audit.sqlite")}, access: "read-write", create: true, schemaOwner: "smoke.audit"},
                    {scope: context.scope, dependsOn: [resolved.binding.dependency]},
                );
                let secondOwnerCode: string | null = null;
                try {
                    await sqlite.register(
                        {name: "stolen", location: {path: path.join(input.databaseDirectory, "notes.sqlite")}, access: "read-write", create: false, schemaOwner: "smoke.audit"},
                        {scope: context.scope, dependsOn: [resolved.binding.dependency]},
                    );
                } catch (error) {
                    secondOwnerCode = error instanceof SqliteError ? error.code : String(error);
                }
                input.box.audit = {
                    sharedSqliteInstance: input.box.notes !== null && input.box.notes.sqlite === sqlite,
                    isolatedResourceFile: path.basename(sqlite.resource("notes", {scope: context.scope}).file.absolutePath),
                    secondOwnerCode,
                };
                context.services.require(diagnosticsKey).record({level: "info", event: "audit.checked", message: `audit 自有资源 ${own.name}`, source: {plugin: "audit"}});
                return {};
            },
        }],
    };
}
