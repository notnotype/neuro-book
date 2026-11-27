/**
 * 截图的上传凭证与路由（docs/specs/agent/page-agent.md 输出 8 与“状态与转换”的截图状态）：
 * 签发上传凭证 → 收到图 → 窗口回报截图成功（图进结果）。任何一步失败、调用结束、凭证到期或插件停止，凭证与收到的图一起作废。
 *
 * - 凭证是高熵的不透明串，只经这次远程调用交给选中的窗口；它放在请求头里，不进路径，也就不进 HTTP 诊断。
 * - 第一笔 PUT 在第一个 `await` 之前占住凭证：同一凭证的第二笔得 410，不会两笔一起读。
 * - 作废时取消正在读的正文：到期、调用结束、插件停止都不必等上传读完。
 * - 收完整、核对过是 JPEG 且尺寸在上限内才算收到；尺寸以文件头为准，不信窗口自己报的。
 */

import {Hono} from "hono";

import {rethrowRouteError} from "@notnotype/nb-host/http/contracts";
import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {sniffImageType} from "nbook/shared/image-type";

import {CAPTURE_MAX_BYTES, CAPTURE_MAX_EDGE, CAPTURE_TOKEN_HEADER} from "../shared/contracts";

/** 凭证的寿命（截图状态表）。 */
export const CAPTURE_TOKEN_MS = 20_000;

export interface ReceivedImage {
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
}

export interface CaptureSlot {
    readonly token: string;
    /** 此刻收到的图；还没收到、已经作废时为 null。 */
    take(): ReceivedImage | null;
    /** 作废：调用结束时一定调用（成功取走之后也调用，释放暂存）。 */
    discard(): void;
}

export interface CaptureStore {
    /** 签发一个凭证；`signal` 触发（调用结束）时自动作废。 */
    issue(signal: AbortSignal): CaptureSlot;
    readonly routes: Hono<{Bindings: HttpRouteEnv}>;
    /** 插件停止：作废全部凭证，取消正在读的上传。 */
    dispose(): void;
}

type SlotState =
    | {readonly kind: "issued"}
    | {readonly kind: "receiving"; readonly cancel: () => Promise<void>}
    | {readonly kind: "received"; readonly image: ReceivedImage}
    | {readonly kind: "void"};

interface Slot {
    state: SlotState;
    readonly cancelTimer: () => void;
}

function newToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Buffer.from(bytes).toString("base64url");
}

/** JPEG 的宽高：读第一个 SOF 段；不是合格的 JPEG 时为 null。 */
export function jpegSize(bytes: Uint8Array): {readonly width: number; readonly height: number} | null {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1]!;
        // 填充字节与不带长度的段（RST、SOI、TEM）。
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
            offset += 2;
            continue;
        }
        const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isFrame) {
            const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
            const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
            return width > 0 && height > 0 ? {width, height} : null;
        }
        const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
        if (length < 2) return null;
        offset += 2 + length;
    }
    return null;
}

/** 只放行本源发出的请求（同 `nbook.files` 的上传）：不带这个头的交给宿主的 `Origin` 核对。 */
function crossSite(request: Request): boolean {
    const site = request.headers.get("sec-fetch-site");
    return site !== null && site !== "same-origin";
}

/** `report`：读上传时出了不是作废引起的错（例如连接断了），记一条诊断。 */
export function createCaptureStore(clock: RuntimeClock, report: (message: string) => void): CaptureStore {
    const slots = new Map<string, Slot>();

    const discard = (token: string): void => {
        const slot = slots.get(token);
        if (slot === undefined) return;
        slots.delete(token);
        slot.cancelTimer();
        const previous = slot.state;
        slot.state = {kind: "void"};
        // 正在读的上传：取消读取，路由那边的循环随之结束并回 410。
        if (previous.kind === "receiving") {
            previous.cancel().catch((error: unknown) => report(`取消截图上传时出错：${error instanceof Error ? error.message : String(error)}`));
        }
    };

    const routes = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError).put("/captures", async (c) => {
        if (crossSite(c.req.raw)) return c.json({error: {code: "cross-site", message: "不接受别的网页上传截图"}}, 403);
        const token = c.req.header(CAPTURE_TOKEN_HEADER);
        const slot = token === undefined ? undefined : slots.get(token);
        if (token === undefined || slot === undefined || slot.state.kind !== "issued") return c.json({error: {code: "gone", message: "截图凭证无效或已用过"}}, 410);
        const reader = c.req.raw.body?.getReader();
        if (reader === undefined) {
            discard(token);
            return c.json({error: {code: "empty", message: "没有图"}}, 400);
        }
        // 在第一个 await 之前占住凭证：并发的第二笔看到的已经不是 issued。
        slot.state = {kind: "receiving", cancel: () => reader.cancel()};
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
            for (;;) {
                const {done, value} = await reader.read();
                if (slot.state.kind !== "receiving") return c.json({error: {code: "gone", message: "截图凭证已作废"}}, 410);
                if (done) break;
                total += value.byteLength;
                if (total > CAPTURE_MAX_BYTES) {
                    discard(token);
                    return c.json({error: {code: "too-large", message: `截图超过 ${String(CAPTURE_MAX_BYTES)} 字节`}}, 413);
                }
                chunks.push(value);
            }
        } catch (error) {
            // 作废时取消读取也会走到这里，那是预期的；还在读的时候出错（连接断了）才记下来。凭证一并作废；读取已经失败，
            // 先改掉状态，作废时就不再去取消它。
            if (slot.state.kind === "receiving") {
                report(`读截图上传时出错：${error instanceof Error ? error.message : String(error)}`);
                slot.state = {kind: "void"};
            }
            discard(token);
            return c.json({error: {code: "gone", message: "上传没有读完"}}, 410);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const size = sniffImageType(bytes) === "image/jpeg" ? jpegSize(bytes) : null;
        if (size === null || size.width > CAPTURE_MAX_EDGE || size.height > CAPTURE_MAX_EDGE) {
            discard(token);
            return c.json({error: {code: "invalid-image", message: `截图要是长边至多 ${String(CAPTURE_MAX_EDGE)} 像素的 JPEG`}}, 422);
        }
        slot.state = {kind: "received", image: {bytes, ...size}};
        return c.body(null, 204);
    });

    return {
        issue: (signal) => {
            const token = newToken();
            const cancelTimer = clock.schedule(() => discard(token), CAPTURE_TOKEN_MS);
            slots.set(token, {state: {kind: "issued"}, cancelTimer});
            if (signal.aborted) discard(token);
            else signal.addEventListener("abort", () => discard(token), {once: true});
            return {
                token,
                take: () => {
                    const slot = slots.get(token);
                    return slot !== undefined && slot.state.kind === "received" ? slot.state.image : null;
                },
                discard: () => discard(token),
            };
        },
        routes,
        dispose: () => {
            for (const token of [...slots.keys()]) discard(token);
        },
    };
}
