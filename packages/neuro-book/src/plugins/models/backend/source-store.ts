/**
 * 模型来源的文件存放（`@notnotype/nb-models/core` 的 `SourceStore`，docs/specs/models/service.md“模型来源”）：每家服务商的列表缓存在
 * 状态根的 `agent/model-sources/<uid 的十六进制>.json`，在线目录的副本在 `agent/model-catalog.json`。文件名用 `uid` 的 UTF-8 十六进制：
 * v1 读来的 `legacy:<id>` 带冒号（Windows 不许），大小写不敏感的文件系统上也不会撞名。
 *
 * 写入先落同目录的暂存文件再原子改名；存、读、列都从状态根起逐段 `lstat`、不跟链接（同图标目录）；读按上限在打开的句柄上读。
 */

import {mkdir, open, readdir, rename, unlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {SourceStore} from "@notnotype/nb-models/core";

import {entryInside} from "nbook/plugin-platform/backend/plugin-files";

const AGENT = "agent";
const SOURCES = "model-sources";
const CATALOG = "model-catalog.json";
/** 列表缓存至多 5000 行，在线目录的 base64 至多约 11 MiB：上限留余量，防文件被换成大文件。 */
const READ_LIMIT = 16 * 1024 * 1024;
const FILE = /^([0-9a-f]{2}){1,160}\.json$/u;

const fileOf = (uid: string): string => `${Buffer.from(uid, "utf8").toString("hex")}.json`;
const uidOf = (name: string): string => Buffer.from(name.slice(0, -".json".length), "hex").toString("utf8");

/** 状态根下的一个目录（逐段 `lstat`、不跟链接）；`create` 为真时先建出来（0700）。被换成链接或不是目录时为 null。 */
async function directory(stateRoot: string, segments: readonly string[], create: boolean): Promise<string | null> {
    if (create) await mkdir(join(stateRoot, ...segments), {recursive: true, mode: 0o700});
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
    const temp = join(parent, `.${name}.${String(process.pid)}.${String(Date.now())}.tmp`);
    await writeFile(temp, JSON.stringify(value), {mode: 0o600});
    try {
        await rename(temp, join(parent, name));
    } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
    }
}

export function fileSourceStore(stateRoot: string): SourceStore {
    return {
        read: (uid) => readJson(stateRoot, [AGENT, SOURCES, fileOf(uid)]),
        write: (uid, value) => writeJson(stateRoot, [AGENT, SOURCES], fileOf(uid), value),
        async remove(uid) {
            const parent = await directory(stateRoot, [AGENT, SOURCES], false);
            if (parent === null) return;
            try {
                await unlink(join(parent, fileOf(uid)));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        },
        async list() {
            const parent = await directory(stateRoot, [AGENT, SOURCES], false);
            if (parent === null) return [];
            return (await readdir(parent)).filter((name) => FILE.test(name)).map(uidOf);
        },
        readCatalog: () => readJson(stateRoot, [AGENT, CATALOG]),
        writeCatalog: (value) => writeJson(stateRoot, [AGENT], CATALOG, value),
    };
}
