/**
 * 模型来源的文件存放（`@notnotype/nb-models/core` 的 `SourceStore`，docs/specs/models/service.md“模型来源”）：每家服务商的列表缓存在
 * 状态根的 `agent/model-sources/<键>.json`，键是服务核心给的 32 位十六进制（`uid` 的摘要，定长、只有小写字母与数字，各平台都能当
 * 文件名、大小写不敏感时也不撞），在线目录的副本在 `agent/model-catalog.json`。
 *
 * 写入先落同目录、随机名、排他创建的暂存文件再原子改名；建目录时逐段先 `lstat` 再建下一段，存、读、列都不跟链接（目录被换成链接时
 * 不在链接指向的地方建任何东西）；读按上限在打开的句柄上读。
 */

import {randomBytes} from "node:crypto";
import {mkdir, open, readdir, rename, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {SourceStore} from "@notnotype/nb-models/core";

import {entryInside} from "nbook/plugin-platform/backend/plugin-files";

const AGENT = "agent";
const SOURCES = "model-sources";
const CATALOG = "model-catalog.json";
/** 列表缓存至多 5000 行，在线目录的 base64 至多约 11 MiB：上限留余量，防文件被换成大文件。 */
const READ_LIMIT = 16 * 1024 * 1024;
const KEY = /^[0-9a-f]{32}$/u;
const FILE = /^[0-9a-f]{32}\.json$/u;

function fileOf(key: string): string {
    if (!KEY.test(key)) throw new Error("a model source key must be 32 lowercase hex characters");
    return `${key}.json`;
}

/**
 * 状态根下的一个目录（不跟链接）。`create` 为真时逐段建：每一段先按 `entryInside` 核对已有的部分是普通目录，缺的这一段才建（0700），
 * 所以前面哪一段被换成链接时，不会在链接指向的地方建出东西。被换成链接或不是目录时为 null。
 */
async function directory(stateRoot: string, segments: readonly string[], create: boolean): Promise<string | null> {
    if (create) {
        // 状态根本身由宿主认领，可以直接建；它下面的每一段都要核对。
        await mkdir(stateRoot, {recursive: true, mode: 0o700});
        for (let depth = 1; depth <= segments.length; depth += 1) {
            const part = segments.slice(0, depth);
            let found = await entryInside(stateRoot, part, "directory");
            if (found === "missing") {
                // “没有”也包括这一段是链接或文件：建的时候撞上已有的（EEXIST）再核对一次，不是普通目录就停。
                await mkdir(join(stateRoot, ...part), {mode: 0o700}).catch((error: unknown) => {
                    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
                });
                found = await entryInside(stateRoot, part, "directory");
            }
            if (found === "missing") return null;
            if (!("path" in found)) throw found.error;
        }
    }
    const found = await entryInside(stateRoot, segments, "directory");
    if (found === "missing") return null;
    if (!("path" in found)) throw found.error;
    return found.path;
}

async function readJson(stateRoot: string, segments: readonly string[]): Promise<unknown> {
    const found = await entryInside(stateRoot, segments, "file");
    if (found === "missing") return null;
    if (!("path" in found)) throw found.error;
    const handle = await open(found.path, "r");
    try {
        const buffer = new Uint8Array(READ_LIMIT + 1);
        let length = 0;
        while (length < buffer.length) {
            const {bytesRead} = await handle.read(buffer, length, buffer.length - length, null);
            if (bytesRead === 0) break;
            length += bytesRead;
        }
        if (length > READ_LIMIT) throw new Error(`${segments.at(-1) ?? "file"} is larger than ${String(READ_LIMIT)} bytes`);
        return JSON.parse(new TextDecoder().decode(buffer.subarray(0, length))) as unknown;
    } finally {
        await handle.close();
    }
}

async function writeJson(stateRoot: string, segments: readonly string[], name: string, value: unknown): Promise<void> {
    const parent = await directory(stateRoot, segments, true);
    if (parent === null) throw new Error(`${segments.join("/")} is not a plain directory`);
    // 随机名、排他创建：碰到残留的同名文件时失败，不去写别人的文件。
    const temp = join(parent, `.${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(temp, JSON.stringify(value), {mode: 0o600, flag: "wx"});
    try {
        await rename(temp, join(parent, name));
    } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
    }
}

export function fileSourceStore(stateRoot: string): SourceStore {
    return {
        read: async (key) => readJson(stateRoot, [AGENT, SOURCES, fileOf(key)]),
        write: async (key, value) => writeJson(stateRoot, [AGENT, SOURCES], fileOf(key), value),
        async remove(key) {
            const parent = await directory(stateRoot, [AGENT, SOURCES], false);
            if (parent === null) return;
            try {
                await unlink(join(parent, fileOf(key)));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        },
        async list() {
            const parent = await directory(stateRoot, [AGENT, SOURCES], false);
            if (parent === null) return [];
            return (await readdir(parent)).filter((name) => FILE.test(name)).map((name) => name.slice(0, -".json".length));
        },
        readCatalog: () => readJson(stateRoot, [AGENT, CATALOG]),
        writeCatalog: (value) => writeJson(stateRoot, [AGENT], CATALOG, value),
    };
}
