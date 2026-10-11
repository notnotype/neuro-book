/**
 * JSONL 存储旁的溢出存储（docs/specs/harness/session.md 输出 24）：`<root>/<会话 id>.artifacts/<序号>/<工具名>.log`。
 * 序号用 `mkdir` 独占创建目录来认领：两个进程（或两个存储实例）同时保存也拿不到同一个号；
 * 写入先落同目录的临时文件再改名，读到的要么是完整的一份要么没有。
 */

import {mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {safeToolName} from "../artifacts";
import type {ArtifactStore, ArtifactSummary} from "../artifacts";
import {isValidSessionId} from "../entries";
import type {Result, SessionFailure} from "../types";

const ID = /^\d+$/u;
const LOG = /^(.*)\.log$/u;

function fail<T>(code: SessionFailure, detail: string): Result<T> {
    return {ok: false, code, detail};
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error ? String((error as {code: unknown}).code) : undefined;
}

type Item = {id: string; toolName: string; file: string};

export function createJsonlArtifactStore(options: {root: string}): ArtifactStore {
    const directoryOf = (sessionId: string): string => join(options.root, `${sessionId}.artifacts`);
    // 下一个序号按会话缓存，省掉每次保存前的扫描；认领撞上已有目录时重新扫（别的写者先用了）
    const nextIds = new Map<string, number>();

    /** 一个序号目录里的那份结果：没有 `.log`（写到一半失败）当不存在。 */
    const fileIn = async (sessionId: string, id: string): Promise<Result<Item | null>> => {
        try {
            const name = (await readdir(join(directoryOf(sessionId), id))).find((candidate) => LOG.test(candidate));
            return {ok: true, value: name === undefined ? null : {id, toolName: LOG.exec(name)![1]!, file: join(id, name)}};
        } catch (error) {
            if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return {ok: true, value: null};
            return fail("store-failed", `读溢出目录失败：${describe(error)}`);
        }
    };

    const scan = async (sessionId: string): Promise<Result<{items: Item[]; next: number}>> => {
        try {
            const names = (await readdir(directoryOf(sessionId))).filter((name) => ID.test(name)).sort((left, right) => Number(left) - Number(right));
            const items: Item[] = [];
            for (const id of names) {
                const item = await fileIn(sessionId, id);
                if (!item.ok) return item;
                if (item.value !== null) items.push(item.value);
            }
            return {ok: true, value: {items, next: names.length === 0 ? 0 : Number(names.at(-1)!) + 1}};
        } catch (error) {
            if (errorCode(error) === "ENOENT") return {ok: true, value: {items: [], next: 0}};
            return fail("store-failed", `列溢出目录失败：${describe(error)}`);
        }
    };

    return {
        async save(sessionId, toolName, text) {
            if (!isValidSessionId(sessionId)) return fail("invalid-session-id", `会话 id 不合规则：${sessionId}`);
            const directory = directoryOf(sessionId);
            let next = nextIds.get(sessionId);
            if (next === undefined) {
                const existing = await scan(sessionId);
                if (!existing.ok) return existing;
                next = existing.value.next;
            }
            try {
                await mkdir(directory, {recursive: true});
            } catch (error) {
                return fail("store-failed", `建溢出目录失败：${describe(error)}`);
            }
            let claimed: string;
            for (;;) {
                claimed = join(directory, String(next));
                try {
                    await mkdir(claimed);
                    break;
                } catch (error) {
                    if (errorCode(error) !== "EEXIST") return fail("store-failed", `认领序号失败：${describe(error)}`);
                    const existing = await scan(sessionId);
                    if (!existing.ok) return existing;
                    next = Math.max(next + 1, existing.value.next);
                }
            }
            const id = String(next);
            nextIds.set(sessionId, next + 1);
            const target = join(claimed, `${safeToolName(toolName)}.log`);
            const temporary = `${target}.tmp-${crypto.randomUUID()}`;
            try {
                await writeFile(temporary, text, "utf8");
                await rename(temporary, target);
                return {ok: true, value: {id, bytes: Buffer.byteLength(text, "utf8")}};
            } catch (error) {
                await rm(temporary, {force: true}).catch(() => undefined);
                // 认领的序号目录留着会成为一个洞：能删就删，删不掉也只是洞
                await rmdir(claimed).catch(() => undefined);
                return fail("store-failed", `写溢出文件失败：${describe(error)}`);
            }
        },
        async read(sessionId, id) {
            if (!isValidSessionId(sessionId)) return fail("invalid-session-id", `会话 id 不合规则：${sessionId}`);
            if (!ID.test(id)) return {ok: true, value: null};
            const item = await fileIn(sessionId, id);
            if (!item.ok) return item;
            if (item.value === null) return {ok: true, value: null};
            try {
                return {ok: true, value: await readFile(join(directoryOf(sessionId), item.value.file), "utf8")};
            } catch (error) {
                return fail("store-failed", `读溢出文件失败：${describe(error)}`);
            }
        },
        async list(sessionId) {
            if (!isValidSessionId(sessionId)) return fail("invalid-session-id", `会话 id 不合规则：${sessionId}`);
            const existing = await scan(sessionId);
            if (!existing.ok) return existing;
            const summaries: ArtifactSummary[] = [];
            for (const item of existing.value.items) {
                try {
                    // 大小取元数据，不读正文：列表不随结果大小变慢
                    summaries.push({id: item.id, toolName: item.toolName, bytes: (await stat(join(directoryOf(sessionId), item.file))).size});
                } catch (error) {
                    return fail("store-failed", `读溢出文件失败：${describe(error)}`);
                }
            }
            return {ok: true, value: summaries};
        },
    };
}
