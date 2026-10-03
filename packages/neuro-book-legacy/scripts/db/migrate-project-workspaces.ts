import fs from "node:fs/promises";
import path from "node:path";
import {createClient, type Client} from "@libsql/client";
import * as yaml from "yaml";

type CliOptions = {
    workspaceRoot: string;
    apply: boolean;
    overwriteManifest: boolean;
};

type LegacyWorkspaceManifest = {
    displayName?: unknown;
    slug?: unknown;
};

type ProjectAction = {
    projectName: string;
    projectRoot: string;
    projectYamlPath: string;
    projectDatabasePath: string;
    title: string;
    summary: string;
    hasProjectYaml: boolean;
    hasProjectDatabase: boolean;
};

const PROJECT_DATABASE_RELATIVE_PATH = ".nbook/project.sqlite";
const STORY_PLOT_BACKUP_RELATIVE_PATH = ".nbook/story-plot-backup.json";

/**
 * 将现有 Project Workspace 目录规范化为 project.yaml + Project SQLite 结构。
 */
async function main(): Promise<void> {
    const options = parseCliOptions(process.argv.slice(2));
    const workspaceRoot = path.resolve(process.cwd(), options.workspaceRoot);
    await assertDirectory(workspaceRoot, "Workspace Root 不存在");

    const actions = await collectProjectActions(workspaceRoot);
    if (actions.length === 0) {
        console.log(`${displayPath(workspaceRoot)} 下没有可迁移的 Project Workspace。`);
        return;
    }

    console.log(`${options.apply ? "执行" : "预演"} Project Workspace 规范化：${displayPath(workspaceRoot)}`);
    if (!options.apply) {
        console.log("当前是 dry-run，不会写入文件。确认无误后加 --apply 执行。");
    }

    for (const action of actions) {
        await runAction(action, options);
    }
}

async function collectProjectActions(workspaceRoot: string): Promise<ProjectAction[]> {
    const entries = await fs.readdir(workspaceRoot, {withFileTypes: true});
    const actions: ProjectAction[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) {
            continue;
        }

        const projectRoot = path.join(workspaceRoot, entry.name);
        if (!await looksLikeProjectWorkspace(projectRoot)) {
            continue;
        }

        const projectYamlPath = path.join(projectRoot, "project.yaml");
        const legacyManifestPath = path.join(projectRoot, "workspace.yaml");
        const projectDatabasePath = path.join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH);
        const existingProjectManifest = await readYamlFile<{title?: unknown; summary?: unknown}>(projectYamlPath);
        const legacyManifest = await readYamlFile<LegacyWorkspaceManifest>(legacyManifestPath);
        const title = normalizeTitle(existingProjectManifest?.title, legacyManifest?.displayName, entry.name);
        const summary = typeof existingProjectManifest?.summary === "string" ? existingProjectManifest.summary : "";

        actions.push({
            projectName: entry.name,
            projectRoot,
            projectYamlPath,
            projectDatabasePath,
            title,
            summary,
            hasProjectYaml: await fileExists(projectYamlPath),
            hasProjectDatabase: await fileExists(projectDatabasePath),
        });
    }

    return actions.sort((left, right) => left.projectName.localeCompare(right.projectName));
}

async function looksLikeProjectWorkspace(projectRoot: string): Promise<boolean> {
    const markers = ["project.yaml", "workspace.yaml", "manuscript", "lorebook", "AGENTS.md", "PROJECT-STATUS.md"];
    for (const marker of markers) {
        if (await fileExists(path.join(projectRoot, marker))) {
            return true;
        }
    }
    return false;
}

async function runAction(action: ProjectAction, options: CliOptions): Promise<void> {
    console.log(`\n- workspace/${action.projectName}`);
    console.log(`  title: ${action.title}`);
    console.log(`  project.yaml: ${action.hasProjectYaml ? options.overwriteManifest ? "已存在，将覆盖" : "已存在，保留" : "不存在，将创建"}`);
    console.log(`  project.sqlite: ${action.hasProjectDatabase ? "已存在，校验 schema" : "不存在，将初始化"}`);

    if (!options.apply) {
        return;
    }

    if (!action.hasProjectYaml || options.overwriteManifest) {
        await fs.writeFile(action.projectYamlPath, yaml.stringify({
            kind: "novel",
            title: action.title,
            summary: action.summary,
        }), "utf-8");
    }

    await fs.mkdir(path.dirname(action.projectDatabasePath), {recursive: true});
    const client = createClient({url: toSqliteFileUrl(action.projectDatabasePath)});
    try {
        await client.execute("PRAGMA foreign_keys = ON");
        await initProjectDatabase(client, action.projectRoot);
    } finally {
        client.close();
    }
}

async function initProjectDatabase(client: Client, projectRoot: string): Promise<void> {
    for (const statement of splitSqlStatements(PROJECT_MIGRATION_SQL)) {
        await client.execute(statement);
    }
    await migratePlotSceneBridgeSchema(client, projectRoot);
}

async function readYamlFile<T>(filePath: string): Promise<T | null> {
    try {
        return yaml.parse(await fs.readFile(filePath, "utf-8")) as T;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

function normalizeTitle(...candidates: unknown[]): string {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            return String(candidate);
        }
    }
    return "Untitled Project";
}

function parseCliOptions(args: string[]): CliOptions {
    const options: CliOptions = {
        workspaceRoot: "workspace",
        apply: false,
        overwriteManifest: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--workspace-root") {
            options.workspaceRoot = requireValue(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--apply") {
            options.apply = true;
            continue;
        }
        if (arg === "--overwrite-manifest") {
            options.overwriteManifest = true;
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
        throw new Error(`未知参数：${arg}`);
    }

    return options;
}

function requireValue(args: string[], index: number, name: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`${name} 需要一个值`);
    }
    return value;
}

function printHelp(): void {
    console.log(`Usage:
  bun scripts/db/migrate-project-workspaces.ts [--workspace-root <dir>] [--apply] [--overwrite-manifest]

Options:
  --workspace-root <dir>   Workspace Root，默认 workspace
  --apply                  实际写入 project.yaml 并初始化 .nbook/project.sqlite；不传则只预演
  --overwrite-manifest     project.yaml 已存在时也按当前目录 / workspace.yaml 重新生成

说明：
  本脚本只规范化现有 Project Workspace 目录，不迁移旧 Plot 数据。
  旧 workspace.yaml 只用于推导 project.yaml.title，不会被删除。
`);
}

async function assertDirectory(filePath: string, message: string): Promise<void> {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isDirectory()) {
            throw new Error(`${message}：${displayPath(filePath)}`);
        }
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            throw new Error(`${message}：${displayPath(filePath)}`);
        }
        throw error;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

function toSqliteFileUrl(filePath: string): string {
    return `file:${path.resolve(filePath).replaceAll("\\", "/")}`;
}

function displayPath(filePath: string): string {
    return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

function splitSqlStatements(sql: string): string[] {
    return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

/** 将旧 StoryPlot 模型迁移为 Scene 字段，并清理 plot:// 剧情引用。 */
async function migratePlotSceneBridgeSchema(client: Client, projectRoot: string): Promise<void> {
    await ensureStorySceneWorldAnchorColumns(client);
    await client.execute("PRAGMA foreign_keys = OFF");
    try {
        await backupAndMergeStoryPlots(client, projectRoot);
        await rebuildStorySceneRefWithoutPlotTarget(client);
        await client.execute(`DROP INDEX IF EXISTS "StoryPlot_sceneId_sortOrder_key"`);
        await client.execute(`DROP INDEX IF EXISTS "StoryPlot_sceneId_sortOrder_idx"`);
        await client.execute(`DROP TABLE IF EXISTS "StoryPlot"`);
    } finally {
        await client.execute("PRAGMA foreign_keys = ON");
    }
}

/** 补齐早期 Project SQLite 缺少的 Scene World Anchor 列。 */
async function ensureStorySceneWorldAnchorColumns(client: Client): Promise<void> {
    const columns = await tableColumns(client, "StoryScene");
    if (!columns.has("startInstant")) {
        await client.execute(`ALTER TABLE "StoryScene" ADD COLUMN "startInstant" BIGINT`);
    }
    if (!columns.has("endInstant")) {
        await client.execute(`ALTER TABLE "StoryScene" ADD COLUMN "endInstant" BIGINT`);
    }
    if (!columns.has("subjectIdsJson")) {
        await client.execute(`ALTER TABLE "StoryScene" ADD COLUMN "subjectIdsJson" TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!columns.has("locationSubjectId")) {
        await client.execute(`ALTER TABLE "StoryScene" ADD COLUMN "locationSubjectId" TEXT`);
    }
    await client.execute(`CREATE INDEX IF NOT EXISTS "StoryScene_startInstant_idx" ON "StoryScene"("startInstant")`);
}

/** 备份旧 Plot 行，并将其剧情信息分段合并到所属 Scene。 */
async function backupAndMergeStoryPlots(client: Client, projectRoot: string): Promise<void> {
    if (!await sqliteTableExists(client, "StoryPlot")) {
        return;
    }

    const plotRows = await client.execute(`
        SELECT "id", "sceneId", "sortOrder", "kind", "summary", "effect", "writingTip", "note", "createdAt", "updatedAt"
        FROM "StoryPlot"
        ORDER BY "sceneId" ASC, "sortOrder" ASC, "id" ASC
    `);
    if (plotRows.rows.length === 0) {
        return;
    }

    const backupPath = path.join(projectRoot, STORY_PLOT_BACKUP_RELATIVE_PATH);
    if (!await fileExists(backupPath)) {
        await fs.writeFile(backupPath, JSON.stringify({
            migratedAt: new Date().toISOString(),
            sourceTable: "StoryPlot",
            plots: plotRows.rows,
        }, null, 2), "utf-8");
    }

    const rowsByScene = new Map<number, Array<Record<string, unknown>>>();
    for (const row of plotRows.rows) {
        const sceneId = Number(row.sceneId);
        const rows = rowsByScene.get(sceneId) ?? [];
        rows.push(row);
        rowsByScene.set(sceneId, rows);
    }

    for (const [sceneId, rows] of rowsByScene) {
        const sceneResult = await client.execute({
            sql: `SELECT "summary", "purpose", "writingTip" FROM "StoryScene" WHERE "id" = ?`,
            args: [sceneId],
        });
        const scene = sceneResult.rows[0];
        if (!scene) {
            continue;
        }

        await client.execute({
            sql: `
                UPDATE "StoryScene"
                SET "summary" = ?, "purpose" = ?, "writingTip" = ?, "updatedAt" = CURRENT_TIMESTAMP
                WHERE "id" = ?
            `,
            args: [
                appendSection(String(scene.summary ?? ""), "原 Plot 摘要", rows.map(formatPlotSummary)),
                appendSection(nullableText(scene.purpose), "原 Plot 效果", rows.map(formatPlotEffect)),
                appendSection(nullableText(scene.writingTip), "原 Plot 写作提示", rows.map(formatPlotWritingTip)),
                sceneId,
            ],
        });
    }
}

/** SQLite 不能稳定跨版本 DROP COLUMN，这里重建 StorySceneRef 来删除 targetPlotId。 */
async function rebuildStorySceneRefWithoutPlotTarget(client: Client): Promise<void> {
    const columns = await tableColumns(client, "StorySceneRef");
    if (!columns.has("targetPlotId")) {
        return;
    }

    await client.execute(`DROP INDEX IF EXISTS "StorySceneRef_sceneId_sortOrder_idx"`);
    await client.execute(`DROP INDEX IF EXISTS "StorySceneRef_targetThreadId_idx"`);
    await client.execute(`DROP INDEX IF EXISTS "StorySceneRef_targetSceneId_idx"`);
    await client.execute(`DROP INDEX IF EXISTS "StorySceneRef_targetPlotId_idx"`);
    await client.execute(`
        CREATE TABLE "StorySceneRef_next" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "sceneId" INTEGER NOT NULL,
            "sortOrder" INTEGER NOT NULL,
            "relation" TEXT NOT NULL,
            "rawTarget" TEXT NOT NULL,
            "targetKind" TEXT NOT NULL,
            "targetThreadId" INTEGER,
            "targetSceneId" INTEGER,
            "visibility" TEXT NOT NULL DEFAULT 'author',
            "note" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "StorySceneRef_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "StorySceneRef_targetThreadId_fkey" FOREIGN KEY ("targetThreadId") REFERENCES "StoryThread" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
            CONSTRAINT "StorySceneRef_targetSceneId_fkey" FOREIGN KEY ("targetSceneId") REFERENCES "StoryScene" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        )
    `);
    await client.execute(`
        INSERT INTO "StorySceneRef_next" (
            "id", "sceneId", "sortOrder", "relation", "rawTarget", "targetKind",
            "targetThreadId", "targetSceneId", "visibility", "note", "createdAt", "updatedAt"
        )
        SELECT
            "id", "sceneId", "sortOrder", "relation", "rawTarget", "targetKind",
            "targetThreadId", "targetSceneId", "visibility", "note", "createdAt", "updatedAt"
        FROM "StorySceneRef"
        WHERE "targetKind" != 'plot' AND "rawTarget" NOT LIKE 'plot://%'
    `);
    await client.execute(`DROP TABLE "StorySceneRef"`);
    await client.execute(`ALTER TABLE "StorySceneRef_next" RENAME TO "StorySceneRef"`);
    await client.execute(`CREATE INDEX IF NOT EXISTS "StorySceneRef_sceneId_sortOrder_idx" ON "StorySceneRef"("sceneId", "sortOrder")`);
    await client.execute(`CREATE INDEX IF NOT EXISTS "StorySceneRef_targetThreadId_idx" ON "StorySceneRef"("targetThreadId")`);
    await client.execute(`CREATE INDEX IF NOT EXISTS "StorySceneRef_targetSceneId_idx" ON "StorySceneRef"("targetSceneId")`);
}

async function sqliteTableExists(client: Client, tableName: string): Promise<boolean> {
    const result = await client.execute({
        sql: `SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1`,
        args: [tableName],
    });
    return result.rows.length > 0;
}

async function tableColumns(client: Client, tableName: string): Promise<Set<string>> {
    const result = await client.execute(`PRAGMA table_info("${tableName}")`);
    return new Set(result.rows.map((row) => String(row.name ?? "")));
}

function nullableText(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function appendSection(base: string, title: string, lines: string[]): string {
    const content = lines.map((line) => line.trim()).filter(Boolean).join("\n");
    if (!content) {
        return base;
    }
    return [base.trim(), `\n\n## ${title}\n${content}`.trim()].filter(Boolean).join("\n\n");
}

function formatPlotSummary(row: Record<string, unknown>): string {
    return `- #${String(row.sortOrder ?? "")} ${String(row.kind ?? "plot")}：${String(row.summary ?? "").trim()}`;
}

function formatPlotEffect(row: Record<string, unknown>): string {
    const effect = nullableText(row.effect).trim();
    return effect ? `- #${String(row.sortOrder ?? "")}：${effect}` : "";
}

function formatPlotWritingTip(row: Record<string, unknown>): string {
    const writingTip = nullableText(row.writingTip).trim();
    return writingTip ? `- #${String(row.sortOrder ?? "")}：${writingTip}` : "";
}

const PROJECT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS "ProjectMetadata" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "DatabaseLock" (
    "key" INTEGER NOT NULL PRIMARY KEY,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Story" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "StoryPhase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPhase_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryThread" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "storyPhaseId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isMainThread" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryThread_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryThread_storyPhaseId_fkey" FOREIGN KEY ("storyPhaseId") REFERENCES "StoryPhase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryScene" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "chapterPath" TEXT,
    "threadSortOrder" INTEGER NOT NULL,
    "chapterSortOrder" INTEGER,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "startInstant" BIGINT,
    "endInstant" BIGINT,
    "subjectIdsJson" TEXT NOT NULL DEFAULT '[]',
    "locationSubjectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryScene_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryScene_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StoryThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StorySceneRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "rawTarget" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetThreadId" INTEGER,
    "targetSceneId" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'author',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorySceneRef_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetThreadId_fkey" FOREIGN KEY ("targetThreadId") REFERENCES "StoryThread" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetSceneId_fkey" FOREIGN KEY ("targetSceneId") REFERENCES "StoryScene" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "StoryPhase_storyId_name_key" ON "StoryPhase"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryPhase_storyId_sortOrder_idx" ON "StoryPhase"("storyId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryThread_storyId_name_key" ON "StoryThread"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryThread_storyId_storyPhaseId_sortOrder_idx" ON "StoryThread"("storyId", "storyPhaseId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StoryThread_storyId_isMainThread_status_idx" ON "StoryThread"("storyId", "isMainThread", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_key" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_idx" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_chapterPath_chapterSortOrder_idx" ON "StoryScene"("chapterPath", "chapterSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_storyId_status_idx" ON "StoryScene"("storyId", "status");
CREATE INDEX IF NOT EXISTS "StorySceneRef_sceneId_sortOrder_idx" ON "StorySceneRef"("sceneId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetThreadId_idx" ON "StorySceneRef"("targetThreadId");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetSceneId_idx" ON "StorySceneRef"("targetSceneId");
INSERT INTO "ProjectMetadata" ("key", "value", "updatedAt")
VALUES ('schemaVersion', '1', CURRENT_TIMESTAMP)
ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = CURRENT_TIMESTAMP;
`;

await main();
