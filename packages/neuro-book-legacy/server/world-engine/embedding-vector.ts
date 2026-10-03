/**
 * World Engine 向量工具：Float32 BLOB 编解码 + 余弦相似度。
 *
 * 向量作为 WorldPatch 的 `vector` 列存储（Decision #8），用紧凑的
 * Float32 字节（4B × dim）落库，比 JSON 浮点文本省约 5×。
 *
 * 这些是纯函数，不依赖 DB / 网络，便于单测。
 */

/** 将向量编码为 Float32 小端字节，用于写入 BLOB 列。 */
export function encodeVector(vector: number[]): Uint8Array {
    const floats = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
        floats[i] = vector[i] ?? 0;
    }
    // 复制出独立的字节视图，避免共享底层 buffer 带来的别名问题。
    return new Uint8Array(floats.buffer.slice(0));
}

/** 将 BLOB 字节解码回向量。长度非 4 的倍数时抛错（数据损坏）。 */
export function decodeVector(bytes: Uint8Array): number[] {
    if (bytes.byteLength % 4 !== 0) {
        throw new Error(`vector BLOB 字节数必须是 4 的倍数，实际：${bytes.byteLength}`);
    }
    // 用对齐的副本构造 Float32Array，避免 byteOffset 未对齐报错。
    const aligned = bytes.byteOffset % 4 === 0
        ? new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
        : new Float32Array(bytes.slice().buffer);
    return Array.from(aligned);
}

/**
 * 余弦相似度，返回 [-1, 1]。维度不一致或零向量返回 0。
 *
 * 注意：调用方应已按 model 过滤同维度向量（Decision #19）；
 * 这里对维度不一致兜底返回 0，不抛错。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || a.length !== b.length) {
        return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        dot += x * y;
        normA += x * x;
        normB += y * y;
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
