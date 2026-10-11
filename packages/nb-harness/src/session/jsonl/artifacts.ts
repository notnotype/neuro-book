/**
 * JSONL 存储旁的溢出存储（docs/specs/harness/session.md 输出 24）：`<root>/<会话 id>.artifacts/<序号>.<工具名>.log`。
 * 序号第一次用到时扫目录续号（重开会话不覆盖旧文件）；写入先落临时文件再改名，读到的要么是完整的一份要么没有。
 */

import {mkdir, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {safeToolName} from "../artifacts";
import type {ArtifactStore, ArtifactSummary} from "../artifacts";
import {isValidSessionId} from "../entries";
import type {Result, SessionFailure} from "../types";

const FILE = /^(\d+)\.(.*)\.log$/u;

function fail<T>(code: SessionFailure, detail: string): Result<T> {
    return {ok: false, code, detail};
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error ? String((error as {code: unknown}).code) : undefined;
}

export function createJsonlArtifactStore(options: {root: string}): ArtifactStore {
    const directoryOf = (sessionId: string): string => join(options.root, `${sessionId}.artifacts`);
    // 下一个序号按会话缓存；第一次用到时扫目录，所以进程重启后接着旧的编
    const nextIds = new Map<string, number>();

    const scan = async (sessionId: string): Promise<Result<{id: string; toolName: string; file: string}[]>> => {
        try {
            const names = await readdir(directoryOf(sessionId));
            const items: {id: string; toolName: string; file: string}[] = [];
            for (const name of names) {
                const match = FILE.exec(name);
                if (match !== null) items.push({id: match[1]!, toolName: match[2]!, file: name});
            }
            items.sort((left, right) => Number(left.id) - Number(right.id));
            return {ok: true, value: items};
        } catch (error) {
            if (errorCode(error) === "ENOENT") return {ok: true, value: []};
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
                next = existing.value.length === 0 ? 0 : Number(existing.value.at(-1)!.id) + 1;
            }
            const id = String(next);
            nextIds.set(sessionId, next + 1);
            const target = join(directory, `${id}.${safeToolName(toolName)}.log`);
            const temporary = `${target}.tmp-${crypto.randomUUID()}`;
            try {
                await mkdir(directory, {recursive: true});
                await writeFile(temporary, text, "utf8");
                await rename(temporary, target);
                return {ok: true, value: {id, bytes: Buffer.byteLength(text, "utf8")}};
            } catch (error) {
                await rm(temporary, {force: true}).catch(() => undefined);
                return fail("store-failed", `写溢出文件失败：${describe(error)}`);
            }
        },
        async read(sessionId, id) {
            if (!isValidSessionId(sessionId)) return fail("invalid-session-id", `会话 id 不合规则：${sessionId}`);
            if (!/^\d+$/u.test(id)) return {ok: true, value: null};
            const existing = await scan(sessionId);
            if (!existing.ok) return existing;
            const item = existing.value.find((candidate) => candidate.id === id);
            if (item === undefined) return {ok: true, value: null};
            try {
                return {ok: true, value: await readFile(join(directoryOf(sessionId), item.file), "utf8")};
            } catch (error) {
                return fail("store-failed", `读溢出文件失败：${describe(error)}`);
            }
        },
        async list(sessionId) {
            if (!isValidSessionId(sessionId)) return fail("invalid-session-id", `会话 id 不合规则：${sessionId}`);
            const existing = await scan(sessionId);
            if (!existing.ok) return existing;
            const summaries: ArtifactSummary[] = [];
            for (const item of existing.value) {
                try {
                    const bytes = (await readFile(join(directoryOf(sessionId), item.file))).byteLength;
                    summaries.push({id: item.id, toolName: item.toolName, bytes});
                } catch (error) {
                    return fail("store-failed", `读溢出文件失败：${describe(error)}`);
                }
            }
            return {ok: true, value: summaries};
        },
    };
}
