/**
 * 世界日志用到的文件操作，收成一个很窄的接口（t29 计划“node 存储”）：产品用 `nodeFiles`，测试另有按脚本注入失败的
 * 实现（tests/fixtures/faulty-files.ts），两者跑同一组契约测试，替身才可信（docs/testing/README.md“依赖用真的”）。
 *
 * 每个写操作返回时都已落盘：追加与截断后 fsync 文件，新建文件后再 fsync 所在目录，免得断电后目录项丢失。
 */

import {constants} from "node:fs";
import {mkdir, open, readdir, readFile, stat} from "node:fs/promises";
import {dirname} from "node:path";

export interface LogFiles {
    /** 目录里的文件名；目录不存在时为空。 */
    list(dir: string): Promise<string[]>;
    read(path: string): Promise<Uint8Array>;
    /** 文件长度；不存在时为 null。 */
    size(path: string): Promise<number | null>;
    /** 追加并落盘。失败时可能已写进一部分，由调用方截回。 */
    append(path: string, bytes: Uint8Array): Promise<void>;
    /** 截到给定长度并落盘。 */
    truncate(path: string, length: number): Promise<void>;
    /** 新建一个文件（已存在就失败）并落盘，连同所在目录。 */
    create(path: string, bytes: Uint8Array): Promise<void>;
    mkdirp(path: string): Promise<void>;
}

export const nodeFiles: LogFiles = {
    async list(dir) {
        try {
            return await readdir(dir);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
        }
    },
    async read(path) {
        return new Uint8Array(await readFile(path));
    },
    async size(path) {
        try {
            return (await stat(path)).size;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
        }
    },
    async append(path, bytes) {
        const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
        try {
            await handle.write(bytes);
            await handle.sync();
        } finally {
            await handle.close();
        }
    },
    async truncate(path, length) {
        const handle = await open(path, constants.O_WRONLY);
        try {
            await handle.truncate(length);
            await handle.sync();
        } finally {
            await handle.close();
        }
    },
    async create(path, bytes) {
        const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
        try {
            await handle.write(bytes);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await syncDir(dirname(path));
    },
    async mkdirp(path) {
        await mkdir(path, {recursive: true});
    },
};

async function syncDir(path: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}
