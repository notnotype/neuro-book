/**
 * 语义档的归纳缓存文件（docs/specs/canon/project.md 输出 12）：一行一条 `{key, text}`，只追加，每行一次写完。
 * 同一个键有几行时取文件里最早的那条有效的；坏行跳过并写诊断。删掉它只会让值暂时回到“未归纳”。
 */

import {dirname} from "node:path";

import type {LogFiles} from "./files";

export interface ReductionCache {
    readonly entries: Map<string, string>;
    readonly badLines: number[];
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export async function loadReductions(files: LogFiles, path: string): Promise<ReductionCache> {
    const entries = new Map<string, string>();
    const badLines: number[] = [];
    if ((await files.size(path)) === null) return {entries, badLines};
    const lines = decoder.decode(await files.read(path)).split("\n");
    for (const [index, line] of lines.entries()) {
        if (line.trim() === "") continue;
        try {
            const value = JSON.parse(line) as {key?: unknown; text?: unknown};
            if (typeof value.key !== "string" || typeof value.text !== "string") throw new Error("shape");
            if (!entries.has(value.key)) entries.set(value.key, value.text);
        } catch {
            badLines.push(index + 1);
        }
    }
    return {entries, badLines};
}

export async function appendReduction(files: LogFiles, path: string, key: string, text: string): Promise<void> {
    await files.mkdirp(dirname(path));
    await files.append(path, encoder.encode(`${JSON.stringify({key, text})}\n`));
}
