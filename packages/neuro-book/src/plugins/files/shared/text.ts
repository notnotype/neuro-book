/**
 * 文本的解码规则（docs/specs/workspace/files.md 的“读取与保存”）：文件服务读文本、写入接口的 `update` 与 Agent 内核的资源接口
 * 共用，同一份字节在各处得到同一个结论。不引 Node。
 */

/** 只接受 UTF-8；BOM 留在文本里（保存时原样写回），含 NUL 的视为二进制。 */
export function decodeText(bytes: Uint8Array): string | null {
    if (bytes.includes(0)) return null;
    try {
        return new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes);
    } catch {
        // 非法 UTF-8：TextDecoder 只给 TypeError，没有更多可记的信息。
        return null;
    }
}
