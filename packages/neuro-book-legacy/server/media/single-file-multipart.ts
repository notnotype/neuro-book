import Busboy from "busboy";
import type {IncomingMessage} from "node:http";

export type SingleMultipartFile = Readonly<{
    bytes: Uint8Array;
    /** 请求未声明 MIME 时为空；调用方必须以内容识别为真相源。 */
    mimeType?: string;
    name: string;
}>;

export type SingleFileMultipartErrorCode = "INVALID_MULTIPART" | "FILE_TOO_LARGE" | "REQUEST_ABORTED";

/** 严格单文件 multipart 解析错误；业务路由负责映射自己的公开错误码。 */
export class SingleFileMultipartError extends Error {
    /** 建立稳定解析错误。 */
    constructor(readonly code: SingleFileMultipartErrorCode) {
        super(code === "FILE_TOO_LARGE"
            ? "上传文件超过大小限制"
            : code === "REQUEST_ABORTED"
                ? "上传请求已中止"
                : "multipart 必须且只能包含一个 file");
        this.name = "SingleFileMultipartError";
    }
}

/**
 * 流式接收一个指定字段的 multipart 文件，并在读取过程中执行真实 bytes 上限。
 *
 * Busboy 是事件 API，Promise 只封装一次 parser 生命周期；业务路由不再复制 part 限制。
 */
export async function readSingleMultipartFile(
    request: IncomingMessage,
    options: {readonly fieldName: string; readonly maxBytes: number},
): Promise<SingleMultipartFile> {
    return new Promise<SingleMultipartFile>((resolve, reject) => {
        let parser: ReturnType<typeof Busboy>;
        try {
            parser = Busboy({
                headers: request.headers,
                limits: {
                    files: 1,
                    fields: 0,
                    // 达到阈值会发 limit；多放行 1 byte 才能区分精确上限与真正超限。
                    fileSize: options.maxBytes + 1,
                    // 唯一合法 file 是第一个 part；第二个 part 触发 partsLimit。
                    parts: 2,
                },
            });
        } catch {
            reject(new SingleFileMultipartError("INVALID_MULTIPART"));
            return;
        }

        let fileSeen = false;
        let invalid = false;
        let limitExceeded = false;
        let fileName = "";
        let mimeType = "";
        let size = 0;
        const chunks: Buffer[] = [];

        parser.on("file", (fieldName, stream, info) => {
            if (fileSeen || fieldName !== options.fieldName || !info.filename) {
                invalid = true;
                stream.resume();
                return;
            }
            fileSeen = true;
            fileName = info.filename;
            mimeType = info.mimeType;
            stream.on("limit", () => {
                limitExceeded = true;
            });
            stream.on("data", (chunk: Buffer) => {
                size += chunk.byteLength;
                if (size <= options.maxBytes) {
                    chunks.push(chunk);
                }
            });
            stream.on("error", reject);
        });
        parser.on("field", () => invalid = true);
        parser.on("filesLimit", () => invalid = true);
        parser.on("fieldsLimit", () => invalid = true);
        parser.on("partsLimit", () => invalid = true);
        parser.on("error", () => reject(new SingleFileMultipartError("INVALID_MULTIPART")));
        parser.on("finish", () => {
            if (limitExceeded || size > options.maxBytes) {
                reject(new SingleFileMultipartError("FILE_TOO_LARGE"));
                return;
            }
            if (invalid || !fileSeen || size === 0 || !fileName) {
                reject(new SingleFileMultipartError("INVALID_MULTIPART"));
                return;
            }
            resolve(Object.freeze({
                bytes: Buffer.concat(chunks, size),
                ...(mimeType ? {mimeType} : {}),
                name: fileName,
            }));
        });
        request.once("aborted", () => reject(new SingleFileMultipartError("REQUEST_ABORTED")));
        request.pipe(parser);
    });
}
