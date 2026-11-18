/**
 * 加图的队列（docs/specs/agent/stickers.md 输出 29）：同时至多 3 张、结果逐张交回、文件夹跳过、发送失败变成失败结果。
 */

import {describe, expect, test} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {UploadQueue} from "./upload-queue";
import type {UploadItem, UploadResponse} from "./upload-queue";

const image = (name: string): File => new File([new Uint8Array([1, 2, 3])], name, {type: "image/png"});

/** 一个可手动放行的发送：每次发送挂起，直到测试 `settle` 它。 */
function gatedSend() {
    const pending: Array<{packId: string; name: string; settle: (response: UploadResponse) => void; fail: () => void}> = [];
    return {
        pending,
        send: (packId: string, file: File) => new Promise<UploadResponse>((resolve, reject) => {
            pending.push({packId, name: file.name, settle: resolve, fail: () => reject(new Error("断了"))});
        }),
    };
}
const ok = (file: string): UploadResponse => ({ok: true, file, resized: false});

describe("加图队列", () => {
    test("同时至多 3 张在传，前面的做完后面的才开始；结果按加入的顺序交回", async () => {
        const gate = gatedSend();
        const changes: UploadItem[][] = [];
        const queue = new UploadQueue({limit: 3, send: gate.send, onChange: (items) => changes.push([...items])});
        const done = queue.add("user.cat", ["a", "b", "c", "d", "e"].map((name) => image(`${name}.png`)));
        expect(gate.pending.map((task) => task.name)).toEqual(["a.png", "b.png", "c.png"]);
        expect(changes.at(-1)?.map((item) => item.state)).toEqual(["running", "running", "running", "waiting", "waiting"]);
        gate.pending[1]!.settle(ok("b.png"));
        await waitUntil("d 开始", () => (gate.pending.length === 4 ? true : null));
        expect(gate.pending.map((task) => task.name)).toEqual(["a.png", "b.png", "c.png", "d.png"]);
        gate.pending[0]!.settle(ok("a.png"));
        gate.pending[2]!.settle(ok("c.png"));
        gate.pending[3]!.settle(ok("d.png"));
        await waitUntil("e 开始", () => (gate.pending.length === 5 ? true : null));
        gate.pending[4]!.settle(ok("e.png"));
        const outcomes = await done;
        expect(outcomes.map((outcome) => outcome.name)).toEqual(["a.png", "b.png", "c.png", "d.png", "e.png"]);
        expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
        expect(changes.at(-1)).toEqual([]);
    });

    test("发送抛错变成 unavailable 的失败结果，别的照常；拖进来的文件夹跳过", async () => {
        const gate = gatedSend();
        const queue = new UploadQueue({limit: 3, send: gate.send, onChange: () => undefined});
        const folder = new File([], "相册", {type: ""});
        const done = queue.add("user.cat", [image("a.png"), folder, image("b.png")]);
        gate.pending[0]!.fail();
        gate.pending[1]!.settle({ok: false, code: "image-rejected", reason: "type-mismatch"});
        const outcomes = await done;
        expect(outcomes).toEqual([
            {name: "a.png", ok: false, code: "unavailable"},
            {name: "相册", ok: false, code: "image-rejected", reason: "folder"},
            {name: "b.png", ok: false, code: "image-rejected", reason: "type-mismatch"},
        ]);
    });

    test("几次添加共用同一个并发上限", async () => {
        const gate = gatedSend();
        const queue = new UploadQueue({limit: 2, send: gate.send, onChange: () => undefined});
        const first = queue.add("user.a", [image("1.png"), image("2.png")]);
        const second = queue.add("user.b", [image("3.png")]);
        expect(gate.pending.map((task) => task.name)).toEqual(["1.png", "2.png"]);
        gate.pending[0]!.settle(ok("1.png"));
        gate.pending[1]!.settle(ok("2.png"));
        await first;
        expect(gate.pending.map((task) => `${task.packId}:${task.name}`)).toEqual(["user.a:1.png", "user.a:2.png", "user.b:3.png"]);
        gate.pending[2]!.settle(ok("3.png"));
        expect((await second).map((outcome) => outcome.name)).toEqual(["3.png"]);
    });
});
