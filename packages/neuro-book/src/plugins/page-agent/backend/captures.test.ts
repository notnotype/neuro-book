/**
 * 截图的上传凭证与路由（docs/specs/agent/page-agent.md 输出 8 与“状态与转换”的截图状态）：真实的 Hono 路由（`routes.request`）
 * 与手动时钟；图是真实的 JPEG（`testing/images.ts`）。
 */

import {describe, expect, it} from "bun:test";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {CAPTURE_MAX_BYTES, CAPTURE_TOKEN_HEADER} from "../shared/contracts";
import {JPEG_1281X8, JPEG_64X40} from "../testing/images";
import {CAPTURE_TOKEN_MS, createCaptureStore, jpegSize} from "./captures";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function setup() {
    const clock = new ManualClock();
    const reports: string[] = [];
    const store = createCaptureStore(clock, (message) => reports.push(message));
    const put = async (token: string | null, body?: NonNullable<RequestInit["body"]>, headers: Record<string, string> = {}): Promise<Response> => store.routes.request(new Request("http://127.0.0.1/captures", {
        method: "PUT",
        ...(body === undefined ? {} : {body}),
        headers: {...(token === null ? {} : {[CAPTURE_TOKEN_HEADER]: token}), "content-type": "image/jpeg", ...headers},
        ...(body instanceof ReadableStream ? {duplex: "half"} : {}),
    } as RequestInit));
    return {clock, store, reports, put};
}

const live = () => new AbortController().signal;

/** 先给一块、再挂着不给的上传正文：`reading` 在路由要第二块时 resolve，`cancelled` 记读取有没有被取消。 */
function stalledBody(first: Uint8Array, then: "hang" | "error") {
    let reading = (): void => undefined;
    const started = new Promise<void>((resolve) => {
        reading = resolve;
    });
    const state = {cancelled: false};
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull: (controller) => {
            pulls += 1;
            if (pulls === 1) {
                controller.enqueue(first);
                return;
            }
            reading();
            if (then === "error") controller.error(new Error("连接断了"));
            return new Promise<void>(() => undefined);
        },
        cancel: () => {
            state.cancelled = true;
        },
    });
    return {stream, started, state};
}

describe("JPEG 的尺寸", () => {
    it("读基线与渐进式的帧头；不是 JPEG、帧头之前就截断的为 null", () => {
        expect(jpegSize(JPEG_64X40)).toEqual({width: 64, height: 40});
        expect(jpegSize(JPEG_1281X8)).toEqual({width: 1281, height: 8});
        expect(jpegSize(PNG)).toBeNull();
        expect(jpegSize(JPEG_64X40.subarray(0, 100))).toBeNull();
    });
});

describe("上传凭证（截图状态）", () => {
    it("收到合格的图：204，取得到原样的字节与文件头里的尺寸；同一凭证再传得 410；作废后取不到", async () => {
        const {store, put} = setup();
        const slot = store.issue(live());
        expect(slot.take()).toBeNull();
        expect((await put(slot.token, JPEG_64X40)).status).toBe(204);
        expect(slot.take()).toEqual({bytes: JPEG_64X40, width: 64, height: 40});
        expect((await put(slot.token, JPEG_64X40)).status).toBe(410);
        slot.discard();
        expect(slot.take()).toBeNull();
    });

    it("没带凭证、不认识的凭证得 410；别的网页来的得 403 且不占用凭证；没有正文得 400 并作废凭证", async () => {
        const {store, put} = setup();
        const slot = store.issue(live());
        expect((await put(null, JPEG_64X40)).status).toBe(410);
        expect((await put("x".repeat(32), JPEG_64X40)).status).toBe(410);
        expect((await put(slot.token, JPEG_64X40, {"sec-fetch-site": "cross-site"})).status).toBe(403);
        expect((await put(slot.token, JPEG_64X40, {"sec-fetch-site": "same-origin"})).status).toBe(204);

        const empty = store.issue(live());
        expect((await put(empty.token)).status).toBe(400);
        expect((await put(empty.token, JPEG_64X40)).status).toBe(410);
    });

    it("超过 512 KB 得 413；不是 JPEG、长边超过 1280 得 422；都作废凭证、取不到图", async () => {
        const {store, put} = setup();
        const huge = new Uint8Array(CAPTURE_MAX_BYTES + 1);
        huge.set(JPEG_64X40);
        for (const [body, status] of [[huge, 413], [PNG, 422], [JPEG_1281X8, 422]] as const) {
            const slot = store.issue(live());
            expect((await put(slot.token, body)).status).toBe(status);
            expect(slot.take()).toBeNull();
            expect((await put(slot.token, JPEG_64X40)).status).toBe(410);
        }
        // 正好 512 KB 的收下（尺寸读文件头，后面的零不影响）。
        const exact = new Uint8Array(CAPTURE_MAX_BYTES);
        exact.set(JPEG_64X40);
        expect((await put(store.issue(live()).token, exact)).status).toBe(204);
    });

    it("凭证 20 秒到期；调用结束（含签发时就已结束）与插件停止都作废凭证与收到的图", async () => {
        const {clock, store, put} = setup();
        const early = store.issue(live());
        const late = store.issue(live());
        clock.advance(CAPTURE_TOKEN_MS - 1);
        expect((await put(early.token, JPEG_64X40)).status).toBe(204);
        clock.advance(1);
        expect((await put(late.token, JPEG_64X40)).status).toBe(410);
        // 到期也作废已经收到的图。
        expect(early.take()).toBeNull();

        const call = new AbortController();
        const ended = store.issue(call.signal);
        call.abort();
        expect((await put(ended.token, JPEG_64X40)).status).toBe(410);
        const done = new AbortController();
        done.abort();
        expect((await put(store.issue(done.signal).token, JPEG_64X40)).status).toBe(410);

        const kept = store.issue(live());
        const waiting = store.issue(live());
        expect((await put(kept.token, JPEG_64X40)).status).toBe(204);
        store.dispose();
        expect(kept.take()).toBeNull();
        expect((await put(waiting.token, JPEG_64X40)).status).toBe(410);
    });

    it("正在读的上传：同一凭证的第二笔得 410；作废时取消读取，那一笔得 410，不记诊断", async () => {
        const {store, reports, put} = setup();
        const slot = store.issue(live());
        const body = stalledBody(JPEG_64X40.subarray(0, 64), "hang");
        const first = put(slot.token, body.stream);
        await body.started;
        expect((await put(slot.token, JPEG_64X40)).status).toBe(410);
        slot.discard();
        expect((await first).status).toBe(410);
        await waitUntil("读取被取消", () => body.state.cancelled);
        expect(reports).toEqual([]);
    });

    it("读到一半连接断了：410、凭证作废，记一条诊断", async () => {
        const {store, reports, put} = setup();
        const slot = store.issue(live());
        const body = stalledBody(JPEG_64X40.subarray(0, 64), "error");
        expect((await put(slot.token, body.stream)).status).toBe(410);
        expect(reports).toHaveLength(1);
        expect(reports[0]).toContain("连接断了");
        expect((await put(slot.token, JPEG_64X40)).status).toBe(410);
    });
});
