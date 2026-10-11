/**
 * `artifact://` 的虚拟提供者（docs/specs/harness/builtin-tools.md 输出 9）：按会话读溢出存储里的工具结果全文，只读。
 * 读取接口按形状声明（与 session 模块的 `ArtifactStore` 同形），本模块不依赖 session。
 */

import type {FilesResult, SchemeContext, VirtualProvider} from "./types";

/** 任一失败形状都按 `io-failed` 处理，调用方不需要知道存储层的码。 */
type ReaderResult<T> = {ok: true; value: T} | {ok: false; code: string; detail: string};

export interface ArtifactReader {
    read(sessionId: string, id: string): Promise<ReaderResult<string | null>>;
    list(sessionId: string): Promise<ReaderResult<{id: string; toolName: string; bytes: number}[]>>;
}

export function createArtifactProvider(reader: ArtifactReader): (context: SchemeContext) => VirtualProvider {
    return ({sessionId}) => {
        const failed = <T>(result: {code: string; detail: string}): FilesResult<T> => ({ok: false, code: "io-failed", detail: `${result.code}：${result.detail}`});
        const load = async (id: string): Promise<FilesResult<string>> => {
            const read = await reader.read(sessionId, id);
            if (!read.ok) return failed(read);
            if (read.value === null) return {ok: false, code: "not-found", detail: `没有 artifact://${id}`};
            return {ok: true, value: read.value};
        };
        return {
            kind: "virtual",
            async stat(path) {
                if (path === ".") return {ok: true, value: {kind: "directory", bytes: 0}};
                if (path.includes("/")) return {ok: false, code: "not-found", detail: `artifact:// 下只有序号，没有子目录：${path}`};
                // 大小来自列表的元数据，不读全文：全文只在 readText 读一次
                const listed = await reader.list(sessionId);
                if (!listed.ok) return failed(listed);
                const item = listed.value.find((candidate) => candidate.id === path);
                return item === undefined ? {ok: false, code: "not-found", detail: `没有 artifact://${path}`} : {ok: true, value: {kind: "file", bytes: item.bytes}};
            },
            async readText(path) {
                if (path === "." || path.includes("/")) return {ok: false, code: "not-a-file", detail: `artifact://${path === "." ? "" : path} 不是一份结果`};
                return load(path);
            },
            async list(path) {
                if (path !== ".") return {ok: false, code: "not-a-directory", detail: `artifact://${path} 不是目录`};
                const listed = await reader.list(sessionId);
                if (!listed.ok) return failed(listed);
                return {ok: true, value: listed.value.map((item) => ({name: item.id, kind: "file" as const}))};
            },
        };
    };
}
