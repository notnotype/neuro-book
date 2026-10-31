/**
 * 内存存储：同一份 JSONL 存储跑在内存里的文件上，行为与会话目录上的完全一致（session.md 输出 21）。
 * 每次读写都经过同样的编码与解析，所以 `Date`、`Map`、`undefined` 这类只在文件里会坏的写法在内存里同样坏。
 */

import {dirname} from "node:path";
import type {LogStore} from "../api/index.js";
import type {AppendFile, FilePort} from "./files.js";
import {createJsonlStore} from "./jsonl-store.js";

function enoent(path: string): Error {
    return Object.assign(new Error(`ENOENT: no such file or directory, ${path}`), {code: "ENOENT"});
}

/** 内存里的文件系统：只实现存储用到的操作。锁按路径排他，同一进程第二次拿也拿不到（与操作系统锁一致）。 */
export function memoryFiles(): FilePort {
    const contents = new Map<string, Uint8Array>();
    const directories = new Set<string>(["/"]);
    const locks = new Set<string>();
    const requireDirectory = (path: string) => {
        if (!directories.has(dirname(path))) throw enoent(path);
    };
    return {
        async makeDirectory(path) {
            requireDirectory(path);
            if (directories.has(path)) return false;
            directories.add(path);
            return true;
        },
        async makeDirectories(path) {
            for (let current = path; !directories.has(current); current = dirname(current)) directories.add(current);
        },
        async read(path) {
            const data = contents.get(path);
            return data === undefined ? null : data.slice();
        },
        async writeAtomic(path, data) {
            requireDirectory(path);
            contents.set(path, data.slice());
        },
        async openAppend(path): Promise<AppendFile> {
            if (!contents.has(path)) throw enoent(path);
            return {
                async write(data, position) {
                    const current = contents.get(path) ?? new Uint8Array();
                    const next = new Uint8Array(Math.max(current.length, position + data.length));
                    next.set(current);
                    next.set(data, position);
                    contents.set(path, next);
                },
                async sync() {},
                async truncate(size) {
                    contents.set(path, (contents.get(path) ?? new Uint8Array()).slice(0, size));
                },
                async close() {},
            };
        },
        async list(path) {
            const prefix = path.endsWith("/") ? path : `${path}/`;
            const names = new Set<string>();
            for (const entry of [...directories, ...contents.keys()]) {
                if (entry.startsWith(prefix) && entry !== path) names.add(entry.slice(prefix.length).split("/")[0]!);
            }
            return [...names];
        },
        async remove(path) {
            if (!contents.delete(path)) throw enoent(path);
        },
        lock(path) {
            requireDirectory(path);
            if (locks.has(path)) return null;
            locks.add(path);
            let released = false;
            return {
                release() {
                    if (released) return;
                    released = true;
                    locks.delete(path);
                },
            };
        },
    };
}

export function createMemoryStore(): LogStore {
    return createJsonlStore({root: "/sessions", files: memoryFiles()});
}
