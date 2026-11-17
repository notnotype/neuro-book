/**
 * 插件文件夹的上传（docs/specs/runtime/plugin-install.md 输出 11 与“边界与兼容”的上传接口）：页面与服务端共用的分帧、限额与
 * 路径规则。页面拼请求体、收集文件夹时先查路径与限额，服务端边读边写时再查一遍；两边用同一份，数出来的数不会不一致。
 *
 * 请求体是一串帧：4 字节大端的头长度 N（1 到 `MAX_HEADER_BYTES`）、N 字节 UTF-8 JSON `{path, size}`、`size` 字节的内容。没有
 * 结束帧：在帧的边界上流结束才算完整，在帧中间结束、空请求体都是 `upload-malformed`。不用 tar 或 multipart：浏览器里写 tar 要
 * 加依赖，multipart 在 Bun 与 Hono 里都要整份读进内存才能解析；这套分帧两边各几十行，能边收边处理。
 *
 * 本文件不依赖 DOM：页面一侧拼 `Blob` 在 `web/` 里做。
 */

export interface UploadLimits {
    readonly maxFiles: number;
    /** 总量含分帧头。 */
    readonly maxTotalBytes: number;
    readonly maxFileBytes: number;
}

/**
 * 上限（plugin-install 输出 11）：64 MiB 远低于 HTTP 端口的请求体上限（Bun 缺省 128 MiB，server-host 的已知限制）；构建好的插件
 * 远小于它。
 */
export const UPLOAD_LIMITS: UploadLimits = Object.freeze({maxFiles: 10_000, maxTotalBytes: 64 * 1024 * 1024, maxFileBytes: 32 * 1024 * 1024});

export const MAX_HEADER_BYTES = 2048;
const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_BYTES = 1024;

export type UploadErrorCode = "upload-too-large" | "upload-path-invalid" | "upload-malformed";

/** 上传不合规：`code` 就是路由的失败码，`detail` 说明哪里不合规（给人看，不按文字分支）。 */
export class UploadError extends Error {
    readonly code: UploadErrorCode;

    constructor(code: UploadErrorCode, detail: string) {
        super(detail);
        this.name = "UploadError";
        this.code = code;
    }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {fatal: true});

/** Windows 的保留设备名：不分大小写，带扩展名也算（`nul.txt`）。 */
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/iu;
const FORBIDDEN_CHARACTER = /[\\:<>"|?*\u0000-\u001f\u007f]|\p{Cs}/u;

/**
 * 相对路径合不合规，不合规时交回原因，合规交回 null。一律按 Windows 也合法的规则查，不论服务端在什么系统上：插件要能在
 * Windows 上装。
 */
export function uploadPathProblem(path: string): string | null {
    if (path === "") return "路径是空的";
    // 长度按写盘的形式（NFC）与原样两者中较长的算：NFC 不保证变短，只查原样会放过规范化之后超限的名字，落盘时才以 ENAMETOOLONG 失败。
    const written = normalizeUploadPath(path);
    if (Math.max(encoder.encode(path).length, encoder.encode(written).length) > MAX_PATH_BYTES) return `路径超过 ${String(MAX_PATH_BYTES)} 字节`;
    if (path.startsWith("/")) return "路径不能以 / 开头";
    for (const segment of path.split("/")) {
        if (segment === "") return "路径里有空的一段";
        if (segment === "." || segment === "..") return `路径里不能有 ${segment}`;
        if (FORBIDDEN_CHARACTER.test(segment)) return `路径里有不能用的字符：${segment}`;
        if (segment.endsWith(" ") || segment.endsWith(".")) return `名字不能以空格或点结尾：${segment}`;
        if (RESERVED_NAME.test(segment.split(".")[0] ?? "")) return `${segment} 是 Windows 的保留名`;
        if (Math.max(encoder.encode(segment).length, encoder.encode(normalizeUploadPath(segment)).length) > MAX_SEGMENT_BYTES) return `名字超过 ${String(MAX_SEGMENT_BYTES)} 字节：${segment}`;
    }
    return null;
}

/** 写盘用的形式：NFC。 */
export function normalizeUploadPath(path: string): string {
    return path.normalize("NFC");
}

/**
 * 比较用的键：NFC、再“大写再小写”（NTFS 按大写比，只做小写会漏掉 `ς`、`ı` 这类）。同一次上传里键相同的两条路径在 Windows
 * 与 macOS 上会撞成一个文件。
 */
function collisionKey(path: string): string {
    return normalizeUploadPath(path).toUpperCase().toLowerCase();
}

/**
 * 一次上传里已收到的路径：检查新路径与已有的会不会撞名（只差大小写或归一化形式），或一个是另一个的上层目录（文件与目录同名）。
 * 页面收集时与服务端接收时各用一份。
 */
export class UploadPathSet {
    readonly #files = new Set<string>();
    readonly #directories = new Set<string>();

    /** 不合规时抛 `UploadError("upload-path-invalid")`；合规就登记并交回写盘用的 NFC 路径。 */
    add(path: string): string {
        const problem = uploadPathProblem(path);
        if (problem !== null) throw new UploadError("upload-path-invalid", problem);
        const key = collisionKey(path);
        const segments = key.split("/");
        const ancestors = segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
        if (this.#files.has(key) || this.#directories.has(key)) throw new UploadError("upload-path-invalid", `路径重复或与别的路径撞名：${path}`);
        for (const ancestor of ancestors) if (this.#files.has(ancestor)) throw new UploadError("upload-path-invalid", `${path} 的上层目录与一个文件同名`);
        this.#files.add(key);
        for (const ancestor of ancestors) this.#directories.add(ancestor);
        return normalizeUploadPath(path);
    }
}

/** 一个文件的帧头（4 字节长度加 JSON）；`size` 必须是非负的安全整数。 */
export function encodeFrameHeader(path: string, size: number): Uint8Array {
    if (!Number.isSafeInteger(size) || size < 0) throw new RangeError(`size 要是非负整数：${String(size)}`);
    const json = encoder.encode(JSON.stringify({path, size}));
    if (json.length > MAX_HEADER_BYTES) throw new UploadError("upload-path-invalid", "路径太长，帧头放不下");
    const header = new Uint8Array(4 + json.length);
    new DataView(header.buffer).setUint32(0, json.length);
    header.set(json, 4);
    return header;
}

/** 帧头加内容占的字节数：页面与服务端用同一个算法数总量。 */
export function frameBytes(path: string, size: number): number {
    return encodeFrameHeader(path, size).length + size;
}

/** 接收端交给 `readUploadStream` 的落盘口：每个文件开一个。 */
export interface UploadFileSink {
    write(chunk: Uint8Array): Promise<void>;
    /** 这个文件的内容收齐了。 */
    end(): Promise<void>;
    /** 上传中途失败，丢掉没写完的这个文件。 */
    abort(): Promise<void>;
}

export interface ReadUploadOptions {
    readonly limits?: UploadLimits;
    /** 帧头通过检查之后、读内容之前调用；`path` 已是 NFC 形式。 */
    open(path: string, size: number): Promise<UploadFileSink>;
    /** 中止：取消读流（正在等数据的读立即结束，调用方按自己的原因报失败）。 */
    readonly signal?: AbortSignal;
}

/**
 * 逐帧读完一个请求体：每个文件的内容边读边交给落盘口（等写完再读下一块，背压由流自己带），不整份放进内存。任何不合规都抛
 * `UploadError` 并取消读流；已经交给落盘口的文件由调用方清理（整个上传目录一起删）。交回文件数与总字节数（含帧头）。
 */
export async function readUploadStream(body: ReadableStream<Uint8Array>, options: ReadUploadOptions): Promise<{readonly files: number; readonly bytes: number}> {
    const limits = options.limits ?? UPLOAD_LIMITS;
    const reader = body.getReader();
    // 不等对方：它不再发数据、也不断开时，取消可能一直不完成；读到的结束会让下面按“在一帧中间结束”失败，调用方知道自己中止过。
    const cancelRead = (): void => void reader.cancel().catch(() => undefined);
    if (options.signal?.aborted === true) cancelRead();
    else options.signal?.addEventListener("abort", cancelRead, {once: true});
    const paths = new UploadPathSet();
    let files = 0;
    let total = 0;
    let sink: UploadFileSink | null = null;
    /** 当前帧的阶段与已收集的头部字节。 */
    let phase: "length" | "header" | "content" = "length";
    let collected = new Uint8Array(4);
    let have = 0;
    let remaining = 0;

    const addTotal = (bytes: number): void => {
        total += bytes;
        if (total > limits.maxTotalBytes) throw new UploadError("upload-too-large", `上传超过 ${String(limits.maxTotalBytes)} 字节`);
    };

    /** 帧头通过检查、落盘口开好之后，下一个阶段：有内容读内容，没有内容直接收齐、回到下一帧的长度。 */
    const startFile = async (headerBytes: Uint8Array): Promise<"length" | "content"> => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(decoder.decode(headerBytes));
        } catch {
            throw new UploadError("upload-malformed", "帧头不是合法的 JSON");
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new UploadError("upload-malformed", "帧头不是对象");
        const record = parsed as Record<string, unknown>;
        const keys = Object.keys(record);
        if (keys.length !== 2 || !("path" in record) || !("size" in record)) throw new UploadError("upload-malformed", "帧头只能有 path 与 size");
        const {path, size} = record;
        if (typeof path !== "string" || typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new UploadError("upload-malformed", "帧头的 path 要是字符串、size 要是非负整数");
        if (size > limits.maxFileBytes) throw new UploadError("upload-too-large", `${path} 超过单个文件的上限 ${String(limits.maxFileBytes)} 字节`);
        files += 1;
        if (files > limits.maxFiles) throw new UploadError("upload-too-large", `文件超过 ${String(limits.maxFiles)} 个`);
        const normalized = paths.add(path);
        // 帧头与内容的字节数在读内容之前就计入总量：声明的 size 超了就立即停，不等读到。
        addTotal(4 + headerBytes.length + size);
        sink = await options.open(normalized, size);
        remaining = size;
        if (size > 0) return "content";
        await sink.end();
        sink = null;
        return "length";
    };

    try {
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            let offset = 0;
            while (offset < value.length) {
                if (phase === "content") {
                    const take = Math.min(remaining, value.length - offset);
                    await sink!.write(value.subarray(offset, offset + take));
                    offset += take;
                    remaining -= take;
                    if (remaining === 0) {
                        await sink!.end();
                        sink = null;
                        phase = "length";
                        have = 0;
                        collected = new Uint8Array(4);
                    }
                    continue;
                }
                const need = collected.length - have;
                const take = Math.min(need, value.length - offset);
                collected.set(value.subarray(offset, offset + take), have);
                have += take;
                offset += take;
                if (have < collected.length) continue;
                if (phase === "length") {
                    const length = new DataView(collected.buffer).getUint32(0);
                    if (length < 1 || length > MAX_HEADER_BYTES) throw new UploadError("upload-malformed", `帧头长度不对：${String(length)}`);
                    phase = "header";
                    collected = new Uint8Array(length);
                    have = 0;
                } else {
                    phase = await startFile(collected);
                    if (phase === "length") {
                        have = 0;
                        collected = new Uint8Array(4);
                    }
                }
            }
        }
        if (phase !== "length" || have !== 0) throw new UploadError("upload-malformed", "请求体在一帧中间结束");
        if (files === 0) throw new UploadError("upload-malformed", "请求体是空的");
        return {files, bytes: total};
    } catch (error) {
        cancelRead();
        if (sink !== null) await (sink as UploadFileSink).abort().catch(() => undefined);
        throw error;
    } finally {
        options.signal?.removeEventListener("abort", cancelRead);
    }
}
