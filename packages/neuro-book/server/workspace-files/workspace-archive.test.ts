import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {setTimeout} from "node:timers/promises";
import {promisify} from "node:util";
import {pathToFileURL} from "node:url";
import {createClient} from "@libsql/client";
import {unzipSync} from "fflate";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {WorkspaceHistory} from "@notnotype/nb-history";
import {
    createProjectWorkspaceZipStream,
    createWorkspaceZipStream,
} from "nbook/server/workspace-files/workspace-archive";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
    type ResolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";

const execFileAsync = promisify(execFile);

describe("workspace-archive", () => {
    let root: string;

    beforeEach(async () => {
        root = testHostPath("workspace-archive-test", randomUUID());
        await fs.mkdir(root, {recursive: true});
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        collectReleasedSqliteHandles({force: true});
        await removeTestRoot(root);
    });

    it("打包 workspace 文件并遵守忽略规则", async () => {
        await writeFile("workspace.yaml", "name: test\n");
        await writeFile("manuscript/001/index.md", "# 第一章\n");
        await writeFile("assets/image.bin", Buffer.from([0, 1, 2, 3]));
        await writeFile("ignored.tmp", "skip\n");
        await writeFile(".git/config", "skip\n");
        await writeFile(".nbook/config.json", "{}\n");
        await writeFile(".nbook/runtime-artifact-import-cache/world-engine-calendar/a.mjs", "export {};\n");
        await writeFile("world-engine/.runtime-artifact-import-cache/world-engine-schema/a.mjs", "export {};\n");
        await writeFile(".gitignore", "*.tmp\n");

        const archive = await createWorkspaceZipStream({kind: "workspace-root", root: absoluteFsPath(root)});
        const buffer = await readStreamBuffer(archive.stream);
        const entries = readZipEntryNames(buffer);

        expect(archive.filename).toBe(`${path.basename(root)}.zip`);
        expect(entries).toEqual(expect.arrayContaining([
            ".gitignore",
            ".nbook/config.json",
            "assets/image.bin",
            "manuscript/001/index.md",
            "workspace.yaml",
        ]));
        expect(entries).not.toContain("ignored.tmp");
        expect(entries.some((entry) => entry.startsWith(".git/"))).toBe(false);
        expect(entries.some((entry) => entry.includes("runtime-artifact-import-cache"))).toBe(false);
    });

    it("user-assets 下载排除 Storage 根，但保留同名普通目录", async () => {
        const userAssetsRoot = path.join(root, ".nbook");
        await writeFile(".nbook/config.json", "{}");
        await writeFile(".nbook/notes/storage/note.md", "普通目录");
        await writeFile(".nbook/storage/records/shelf.json", JSON.stringify({revision: "original"}));
        await writeFile(".nbook/storage/identity.json", "{}");
        await writeFile(".nbook/storage/.locks/partition.lock/owner.json", "lock");

        const archive = await createWorkspaceZipStream({kind: "user-assets", root: absoluteFsPath(userAssetsRoot)});
        const files = unzipSync(await readStreamBuffer(archive.stream));
        const entries = Object.keys(files);

        expect(entries).toEqual(expect.arrayContaining(["config.json", "notes/storage/note.md"]));
        expect(entries.some((entry) => entry === "storage" || entry.startsWith("storage/"))).toBe(false);
        expect(Buffer.from(files["notes/storage/note.md"]!).toString()).toBe("普通目录");
        await expect(fs.readFile(path.join(userAssetsRoot, "storage", "records", "shelf.json"), "utf-8"))
            .resolves.toBe(JSON.stringify({revision: "original"}));
    });

    it("Project 下载在线快照两个 SQLite，并强制纳入 metadata 且排除 live sidecar", async () => {
        await writeFile("project.yaml", "kind: novel\ntitle: test\nsummary: ''\n");
        await writeFile(".nbook/config.json", "{}\n");
        await writeFile("ignored.tmp", "skip\n");
        await writeFile(".nbook/private.txt", "ignored by directory rule\n");
        await writeFile(".nbook/recovery/project-manifest-original.yaml", "broken manifest bytes\n");
        await writeFile(".nbook/storage/records/value.json", '{"state":"value","value":{"width":320}}\n');
        await writeFile(".nbook/storage/records/deleted.json", '{"state":"deleted"}\n');
        await writeFile(".nbook/storage/quarantine/broken.corrupt", Buffer.from([0, 255, 13, 10]));
        await writeFile(".nbook/storage/.locks/partition.lock/owner.json", "lock");
        await writeFile(`.nbook/storage/records/value.json.${randomUUID()}.tmp`, "incomplete");
        await writeFile(".nbook/runtime-artifact-import-cache/world-engine-calendar/a.mjs", "export {};\n");
        await writeFile("world-engine/.runtime-artifact-import-cache/world-engine-schema/a.mjs", "export {};\n");
        await writeFile("world-engine/calendar.ts", "export default {};\n");
        await writeFile(".gitignore", [
            "project.yaml",
            ".nbook/",
            "ignored.tmp",
            "!.nbook/runtime-artifact-import-cache/**",
            "!world-engine/.runtime-artifact-import-cache/**",
            "",
        ].join("\n"));

        const projectDatabasePath = path.join(root, ".nbook", "project.sqlite");
        const projectClient = createClient({url: toSqliteFileUrl(projectDatabasePath)});
        await projectClient.execute("PRAGMA journal_mode = WAL");
        await projectClient.execute("CREATE TABLE archive_probe (value TEXT NOT NULL)");
        await projectClient.execute({sql: "INSERT INTO archive_probe (value) VALUES (?)", args: ["live-wal"]});

        const historyDatabasePath = path.join(root, ".nbook", "history.sqlite");
        const history = await WorkspaceHistory.open({
            databasePath: historyDatabasePath,
            resolvePath: (relativePath) => path.join(root, ...relativePath.split("/")),
        });
        const acceptedEntry = await history.performWrite(
            {kind: "agent", sessionId: "writer"},
            "manuscript/001.md",
            "第一版正文",
        );
        await history.accept("local", "manuscript/001.md");
        await history.initCursor("reader-session");
        await history.performWrite(
            {kind: "external"},
            "manuscript/001.md",
            "第二版正文",
        );
        const originalMkdtemp = fs.mkdtemp.bind(fs);
        let stagingRoot: string | null = null;
        vi.spyOn(fs, "mkdtemp").mockImplementation(async (prefix, options) => {
            stagingRoot = await originalMkdtemp(prefix, options);
            return stagingRoot;
        });

        try {
            const archive = await createProjectWorkspaceZipStream(projectWorkspace(root));
            const buffer = await readStreamBuffer(archive.stream);
            const files = unzipSync(buffer);
            const entries = Object.keys(files).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

            expect(entries).toEqual(expect.arrayContaining([
                ".gitignore",
                ".nbook/config.json",
                ".nbook/history.sqlite",
                ".nbook/project.sqlite",
                ".nbook/recovery/project-manifest-original.yaml",
                ".nbook/storage/records/value.json",
                ".nbook/storage/records/deleted.json",
                ".nbook/storage/quarantine/broken.corrupt",
                "project.yaml",
                "world-engine/calendar.ts",
            ]));
            expect(entries).not.toContain("ignored.tmp");
            expect(entries).not.toContain(".nbook/private.txt");
            expect(entries.some((entry) => entry.endsWith(".sqlite-wal") || entry.endsWith(".sqlite-shm"))).toBe(false);
            expect(entries.some((entry) => entry.includes("runtime-artifact-import-cache"))).toBe(false);
            expect(entries.some((entry) => entry.includes("/.locks/") || entry.endsWith(".tmp"))).toBe(false);
            expect(Buffer.from(files[".nbook/storage/quarantine/broken.corrupt"]!)).toEqual(Buffer.from([0, 255, 13, 10]));
            expect(JSON.parse(Buffer.from(files[".nbook/storage/records/deleted.json"]!).toString())).toEqual({state: "deleted"});

            const extractedRoot = path.join(root, "extracted");
            const extractedProjectPath = await writeExtractedDatabase(files, PROJECT_DATABASE_ENTRY, extractedRoot);
            const extractedHistoryPath = await writeExtractedDatabase(files, HISTORY_DATABASE_ENTRY, extractedRoot);
            const extractedProject = createClient({url: toSqliteFileUrl(extractedProjectPath)});
            const extractedHistory = createClient({url: toSqliteFileUrl(extractedHistoryPath)});
            try {
                const projectRows = await extractedProject.execute("SELECT value FROM archive_probe");
                expect(projectRows.rows.map((row) => String(row["value"]))).toEqual(["live-wal"]);

                const operationRows = await extractedHistory.execute("SELECT id, path FROM operation_log ORDER BY id");
                const acceptanceRows = await extractedHistory.execute("SELECT user_id, path, accepted_entry_id FROM file_acceptance");
                const cursorRows = await extractedHistory.execute("SELECT session_id, last_seen_entry_id FROM session_cursor");
                const snapshotRows = await extractedHistory.execute("SELECT body FROM file_snapshot WHERE body IS NOT NULL");
                expect(operationRows.rows).toHaveLength(2);
                expect(acceptanceRows.rows).toEqual(expect.arrayContaining([
                    expect.objectContaining({
                        user_id: "local",
                        path: "manuscript/001.md",
                        accepted_entry_id: acceptedEntry.id,
                    }),
                ]));
                expect(cursorRows.rows).toEqual(expect.arrayContaining([
                    expect.objectContaining({session_id: "reader-session", last_seen_entry_id: acceptedEntry.id}),
                ]));
                expect(snapshotRows.rows).toHaveLength(2);
            } finally {
                await extractedProject.close();
                await extractedHistory.close();
            }
            expect(stagingRoot).not.toBeNull();
            await waitForMissing(stagingRoot!);
        } finally {
            await projectClient.close();
            await history.close();
        }
    });

    it("Project SQLite 损坏时拒绝成功归档并清理 staging", async () => {
        await writeFile("project.yaml", "kind: novel\ntitle: broken\nsummary: ''\n");
        const childTempRoot = path.join(root, "child-temp");
        await fs.mkdir(childTempRoot, {recursive: true});
        const childScriptPath = path.join(root, "corrupt-archive-child.ts");
        await fs.writeFile(childScriptPath, corruptArchiveChildScript(), "utf-8");

        const result = await execFileAsync("bun", [childScriptPath, path.resolve(root)], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                TEMP: path.resolve(childTempRoot),
                TMP: path.resolve(childTempRoot),
            },
        });

        expect(result.stdout).toContain("EXPECTED_PROJECT_ARCHIVE_FAILURE");
        const remainingStaging = (await fs.readdir(childTempRoot))
            .filter((name) => name.startsWith("nbook-project-archive-"));
        expect(remainingStaging).toEqual([]);
    });

    it("Storage 在归档准备后替换为不同大小的新值，ZIP 仍包含完整的单记录快照", async () => {
        await writeFile("project.yaml", "kind: novel\ntitle: storage\nsummary: ''\n");
        const entry = ".nbook/storage/records/layout.json";
        const original = JSON.stringify({revision: "before", value: {width: 310}});
        const replacement = JSON.stringify({revision: "after", value: {width: 470, note: "new".repeat(10000)}});
        await writeFile(entry, original);
        const database = createClient({url: toSqliteFileUrl(path.join(root, PROJECT_DATABASE_ENTRY))});
        await database.execute("CREATE TABLE archive_probe (value TEXT)");
        await database.close();
        collectReleasedSqliteHandles({force: true});

        const archive = await createProjectWorkspaceZipStream(projectWorkspace(root));
        const source = path.join(root, entry);
        const stagedReplacement = `${source}.${randomUUID()}.tmp`;
        await fs.writeFile(stagedReplacement, replacement);
        await fs.rename(stagedReplacement, source);
        const files = unzipSync(await readStreamBuffer(archive.stream));
        expect(Buffer.from(files[entry]!).toString()).toBe(original);
        expect(await fs.readFile(source, "utf8")).toBe(replacement);
    });

    it("可选 Project Config 不可访问时失败，不伪装成缺失后继续下载", async () => {
        await writeFile("project.yaml", "kind: novel\ntitle: denied\nsummary: ''\n");
        await writeFile(".nbook/config.json", "{}\n");
        const databasePath = path.join(root, ".nbook", "project.sqlite");
        const client = createClient({url: toSqliteFileUrl(databasePath)});
        await client.execute("CREATE TABLE archive_probe (value TEXT)");
        await client.close();
        collectReleasedSqliteHandles({force: true});

        const deniedPath = path.resolve(root, ".nbook", "config.json");
        const originalStat = fs.stat.bind(fs);
        vi.spyOn(fs, "stat").mockImplementation(async (target, options) => {
            if (path.resolve(String(target)) === deniedPath) {
                const error = new Error("EACCES: simulated config access failure") as NodeJS.ErrnoException;
                error.code = "EACCES";
                throw error;
            }
            return originalStat(target, options);
        });

        await expect(createProjectWorkspaceZipStream(projectWorkspace(root)))
            .rejects.toMatchObject({code: "EACCES"});
    });

    /**
     * 写入测试文件并自动创建父目录。
     */
    async function writeFile(filePath: string, content: string | Buffer): Promise<void> {
        const absolutePath = path.join(root, filePath);
        await fs.mkdir(path.dirname(absolutePath), {recursive: true});
        await fs.writeFile(absolutePath, content);
    }
});

const PROJECT_DATABASE_ENTRY = ".nbook/project.sqlite";
const HISTORY_DATABASE_ENTRY = ".nbook/history.sqlite";

/** 为归档单测构造一个不进入DTO的ResolvedProjectWorkspace identity。 */
function projectWorkspace(projectRoot: string): ResolvedProjectWorkspace {
    const rootPath = absoluteFsPath(path.resolve(projectRoot));
    const workspaceRoot = absoluteFsPath(path.dirname(rootPath));
    const ref = projectWorkspaceRef(path.basename(rootPath));
    return resolvedProjectWorkspace(ref, rootPath, createProjectWorkspaceKey(workspaceRoot, ref));
}

/**
 * 读取 Node stream 的完整 Buffer。
 */
async function readStreamBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * 读取 zip 中央目录里的条目名称，用于验证归档路径。
 */
function readZipEntryNames(buffer: Buffer): string[] {
    const names: string[] = [];
    for (let offset = 0; offset <= buffer.length - 46; offset += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) {
            continue;
        }

        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const nameStart = offset + 46;
        const nameEnd = nameStart + nameLength;
        names.push(buffer.subarray(nameStart, nameEnd).toString("utf-8"));
        offset = nameEnd + extraLength + commentLength - 1;
    }
    return names.sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

/** 把 zip 中的数据库写到隔离目录，供独立连接验证。 */
async function writeExtractedDatabase(
    entries: Record<string, Uint8Array>,
    entryPath: string,
    extractedRoot: string,
): Promise<string> {
    const content = entries[entryPath];
    if (!content) {
        throw new Error(`压缩包缺少数据库：${entryPath}`);
    }
    const outputPath = path.join(extractedRoot, ...entryPath.split("/"));
    await fs.mkdir(path.dirname(outputPath), {recursive: true});
    await fs.writeFile(outputPath, content);
    return outputPath;
}

/** Windows 下 libsql native 句柄释放可能晚一个事件循环，测试清理做有限重试。 */
async function removeTestRoot(root: string): Promise<void> {
    let lastError: unknown = null;
    for (const delayMs of [0, 25, 100, 250, 500]) {
        if (delayMs > 0) {
            await setTimeout(delayMs);
        }
        try {
            await fs.rm(root, {recursive: true, force: true});
            return;
        } catch (error) {
            lastError = error;
            collectReleasedSqliteHandles({force: true});
        }
    }
    throw lastError;
}

/**
 * 损坏库在 libsql 进程内可能长期持有 Windows 句柄；子进程既验证真实失败链，也让退出成为明确释放边界。
 */
function corruptArchiveChildScript(): string {
    return `
import fs from "node:fs/promises";
import path from "node:path";
import {createClient} from ${JSON.stringify(import.meta.resolve("@libsql/client"))};
import {absoluteFsPath} from ${JSON.stringify(pathToFileURL(path.resolve("server/runtime/paths/file-path.ts")).href)};
import {createProjectWorkspaceZipStream} from ${JSON.stringify(pathToFileURL(path.resolve("server/workspace-files/workspace-archive.ts")).href)};
import {toSqliteFileUrl} from ${JSON.stringify(pathToFileURL(path.resolve("server/workspace-files/project-workspace.ts")).href)};
import {createProjectWorkspaceKey, projectWorkspaceRef, resolvedProjectWorkspace} from ${JSON.stringify(pathToFileURL(path.resolve("server/workspace-files/project-identity.ts")).href)};

const root = process.argv[2];
if (!root) throw new Error("missing root");
const databasePath = path.join(root, ".nbook", "project.sqlite");
await fs.mkdir(path.dirname(databasePath), {recursive: true});
const client = createClient({url: toSqliteFileUrl(databasePath)});
await client.execute("CREATE TABLE broken_probe (value TEXT)");
await client.execute("PRAGMA writable_schema = ON");
await client.execute("UPDATE sqlite_master SET sql = 'CREATE TABLE broken_probe (' WHERE name = 'broken_probe'");
await client.execute("PRAGMA writable_schema = OFF");
await client.close();

try {
    const resolvedRoot = absoluteFsPath(root);
    const workspaceRoot = absoluteFsPath(path.dirname(root));
    const ref = projectWorkspaceRef(path.basename(root));
    const workspace = resolvedProjectWorkspace(ref, resolvedRoot, createProjectWorkspaceKey(workspaceRoot, ref));
    await createProjectWorkspaceZipStream(workspace);
    throw new Error("corrupt Project SQLite unexpectedly archived");
} catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Project SQLite 在线快照失败")) {
        throw error;
    }
    process.stdout.write("EXPECTED_PROJECT_ARCHIVE_FAILURE\\n");
}
`;
}

/** 等待 archive stream 事件触发的异步 staging 清理完成。 */
async function waitForMissing(targetPath: string): Promise<void> {
    for (const delayMs of [0, 10, 25, 50, 100, 250]) {
        if (delayMs > 0) {
            await setTimeout(delayMs);
        }
        try {
            await fs.access(targetPath);
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return;
            }
            throw error;
        }
    }
    throw new Error(`归档 staging 未及时清理：${targetPath}`);
}
