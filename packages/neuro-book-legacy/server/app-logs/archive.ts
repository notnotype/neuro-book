import fs from "node:fs/promises";
import path from "node:path";
import type {Readable} from "node:stream";
import {ZipFile} from "yazl";
import {listAppLogFiles, resolveAppLogDirectory, type AppLogFileSummary} from "nbook/server/app-logs/logger";

export type AppLogsArchive = {
    filename: string;
    directory: string;
    stream: Readable;
};

type ZipFileWithBuffer = ZipFile & {
    addBuffer(buffer: Buffer, metadataPath: string): void;
};

/**
 * 创建错误报告日志 zip。只包含日志文件和 manifest，不读取业务配置、数据库或 workspace 正文。
 * 隐私红线（Task 95）：`workspace/<slug>/.nbook/history.sqlite` 含项目文件全文快照，严禁纳入本日志包。
 */
export async function createAppLogsZipStream(directory = resolveAppLogDirectory()): Promise<AppLogsArchive> {
    await fs.mkdir(directory, {recursive: true});
    const files = await listAppLogFiles(directory);
    const zipFile = new ZipFile();
    for (const file of files) {
        zipFile.addFile(file.path, `logs/${file.name}`);
    }
    (zipFile as ZipFileWithBuffer).addBuffer(Buffer.from(`${JSON.stringify(await buildManifest(files), null, 4)}\n`, "utf8"), "manifest.json");
    zipFile.end();

    return {
        filename: `neuro-book-logs-${formatArchiveTimestamp(new Date())}.zip`,
        directory,
        stream: zipFile.outputStream,
    };
}

async function buildManifest(files: AppLogFileSummary[]): Promise<Record<string, unknown>> {
    return {
        createdAt: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        bunVersion: readBunVersion(),
        packageVersion: await readPackageVersion(),
        files: files.map((file) => ({
            name: file.name,
            size: file.size,
            mtimeMs: file.mtimeMs,
        })),
    };
}

function readBunVersion(): string | null {
    const runtime = globalThis as typeof globalThis & {Bun?: {version?: string}};
    return runtime.Bun?.version ?? null;
}

async function readPackageVersion(): Promise<string | null> {
    for (const manifestPath of [
        path.join(process.cwd(), "package.json"),
        path.join(process.cwd(), ".output", "server", "package.json"),
    ]) {
        try {
            const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {version?: unknown};
            if (typeof manifest.version === "string") {
                return manifest.version;
            }
        } catch {
            continue;
        }
    }
    return null;
}

function formatArchiveTimestamp(date: Date): string {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${year}${month}${day}-${hour}${minute}${second}`;
}
