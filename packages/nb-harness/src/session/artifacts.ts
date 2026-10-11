/**
 * 溢出存储（docs/specs/harness/session.md 输出 24）：工具结果超过预算时全文存在这里，上下文里只留头尾与一个 `artifact://<序号>` 的回读链接。
 * 序号在会话内从 0 起递增；内存实现给测试与不落盘的宿主，JSONL 存储旁的目录实现在子入口 `session/jsonl`。
 */

import type {Result} from "./types";

export type ArtifactSummary = {id: string; toolName: string; bytes: number};

export interface ArtifactStore {
    /** 保存全文，返回会话内的序号；`toolName` 只用于文件名与列表。 */
    save(sessionId: string, toolName: string, text: string): Promise<Result<{id: string; bytes: number}>>;
    /** 不存在的序号为 `null`，不是失败。 */
    read(sessionId: string, id: string): Promise<Result<string | null>>;
    list(sessionId: string): Promise<Result<ArtifactSummary[]>>;
}

/** 文件名里的工具名：只留 `[A-Za-z0-9_-]`，最长 64；插件工具名带 `/`，不能直接进路径。 */
export function safeToolName(toolName: string): string {
    const cleaned = toolName.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 64).replace(/^_+|_+$/gu, "");
    return cleaned === "" ? "tool" : cleaned;
}

const encoder = new TextEncoder();

export function createMemoryArtifactStore(): ArtifactStore {
    const sessions = new Map<string, {toolName: string; text: string}[]>();
    const of = (sessionId: string): {toolName: string; text: string}[] => {
        let list = sessions.get(sessionId);
        if (list === undefined) {
            list = [];
            sessions.set(sessionId, list);
        }
        return list;
    };
    return {
        async save(sessionId, toolName, text) {
            const list = of(sessionId);
            list.push({toolName: safeToolName(toolName), text});
            return {ok: true, value: {id: String(list.length - 1), bytes: encoder.encode(text).length}};
        },
        async read(sessionId, id) {
            const item = /^\d+$/u.test(id) ? sessions.get(sessionId)?.[Number(id)] : undefined;
            return {ok: true, value: item === undefined ? null : item.text};
        },
        async list(sessionId) {
            return {ok: true, value: (sessions.get(sessionId) ?? []).map((item, index) => ({id: String(index), toolName: item.toolName, bytes: encoder.encode(item.text).length}))};
        },
    };
}
