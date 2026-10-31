/**
 * 存储用到的文件操作。产品用 `nodeFiles`（node:fs）；测试换一个在第 N 次写入或同步时抛错的实现来测写失败，
 * 产品代码里没有测试专用分支。
 */

import {mkdir, open, readdir, readFile, rename, unlink} from "node:fs/promises";
import {dirname, join} from "node:path";
import {tryLock, type FileLock} from "./flock.js";

/** 只追加的日志文件句柄。`write` 写满整个缓冲区（短写会接着写），失败抛错。 */
export interface AppendFile {
    write(data: Uint8Array, position: number): Promise<void>;
    sync(): Promise<void>;
    truncate(size: number): Promise<void>;
    close(): Promise<void>;
}

/** 按块读的文件句柄：打开会话时不把整个文件读进内存。 */
export interface ReadFile {
    readonly size: number;
    /** 从 `position` 起读进 `buffer`，返回读到的字节数（0 表示到头）。 */
    read(buffer: Uint8Array, position: number): Promise<number>;
    close(): Promise<void>;
}

export interface FilePort {
    /** 建一层目录；已存在时返回 false。 */
    makeDirectory(path: string): Promise<boolean>;
    makeDirectories(path: string): Promise<void>;
    /** 不存在时返回 null。 */
    read(path: string): Promise<Uint8Array | null>;
    /** 先写临时文件再改名；`sync` 时同步文件与所在目录到盘。 */
    writeAtomic(path: string, data: Uint8Array, options: {sync: boolean}): Promise<void>;
    openAppend(path: string): Promise<AppendFile>;
    /** 不存在时返回 null。 */
    openRead(path: string): Promise<ReadFile | null>;
    list(path: string): Promise<string[]>;
    remove(path: string): Promise<void>;
    lock(path: string): FileLock | null;
}

function errorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error ? String((error as {code: unknown}).code) : undefined;
}

/** 目录也要同步，改名才算落盘；Windows 打不开目录句柄，跳过（NTFS 的改名是日志式的）。 */
async function syncDirectory(path: string): Promise<void> {
    if (process.platform === "win32") return;
    const handle = await open(path, "r");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

let temporaryCounter = 0;

export const nodeFiles: FilePort = {
    async makeDirectory(path) {
        try {
            await mkdir(path);
            return true;
        } catch (error) {
            if (errorCode(error) === "EEXIST") return false;
            throw error;
        }
    },
    async makeDirectories(path) {
        await mkdir(path, {recursive: true});
    },
    async read(path) {
        try {
            return await readFile(path);
        } catch (error) {
            // 路径中间有一段不是目录（例如状态根里的普通文件被当成会话目录）也算不存在。
            if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
            throw error;
        }
    },
    async writeAtomic(path, data, options) {
        temporaryCounter += 1;
        const temporary = join(dirname(path), `.${process.pid}.${temporaryCounter}.tmp`);
        const handle = await open(temporary, "w");
        try {
            await handle.writeFile(data);
            if (options.sync) await handle.sync();
        } finally {
            await handle.close();
        }
        try {
            await rename(temporary, path);
        } catch (error) {
            // 改名失败时临时文件留着没用，删掉；删不掉就两个错一起报。
            const cleanup = await unlink(temporary).then(() => null, (unlinkError: unknown) => unlinkError);
            throw cleanup === null ? error : new AggregateError([error, cleanup], `rename ${temporary} failed and the temporary file could not be removed`);
        }
        if (options.sync) await syncDirectory(dirname(path));
    },
    async openAppend(path) {
        // r+ 而不是 a：日志文件被删时报错，而不是悄悄造出一个没有会话头的文件。
        const handle = await open(path, "r+");
        return {
            async write(data, position) {
                let offset = 0;
                while (offset < data.length) {
                    const {bytesWritten} = await handle.write(data, offset, data.length - offset, position + offset);
                    if (bytesWritten <= 0) throw new Error(`write stopped at byte ${offset} of ${data.length}`);
                    offset += bytesWritten;
                }
            },
            sync: () => handle.sync(),
            truncate: (size) => handle.truncate(size),
            close: () => handle.close(),
        };
    },
    async openRead(path) {
        let handle;
        try {
            handle = await open(path, "r");
        } catch (error) {
            if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
            throw error;
        }
        const {size} = await handle.stat();
        return {
            size,
            read: async (buffer, position) => (await handle.read(buffer, 0, buffer.length, position)).bytesRead,
            close: () => handle.close(),
        };
    },
    async list(path) {
        try {
            return await readdir(path);
        } catch (error) {
            if (errorCode(error) === "ENOENT") return [];
            throw error;
        }
    },
    async remove(path) {
        await unlink(path);
    },
    lock: tryLock,
};
