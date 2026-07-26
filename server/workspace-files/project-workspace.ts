import fs from "node:fs/promises";
import path from "node:path";
import {createClient, type Client} from "@libsql/client";
import {createError} from "h3";
import * as yaml from "yaml";
import {absoluteFsPath, assertRealPathContained, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    normalizeProjectPath,
    resolveProjectWorkspaceRoot,
    type ProjectPath,
} from "nbook/server/workspace-files/project-path";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

export const PROJECT_MANIFEST_FILE = "project.yaml";
export const PROJECT_DATABASE_RELATIVE_PATH = ".nbook/project.sqlite";
/** RP 模式独立世界线数据库（World Engine worldKey="rp"）。与 project.sqlite 同 DDL，互不可见。 */
export const PROJECT_RP_WORLD_DATABASE_RELATIVE_PATH = ".nbook/world-rp.sqlite";
export const PROJECT_CONFIG_RELATIVE_PATH = ".nbook/config.json";
export const PROJECT_DELETED_MARKER_RELATIVE_PATH = ".nbook/deleted-project.json";
const STORY_PLOT_BACKUP_RELATIVE_PATH = ".nbook/story-plot-backup.json";

export type ProjectManifest = {
    kind: "novel";
    title: string;
    summary: string;
};

export type ProjectListItem = ProjectManifest & {
    projectPath: string;
    updatedAt: string;
    manifestError?: string;
};

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
CREATE TABLE IF NOT EXISTS "StoryAct" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryAct_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryChapter" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "actId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "briefGoal" TEXT,
    "briefPov" TEXT,
    "briefTone" TEXT,
    "briefPacing" TEXT,
    "briefReaderKnows" TEXT,
    "briefProtagonistKnows" TEXT,
    "briefMustHide" TEXT,
    "briefHintOnly" TEXT,
    "briefOpening" TEXT,
    "briefEnding" TEXT,
    "briefDoNotWrite" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryChapter_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryChapter_actId_fkey" FOREIGN KEY ("actId") REFERENCES "StoryAct" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "miceType" TEXT,
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
    "chapterId" INTEGER,
    "threadSortOrder" INTEGER NOT NULL,
    "chapterSortOrder" INTEGER,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "outcomeType" TEXT,
    "pacingRole" TEXT,
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
    CONSTRAINT "StoryScene_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StoryThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryScene_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "StoryChapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
CREATE TABLE IF NOT EXISTS "StoryPromise" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "importance" TEXT NOT NULL DEFAULT 'medium',
    "summary" TEXT NOT NULL DEFAULT '',
    "payoffExpectation" TEXT,
    "cadenceChapters" INTEGER,
    "deadlineChapterId" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPromise_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryPromise_deadlineChapterId_fkey" FOREIGN KEY ("deadlineChapterId") REFERENCES "StoryChapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryPromiseBeat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "promiseId" INTEGER NOT NULL,
    "sceneId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPromiseBeat_promiseId_fkey" FOREIGN KEY ("promiseId") REFERENCES "StoryPromise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryPromiseBeat_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryDecision" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "question" TEXT NOT NULL,
    "options" TEXT NOT NULL DEFAULT '[]',
    "deadlineChapterId" INTEGER,
    "decision" TEXT,
    "motivation" TEXT,
    "rejectedAlternatives" TEXT NOT NULL DEFAULT '[]',
    "risk" TEXT,
    "serves" TEXT NOT NULL DEFAULT '[]',
    "dependsOn" TEXT NOT NULL DEFAULT '[]',
    "supersededById" INTEGER,
    "anchorKind" TEXT NOT NULL DEFAULT 'story',
    "anchorActId" INTEGER,
    "anchorChapterId" INTEGER,
    "anchorThreadId" INTEGER,
    "anchorSceneId" INTEGER,
    "anchorPromiseId" INTEGER,
    "anchorPath" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryDecision_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryDecision_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "StoryDecision" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryDecision_anchorActId_fkey" FOREIGN KEY ("anchorActId") REFERENCES "StoryAct" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryDecision_anchorChapterId_fkey" FOREIGN KEY ("anchorChapterId") REFERENCES "StoryChapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryDecision_anchorThreadId_fkey" FOREIGN KEY ("anchorThreadId") REFERENCES "StoryThread" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryDecision_anchorSceneId_fkey" FOREIGN KEY ("anchorSceneId") REFERENCES "StoryScene" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoryDecision_anchorPromiseId_fkey" FOREIGN KEY ("anchorPromiseId") REFERENCES "StoryPromise" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "WorldSubject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "WorldSlice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instant" BIGINT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'event',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "WorldPatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sliceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "instant" BIGINT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "value" TEXT,
    "summary" TEXT,
    "text" TEXT,
    "vector" BLOB,
    "model" TEXT,
    CONSTRAINT "WorldPatch_sliceId_fkey" FOREIGN KEY ("sliceId") REFERENCES "WorldSlice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorldPatch_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "WorldSubject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
DROP TABLE IF EXISTS "WorldMutation";
CREATE UNIQUE INDEX IF NOT EXISTS "StoryPhase_storyId_name_key" ON "StoryPhase"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryPhase_storyId_sortOrder_idx" ON "StoryPhase"("storyId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryAct_storyId_name_key" ON "StoryAct"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryAct_storyId_sortOrder_idx" ON "StoryAct"("storyId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryChapter_storyId_name_key" ON "StoryChapter"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryChapter_storyId_actId_sortOrder_idx" ON "StoryChapter"("storyId", "actId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryThread_storyId_name_key" ON "StoryThread"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryThread_storyId_storyPhaseId_sortOrder_idx" ON "StoryThread"("storyId", "storyPhaseId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StoryThread_storyId_isMainThread_status_idx" ON "StoryThread"("storyId", "isMainThread", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_key" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_idx" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_storyId_status_idx" ON "StoryScene"("storyId", "status");
CREATE INDEX IF NOT EXISTS "StorySceneRef_sceneId_sortOrder_idx" ON "StorySceneRef"("sceneId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetThreadId_idx" ON "StorySceneRef"("targetThreadId");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetSceneId_idx" ON "StorySceneRef"("targetSceneId");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryPromise_storyId_name_key" ON "StoryPromise"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryPromise_storyId_status_idx" ON "StoryPromise"("storyId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryPromiseBeat_promiseId_sceneId_key" ON "StoryPromiseBeat"("promiseId", "sceneId");
CREATE INDEX IF NOT EXISTS "StoryPromiseBeat_sceneId_idx" ON "StoryPromiseBeat"("sceneId");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryDecision_storyId_name_key" ON "StoryDecision"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryDecision_storyId_status_idx" ON "StoryDecision"("storyId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "WorldSlice_instant_key" ON "WorldSlice"("instant");
CREATE INDEX IF NOT EXISTS "WorldSlice_instant_idx" ON "WorldSlice"("instant");
CREATE INDEX IF NOT EXISTS "WorldSubject_type_idx" ON "WorldSubject"("type");
CREATE INDEX IF NOT EXISTS "WorldPatch_subjectId_instant_seq_idx" ON "WorldPatch"("subjectId", "instant", "seq");
CREATE INDEX IF NOT EXISTS "WorldPatch_subjectId_path_instant_idx" ON "WorldPatch"("subjectId", "path", "instant");
CREATE INDEX IF NOT EXISTS "WorldPatch_path_idx" ON "WorldPatch"("path");
INSERT INTO "ProjectMetadata" ("key", "value", "updatedAt")
VALUES ('schemaVersion', '1', CURRENT_TIMESTAMP)
ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = CURRENT_TIMESTAMP;
`;

/**
 * 判断 Project Path 是否指向现有 Project Workspace 目录。不读取 project.yaml，用于文件修复链路。
 */
export async function assertProjectWorkspaceDirectory(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
): Promise<ProjectPath> {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizedProjectPath);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
        stat = await fs.lstat(projectRoot);
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            throw createError({statusCode: 404, message: "Project Workspace 不存在"});
        }
        throw error;
    }
    if (stat.isSymbolicLink()) {
        throw createError({statusCode: 400, message: "managed Project Workspace根不能是symlink或junction；请改用外部绝对Project Workspace"});
    }
    if (!stat.isDirectory()) {
        throw createError({statusCode: 400, message: "projectPath 必须指向 Project Workspace 目录"});
    }
    await assertRealPathContained(workspaceRoot, projectRoot);
    if (await isProjectRootDeleted(projectRoot)) {
        throw createError({statusCode: 404, message: "Project Workspace 已删除"});
    }
    return normalizedProjectPath;
}

/**
 * 判断 Project Workspace 目录是否存在。包含已标记删除但尚未物理清理的目录。
 */
export async function projectWorkspaceDirectoryExists(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
): Promise<boolean> {
    try {
        const stat = await fs.stat(resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath)));
        return stat.isDirectory();
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

/**
 * 返回 Project SQLite 的绝对路径。
 */
export function resolveProjectDatabasePath(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
): AbsoluteFsPath {
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath));
    return absoluteFsPath(path.join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH));
}

/**
 * 解析 RP 模式独立世界线数据库路径（worldKey="rp"）。
 */
export function resolveProjectRpWorldDatabasePath(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
): AbsoluteFsPath {
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath));
    return absoluteFsPath(path.join(projectRoot, PROJECT_RP_WORLD_DATABASE_RELATIVE_PATH));
}

/**
 * 惰性初始化 RP 世界线数据库：文件缺失时按项目 DDL 建表（幂等）。
 * 复用 PROJECT_MIGRATION_SQL 保证 World* 表与主库同构；多余的空 Plot 表无害。
 */
export async function ensureRpWorldDatabase(databasePath: string): Promise<void> {
    try {
        await fs.access(databasePath);
        return;
    } catch {
        // 文件不存在，走初始化。
    }
    await fs.mkdir(path.dirname(databasePath), {recursive: true});
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        await client.execute("PRAGMA foreign_keys = ON");
        for (const statement of splitSqlStatements(PROJECT_MIGRATION_SQL)) {
            await client.execute(statement);
        }
    } finally {
        await client.close();
        collectReleasedSqliteHandles();
    }
}

/**
 * 读取 Project manifest。
 */
export async function readProjectManifest(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
): Promise<ProjectManifest> {
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath));
    const manifestPath = path.join(projectRoot, PROJECT_MANIFEST_FILE);
    const parsed = yaml.parse(await fs.readFile(manifestPath, "utf-8")) as Partial<ProjectManifest> | null;
    if (!parsed || parsed.kind !== "novel" || typeof parsed.title !== "string") {
        throw createError({statusCode: 400, message: `${projectPath}/${PROJECT_MANIFEST_FILE} 不是有效 Project manifest`});
    }
    return {
        kind: "novel",
        title: parsed.title,
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
}

/**
 * 安全读取 Project manifest。解析失败时返回错误文本，避免拖垮文件树和保存链路。
 */
export async function readProjectManifestIssue(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
): Promise<string | null> {
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath));
    return readProjectManifestIssueFromRoot(projectRoot);
}

/**
 * 从 Project Workspace 根目录安全读取 manifest issue。root 已经由调用方完成定位。
 */
export async function readProjectManifestIssueFromRoot(projectRoot: string): Promise<string | null> {
    try {
        const manifestPath = path.join(projectRoot, PROJECT_MANIFEST_FILE);
        const parsed = yaml.parse(await fs.readFile(manifestPath, "utf-8")) as Partial<ProjectManifest> | null;
        if (!parsed || parsed.kind !== "novel" || typeof parsed.title !== "string") {
            return `${PROJECT_MANIFEST_FILE} 不是有效 Project manifest`;
        }
        return null;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return "Project Workspace 缺少 project.yaml";
        }
        return error instanceof Error ? error.message : "project.yaml 解析失败";
    }
}

/**
 * 写入 Project manifest。
 */
export async function writeProjectManifest(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
    manifest: ProjectManifest,
): Promise<void> {
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath));
    await fs.mkdir(projectRoot, {recursive: true});
    await fs.writeFile(path.join(projectRoot, PROJECT_MANIFEST_FILE), yaml.stringify(manifest), "utf-8");
}

/**
 * 扫描 workspace 下一级 Project manifest。
 */
export async function listProjectWorkspaces(workspaceRoot: AbsoluteFsPath): Promise<ProjectListItem[]> {
    let entries: Array<import("node:fs").Dirent>;
    try {
        entries = await fs.readdir(workspaceRoot, {withFileTypes: true});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }

    const projects: ProjectListItem[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === ".nbook") {
            continue;
        }
        if (await isProjectRootDeleted(path.join(workspaceRoot, entry.name))) {
            continue;
        }
        const projectPath = path.posix.join("workspace", entry.name);
        try {
            const manifest = await readProjectManifest(workspaceRoot, projectPath);
            const stat = await fs.stat(path.join(workspaceRoot, entry.name, PROJECT_MANIFEST_FILE));
            projects.push({...manifest, projectPath, updatedAt: stat.mtime.toISOString()});
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                continue;
            }
            const stat = await fs.stat(path.join(workspaceRoot, entry.name));
            projects.push({
                kind: "novel",
                title: entry.name,
                summary: "",
                projectPath,
                updatedAt: stat.mtime.toISOString(),
                manifestError: error instanceof Error ? error.message : "project.yaml 解析失败",
            });
        }
    }
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * 判断 Project Root 是否已经被删除流程标记。用于隐藏物理清理尚未完成的 Project。
 */
export async function isProjectRootDeleted(projectRoot: string): Promise<boolean> {
    try {
        const stat = await fs.stat(path.join(projectRoot, PROJECT_DELETED_MARKER_RELATIVE_PATH));
        return stat.isFile();
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

/**
 * 初始化或迁移 Project SQLite。
 */
export async function initProjectDatabase(
    workspaceRoot: AbsoluteFsPath,
    projectPath: string,
): Promise<string> {
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(projectPath));
    return initProjectDatabaseAtRoot(projectRoot);
}

/**
 * 按 Project Workspace 绝对根目录初始化或迁移 Project SQLite。
 */
export async function initProjectDatabaseAtRoot(projectRoot: string): Promise<string> {
    const databasePath = path.join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH);
    await fs.mkdir(path.dirname(databasePath), {recursive: true});
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        await client.execute("PRAGMA foreign_keys = ON");
        for (const statement of splitSqlStatements(PROJECT_MIGRATION_SQL)) {
            await client.execute(statement);
        }
        await migratePlotSceneBridgeSchema(client, projectRoot);
        await migrateStorySceneChapterEntity(client);
        await ensureWorldSliceSummaryColumn(client);
        await ensurePlanningLayerColumns(client);
    } finally {
        await client.close();
        collectReleasedSqliteHandles();
    }
    return databasePath;
}

/**
 * SQLite file URL。
 */
export function toSqliteFileUrl(filePath: string): string {
    return `file:${path.resolve(filePath).replaceAll("\\", "/")}`;
}

function splitSqlStatements(sql: string): string[] {
    return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

/** 旧 Project SQLite 可能早于 slice-level summary，初始化时做幂等补列。 */
async function ensureWorldSliceSummaryColumn(client: Client): Promise<void> {
    const result = await client.execute(`PRAGMA table_info("WorldSlice")`);
    const hasSummary = result.rows.some((row) => String(row.name ?? "") === "summary");
    if (!hasSummary) {
        await client.execute(`ALTER TABLE "WorldSlice" ADD COLUMN "summary" TEXT NOT NULL DEFAULT ''`);
    }
}

/**
 * 规划层(Task 93)字段幂等补列:StoryThread.miceType、StoryScene.outcomeType/pacingRole。
 * 新库由 PROJECT_MIGRATION_SQL 的 CREATE TABLE 直接带上;老库靠这里补齐。
 * 必须在 migrateStorySceneChapterEntity 之后执行,避免补的列被旧库 StoryScene 重建丢掉。
 */
async function ensurePlanningLayerColumns(client: Client): Promise<void> {
    const threadColumns = await tableColumns(client, "StoryThread");
    if (!threadColumns.has("miceType")) {
        await client.execute(`ALTER TABLE "StoryThread" ADD COLUMN "miceType" TEXT`);
    }
    const sceneColumns = await tableColumns(client, "StoryScene");
    if (!sceneColumns.has("outcomeType")) {
        await client.execute(`ALTER TABLE "StoryScene" ADD COLUMN "outcomeType" TEXT`);
    }
    if (!sceneColumns.has("pacingRole")) {
        await client.execute(`ALTER TABLE "StoryScene" ADD COLUMN "pacingRole" TEXT`);
    }
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

/**
 * 从旧 chapterPath / manuscript 目录路径推导 Chapter 的 story 内唯一 name 与 title,
 * 例如 manuscript/002-volume/001-chapter/ → name=002-volume-001-chapter。
 * DB 迁移与 carrier-tree bootstrap 共用本推导,保证两侧建出的 name 一致。
 */
export function chapterIdentityFromPath(chapterPath: string): {name: string; title: string} {
    const normalized = chapterPath.replace(/^manuscript\//, "").replace(/\/+$/, "");
    const name = normalized.replaceAll("/", "-") || "chapter";
    const segments = normalized.split("/");
    return {name, title: segments[segments.length - 1] || name};
}

/**
 * 将 Scene 的旧 chapterPath 字符串桥接迁移为 StoryChapter 实体外键。
 * 老库:为每个 (storyId, chapterPath) 自动补一行 StoryChapter(actId 留空,由 bootstrap/leader 后续分卷),
 * 再重建 StoryScene 表以 chapterId 替换 chapterPath 并回填映射。新库直接跳到索引兜底。
 */
async function migrateStorySceneChapterEntity(client: Client): Promise<void> {
    const columns = await tableColumns(client, "StoryScene");
    if (columns.has("chapterPath")) {
        await client.execute("PRAGMA foreign_keys = OFF");
        try {
            // 1. 为每个 (storyId, chapterPath) 确保一行 StoryChapter,sortOrder 按 path 升序追加。
            const pairs = await client.execute(`
                SELECT DISTINCT "storyId", "chapterPath"
                FROM "StoryScene"
                WHERE "chapterPath" IS NOT NULL AND "chapterPath" != ''
                ORDER BY "storyId" ASC, "chapterPath" ASC
            `);
            for (const row of pairs.rows) {
                const storyId = Number(row.storyId);
                const identity = chapterIdentityFromPath(String(row.chapterPath));
                await client.execute({
                    sql: `
                        INSERT INTO "StoryChapter" ("storyId", "actId", "sortOrder", "name", "title")
                        SELECT ?, NULL, COALESCE((SELECT MAX("sortOrder") FROM "StoryChapter" WHERE "storyId" = ?), 0) + 1, ?, ?
                        WHERE NOT EXISTS (SELECT 1 FROM "StoryChapter" WHERE "storyId" = ? AND "name" = ?)
                    `,
                    args: [storyId, storyId, identity.name, identity.title, storyId, identity.name],
                });
            }

            // 2. 收集 scene → chapter 映射(name 推导在 JS 侧,避免 SQL 重复实现)。
            const sceneRows = await client.execute(`
                SELECT "id", "storyId", "chapterPath" FROM "StoryScene"
                WHERE "chapterPath" IS NOT NULL AND "chapterPath" != ''
            `);
            const sceneChapterIds: Array<{sceneId: number; chapterId: number}> = [];
            for (const row of sceneRows.rows) {
                const identity = chapterIdentityFromPath(String(row.chapterPath));
                const chapterRow = await client.execute({
                    sql: `SELECT "id" FROM "StoryChapter" WHERE "storyId" = ? AND "name" = ?`,
                    args: [Number(row.storyId), identity.name],
                });
                const chapterId = chapterRow.rows[0]?.id;
                if (chapterId !== undefined && chapterId !== null) {
                    sceneChapterIds.push({sceneId: Number(row.id), chapterId: Number(chapterId)});
                }
            }

            // 3. 重建 StoryScene:chapterId 替换 chapterPath。
            await client.execute(`DROP INDEX IF EXISTS "StoryScene_threadId_threadSortOrder_key"`);
            await client.execute(`DROP INDEX IF EXISTS "StoryScene_threadId_threadSortOrder_idx"`);
            await client.execute(`DROP INDEX IF EXISTS "StoryScene_chapterPath_chapterSortOrder_idx"`);
            await client.execute(`DROP INDEX IF EXISTS "StoryScene_storyId_status_idx"`);
            await client.execute(`DROP INDEX IF EXISTS "StoryScene_startInstant_idx"`);
            await client.execute(`
                CREATE TABLE "StoryScene_next" (
                    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    "storyId" INTEGER NOT NULL,
                    "threadId" INTEGER NOT NULL,
                    "chapterId" INTEGER,
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
                    CONSTRAINT "StoryScene_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StoryThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
                    CONSTRAINT "StoryScene_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "StoryChapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
                )
            `);
            await client.execute(`
                INSERT INTO "StoryScene_next" (
                    "id", "storyId", "threadId", "chapterId", "threadSortOrder", "chapterSortOrder",
                    "title", "status", "summary", "purpose", "writingTip", "note",
                    "startInstant", "endInstant", "subjectIdsJson", "locationSubjectId", "createdAt", "updatedAt"
                )
                SELECT
                    "id", "storyId", "threadId", NULL, "threadSortOrder", "chapterSortOrder",
                    "title", "status", "summary", "purpose", "writingTip", "note",
                    "startInstant", "endInstant", "subjectIdsJson", "locationSubjectId", "createdAt", "updatedAt"
                FROM "StoryScene"
            `);
            await client.execute(`DROP TABLE "StoryScene"`);
            await client.execute(`ALTER TABLE "StoryScene_next" RENAME TO "StoryScene"`);
            for (const {sceneId, chapterId} of sceneChapterIds) {
                await client.execute({
                    sql: `UPDATE "StoryScene" SET "chapterId" = ? WHERE "id" = ?`,
                    args: [chapterId, sceneId],
                });
            }
            await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_key" ON "StoryScene"("threadId", "threadSortOrder")`);
            await client.execute(`CREATE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_idx" ON "StoryScene"("threadId", "threadSortOrder")`);
            await client.execute(`CREATE INDEX IF NOT EXISTS "StoryScene_storyId_status_idx" ON "StoryScene"("storyId", "status")`);
            await client.execute(`CREATE INDEX IF NOT EXISTS "StoryScene_startInstant_idx" ON "StoryScene"("startInstant")`);
        } finally {
            await client.execute("PRAGMA foreign_keys = ON");
        }
    }
    // chapterId 索引对新老库统一兜底;不能放 PROJECT_MIGRATION_SQL,老库在迁移前没有该列。
    await client.execute(`CREATE INDEX IF NOT EXISTS "StoryScene_chapterId_chapterSortOrder_idx" ON "StoryScene"("chapterId", "chapterSortOrder")`);
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
