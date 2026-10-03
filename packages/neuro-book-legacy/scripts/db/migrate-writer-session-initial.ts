import {readdir, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {resolveStateWorkspaceRoot} from "nbook/server/runtime/installation-paths";

type MigrationOptions = {
    rootWorkspace: string;
    dryRun: boolean;
};

type MigrationStats = {
    scanned: number;
    migrated: number;
    skipped: number;
    failed: number;
};

/**
 * 将历史 writer session 的 metadata.initial/input 清理为空对象，适配新的空 InitialSchema。
 */
async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const sessionsRoot = join(options.rootWorkspace, ".nbook", "agent", "sessions");
    const files = await readdir(sessionsRoot, {withFileTypes: true}).catch((error: unknown) => {
        throw new Error(`无法读取 agent session 目录：${sessionsRoot}\n${errorMessage(error)}`);
    });
    const stats: MigrationStats = {
        scanned: 0,
        migrated: 0,
        skipped: 0,
        failed: 0,
    };

    for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".jsonl")) {
            continue;
        }
        stats.scanned += 1;
        const filePath = join(sessionsRoot, file.name);
        try {
            const result = await migrateSessionFile(filePath, options.dryRun);
            if (result === "migrated") {
                stats.migrated += 1;
            } else {
                stats.skipped += 1;
            }
        } catch (error) {
            stats.failed += 1;
            console.error(`[failed] ${filePath}: ${errorMessage(error)}`);
        }
    }

    console.log([
        options.dryRun ? "writer session initial migration dry-run complete" : "writer session initial migration complete",
        `root=${options.rootWorkspace}`,
        `scanned=${stats.scanned}`,
        `migrated=${stats.migrated}`,
        `skipped=${stats.skipped}`,
        `failed=${stats.failed}`,
    ].join("\n"));

    if (stats.failed > 0) {
        process.exitCode = 1;
    }
}

/**
 * 迁移单个 JSONL session 文件。只改 header record，保留其它记录原文顺序。
 */
async function migrateSessionFile(filePath: string, dryRun: boolean): Promise<"migrated" | "skipped"> {
    const text = await readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => isHeaderLine(line));
    if (headerIndex < 0) {
        throw new Error("缺少 header record");
    }

    const headerLine = lines[headerIndex];
    if (headerLine === undefined) throw new Error("header record 索引越界");
    const header = JSON.parse(headerLine) as {
        kind: "header";
        metadata?: Record<string, unknown>;
    };
    if (!header.metadata) {
        throw new Error("header.metadata 缺失");
    }
    if (header.metadata.profileKey !== "writer") {
        return "skipped";
    }

    const currentInitial = header.metadata.initial;
    const currentInput = header.metadata.input;
    const needsMigration = hasInitialData(currentInitial) || hasInitialData(currentInput) || Object.hasOwn(header.metadata, "input");
    if (!needsMigration) {
        return "skipped";
    }

    header.metadata.initial = {};
    delete header.metadata.input;
    console.log(`${dryRun ? "[dry-run]" : "[migrate]"} ${filePath}`);
    if (dryRun) {
        return "migrated";
    }

    lines[headerIndex] = JSON.stringify(header);
    const migratedText = lines.join("\n");
    const tempPath = `${filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, migratedText, "utf8");
    try {
        await rename(tempPath, filePath);
    } catch (error) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
    }
    return "migrated";
}

/**
 * 判断一行 JSONL 是否为 session header。
 */
function isHeaderLine(line: string): boolean {
    if (!line.trim()) {
        return false;
    }
    try {
        const record = JSON.parse(line) as {kind?: string};
        return record.kind === "header";
    } catch {
        return false;
    }
}

/**
 * 旧 writer initial/input 只要包含字段就需要清空；新合同的唯一合法值是 {}。
 */
function hasInitialData(value: unknown): boolean {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

/**
 * 解析命令行参数。默认 dry-run；传 --write 才实际写入。
 */
function parseArgs(args: string[]): MigrationOptions {
    let rootWorkspace = resolveStateWorkspaceRoot();
    let dryRun = true;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === undefined) throw new Error("命令行参数解析越界");
        if (arg === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (arg === "--write") {
            dryRun = false;
            continue;
        }
        if (arg === "--root") {
            const value = args[index + 1];
            if (!value) {
                throw new Error("--root 必须提供路径");
            }
            rootWorkspace = resolve(value);
            index += 1;
            continue;
        }
        if (arg.startsWith("--root=")) {
            rootWorkspace = resolve(arg.slice("--root=".length));
            continue;
        }
        throw new Error(`未知参数：${arg}`);
    }
    return {rootWorkspace, dryRun};
}

/**
 * 将 unknown error 统一转成人类可读字符串。
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

await main();
