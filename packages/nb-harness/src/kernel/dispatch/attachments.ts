/**
 * 用户附件进请求的最后一步（docs/specs/harness/runtime.md 输出 82–84）。请求里一路都是引用（`imageRef`），只有真发给模型前才读字节：
 * 提交缓存与拦截层不持有图片内容，历史再长内存也不涨。
 */

import type {AttachmentPort, AttachmentRead, ModelRequest, RequestBlock} from "../api/index.js";
import type {DiagnosticInput} from "./diagnostics.js";

/** 一次请求最多带几张图。超了从最旧的起换成一行字：第一版一个固定值，不按服务商分。 */
export const MAX_REQUEST_IMAGES = 100;
/** 读出来的图留多少字节（base64 的长度）：一轮一轮都要带，每次读盘加缩放太慢；附件按内容寻址，不会变。 */
const CACHE_LIMIT = 64 * 1024 * 1024;

const isImage = (block: RequestBlock): boolean => block.kind === "image" || block.kind === "imageRef";
const dropped = (block: RequestBlock): RequestBlock => ({kind: "text", text: "[图片：这次请求的图太多，最早的这张没有发送]", origin: block.origin});

/** 数全部图片，超过上限时从最旧的起换成一行字。不改原对象：提交缓存里的消息是冻结的。 */
export function limitImages(request: ModelRequest, limit = MAX_REQUEST_IMAGES): ModelRequest {
    let images = 0;
    for (const message of request.messages) for (const block of message.content) if (isImage(block)) images += 1;
    let excess = images - limit;
    if (excess <= 0) return request;
    const messages = request.messages.map((message) => {
        if (excess <= 0 || !message.content.some(isImage)) return message;
        const content = message.content.map((block) => {
            if (excess <= 0 || !isImage(block)) return block;
            excess -= 1;
            return dropped(block);
        });
        return {...message, content};
    });
    return {...request, messages};
}

export interface AttachmentResolver {
    /** 把请求里的引用换成图片；读不到的换一行字。不抛错：发不了一张图不该让整轮失败。 */
    resolve(request: ModelRequest, signal: AbortSignal): Promise<ModelRequest>;
    clear(): void;
}

export function createAttachmentResolver(port: AttachmentPort | undefined, report: (input: DiagnosticInput) => void): AttachmentResolver {
    const cache = new Map<string, Extract<AttachmentRead, {data: string}>>();
    const reading = new Map<string, Promise<AttachmentRead>>();
    let cached = 0;

    const remember = (uri: string, image: Extract<AttachmentRead, {data: string}>): void => {
        if (image.data.length > CACHE_LIMIT) return;
        cache.set(uri, image);
        cached += image.data.length;
        for (const [key, value] of cache) {
            if (cached <= CACHE_LIMIT) break;
            cache.delete(key);
            cached -= value.data.length;
        }
    };

    /**
     * 同一地址的并发读共用一次。不把调用方的信号交给共用的读：一个请求中止不该让别的请求也失败；中止时这个请求自己不等了，
     * 读完的结果还能进缓存。
     */
    const read = (uri: string, signal: AbortSignal): Promise<AttachmentRead> => {
        const hit = cache.get(uri);
        if (hit !== undefined) {
            // 读过的挪到最后：先丢的是最久没用的。
            cache.delete(uri);
            cache.set(uri, hit);
            return Promise.resolve(hit);
        }
        let shared = reading.get(uri);
        if (shared === undefined) {
            shared = (port as AttachmentPort).read(uri, {signal: new AbortController().signal}).then((result) => {
                if ("data" in result) remember(uri, result);
                return result;
            }).finally(() => reading.delete(uri));
            reading.set(uri, shared);
        }
        const pending = shared;
        if (signal.aborted) return Promise.resolve({unusable: "aborted"});
        return new Promise((resolve, reject) => {
            const onAbort = (): void => resolve({unusable: "aborted"});
            signal.addEventListener("abort", onAbort, {once: true});
            pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
        });
    };

    const placeholder = (block: Extract<RequestBlock, {kind: "imageRef"}>, why: string): RequestBlock => ({kind: "text", text: `[图片 ${block.uri}：${why}]`, origin: block.origin});

    return {
        async resolve(request, signal) {
            const refs = request.messages.flatMap((message) => message.content.filter((block) => block.kind === "imageRef"));
            if (refs.length === 0) return request;
            const results = new Map<string, AttachmentRead>();
            await Promise.all([...new Set(refs.map((block) => block.uri))].map(async (uri) => {
                if (port === undefined) {
                    results.set(uri, {missing: true});
                    return;
                }
                try {
                    results.set(uri, await read(uri, signal));
                } catch (error) {
                    results.set(uri, {unusable: error instanceof Error ? error.message : String(error)});
                }
            }));
            for (const [uri, result] of results) {
                if ("data" in result || ("unusable" in result && result.unusable === "aborted")) continue;
                report({code: "attachment-unreadable", params: {uri}, message: "missing" in result ? `the attachment ${uri} is missing` : `the attachment ${uri} cannot be sent: ${result.unusable}`});
            }
            const messages = request.messages.map((message) => {
                if (!message.content.some((block) => block.kind === "imageRef")) return message;
                const content = message.content.map((block): RequestBlock => {
                    if (block.kind !== "imageRef") return block;
                    const result = results.get(block.uri)!;
                    if ("data" in result) return {kind: "image", data: result.data, mime: result.mime, ...(result.width === undefined ? {} : {width: result.width}), ...(result.height === undefined ? {} : {height: result.height}), origin: block.origin};
                    return placeholder(block, "missing" in result ? "读不到了" : "发不了");
                });
                return {...message, content};
            });
            return {...request, messages};
        },
        clear() {
            cache.clear();
            cached = 0;
        },
    };
}
