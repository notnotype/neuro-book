/**
 * 插件文件夹的上传暂存区（uploads.ts，plugin-install 输出 11）：真实的文件系统与真实的 `ReadableStream`；时钟是手动的。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {encodeFrameHeader, UploadError} from "nbook/plugin-platform/shared/plugin-upload";
import type {UploadErrorCode} from "nbook/plugin-platform/shared/plugin-upload";

import {createPluginUploads, UploadServerError} from "./uploads";
import type {PluginUploadsOptions} from "./uploads";

let tmp = "";
let cases = 0;
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-uploads", "上传暂存区");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const encoder = new TextEncoder();

function frames(files: Record<string, string>): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const [path, content] of Object.entries(files)) {
        const bytes = encoder.encode(content);
        parts.push(encodeFrameHeader(path, bytes.length), bytes);
    }
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** 一次给完（按 7 字节切块，让帧跨块）的请求体。 */
function body(bytes: Uint8Array): ReadableStream<Uint8Array> {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset >= bytes.length) return controller.close();
            controller.enqueue(bytes.slice(offset, offset + 7));
            offset += 7;
        },
    });
}

/** 手动时钟：`advance` 往前拨，到点的计时触发。 */
function manualClock(): RuntimeClock & {advance(ms: number): void; pending(): number} {
    let now = 1_000;
    const timers = new Set<{due: number; callback: () => void}>();
    return {
        now: () => now,
        schedule(callback, ms) {
            const timer = {due: now + ms, callback};
            timers.add(timer);
            return () => void timers.delete(timer);
        },
        advance(ms) {
            now += ms;
            for (const timer of [...timers]) if (timer.due <= now && timers.delete(timer)) timer.callback();
        },
        pending: () => timers.size,
    };
}

function setup(overrides: Partial<PluginUploadsOptions> = {}) {
    cases += 1;
    const root = join(tmp, `case-${String(cases)}`, "plugin-uploads");
    const clock = manualClock();
    const records: string[] = [];
    const uploads = createPluginUploads({root, clock, record: (record) => void records.push(record.event), ...overrides});
    return {root, clock, records, uploads};
}

const listing = async (root: string): Promise<string[]> => (await readdir(root).catch(() => [])).sort();

describe("接收与使用", () => {
    it("接收一个文件夹：交回 id 与文件数、字节数；用它时拿到目录，嵌套路径与内容都在，NFC 写盘", async () => {
        const {uploads, root} = setup();
        const sent = frames({"package.json": '{"name":"x"}', "dist/index.js": "export {};\n", "资源/说明.md": "你好", "café.txt": "e"});
        const received = await uploads.receive(body(sent));
        expect(received).toMatchObject({files: 4, bytes: sent.length});
        expect(received.id).toMatch(/^[0-9a-f-]{36}$/u);
        const used = await uploads.use(received.id, async (directory) => {
            expect(directory).toBe(join(root, received.id));
            return {pkg: await readFile(join(directory, "package.json"), "utf8"), nested: await readFile(join(directory, "dist", "index.js"), "utf8"), cjk: await readFile(join(directory, "资源", "说明.md"), "utf8"), names: (await readdir(directory)).sort()};
        });
        expect(used).toEqual({ok: true, value: {pkg: '{"name":"x"}', nested: "export {};\n", cjk: "你好", names: ["café.txt", "dist", "package.json", "资源"]}});
    });

    it("不是服务端签发的 id（路径穿越的写法、空串、别的格式）：use 得到 ok=false、discard 什么也不做，碰不到文件系统", async () => {
        const {uploads, root} = setup();
        const real = await uploads.receive(body(frames({"a.txt": "1"})));
        await mkdir(join(root, "..", "plugins", "victim"), {recursive: true});
        for (const id of ["", "..", "../plugins/victim", `../${real.id}`, "/etc", "not-a-uuid", real.id.toUpperCase(), `${real.id}/..`]) {
            expect(await uploads.use(id, () => Promise.reject(new Error("不该进来")))).toEqual({ok: false});
            await uploads.discard(id);
        }
        expect((await stat(join(root, "..", "plugins", "victim"))).isDirectory()).toBe(true);
        expect(await listing(root)).toEqual([real.id]);
    });

    it("接收失败：超限、路径不合规、分帧不对都抛对应的码，已写的部分删光，不留下上传", async () => {
        const {uploads, root} = setup({limits: {maxFiles: 5, maxTotalBytes: 100, maxFileBytes: 40}});
        const cases: Array<[Uint8Array, UploadErrorCode]> = [
            [frames({"a.bin": "x".repeat(41)}), "upload-too-large"],
            [frames({"ok.txt": "1", "../evil.txt": "2"}), "upload-path-invalid"],
            [frames({"a.txt": "1", "A.txt": "2"}), "upload-path-invalid"],
            [frames({"a.txt": "hello"}).slice(0, -2), "upload-malformed"],
            [new Uint8Array(), "upload-malformed"],
        ];
        for (const [bytes, code] of cases) {
            const error = await uploads.receive(body(bytes)).catch((thrown: unknown) => thrown);
            expect(error).toBeInstanceOf(UploadError);
            expect((error as UploadError).code).toBe(code);
            expect(await listing(root)).toEqual([]);
        }
    });

    it("暂存区的根建不出来（它的上一层是个文件）：接收得到 upload-failed，不是未处理的异常", async () => {
        const {uploads, root, records} = setup();
        await writeFile(join(root, ".."), "占着位置的文件");
        const error = await uploads.receive(body(frames({"a.txt": "1"}))).catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(UploadServerError);
        expect((error as UploadServerError).code).toBe("upload-failed");
        expect(records).toContain("plugins.upload.root-failed");
        // 说明不带暂存目录的绝对路径，完整的系统错误在诊断里。
        expect((error as UploadServerError).message).not.toContain(root);
        expect(records).toContain("plugins.upload.write-failed");
    });
});

describe("删除与使用中", () => {
    it("discard 删掉目录；删不存在的也成功；之后 use 得到 ok=false", async () => {
        const {uploads, root} = setup();
        const {id} = await uploads.receive(body(frames({"a.txt": "1"})));
        await uploads.discard(id);
        await uploads.discard(id);
        expect(await listing(root)).toEqual([]);
        expect(await uploads.use(id, () => Promise.resolve(1))).toEqual({ok: false});
    });

    it("使用中收到删除：目录一直在到使用结束，结束后才删；删除之后不能再 use", async () => {
        const {uploads, root} = setup();
        const {id} = await uploads.receive(body(frames({"a.txt": "1"})));
        let release!: () => void;
        const hold = new Promise<void>((resolve) => (release = resolve));
        let entered!: () => void;
        const inside = new Promise<void>((resolve) => (entered = resolve));
        const using = uploads.use(id, async (directory) => {
            entered();
            await hold;
            return readFile(join(directory, "a.txt"), "utf8");
        });
        await inside;
        await uploads.discard(id);
        expect(await listing(root)).toEqual([id]);
        expect(await uploads.use(id, () => Promise.resolve(1))).toEqual({ok: false});
        release();
        expect(await using).toEqual({ok: true, value: "1"});
        expect(await listing(root)).toEqual([]);
    });
});

describe("个数上限与清理", () => {
    it("满了淘汰最久没被用过的可用上传；都在使用中时 upload-busy", async () => {
        const {uploads, root, clock} = setup({maxUploads: 2});
        const first = await uploads.receive(body(frames({"a.txt": "1"})));
        clock.advance(10);
        const second = await uploads.receive(body(frames({"a.txt": "2"})));
        clock.advance(10);
        // 用一下第一个：它不再是最久没被用过的。
        await uploads.use(first.id, () => Promise.resolve());
        clock.advance(10);
        const third = await uploads.receive(body(frames({"a.txt": "3"})));
        expect((await listing(root)).sort()).toEqual([first.id, third.id].sort());
        expect(await uploads.use(second.id, () => Promise.resolve())).toEqual({ok: false});

        let release!: () => void;
        const hold = new Promise<void>((resolve) => (release = resolve));
        const usingFirst = uploads.use(first.id, () => hold);
        const usingThird = uploads.use(third.id, () => hold);
        const busy = await uploads.receive(body(frames({"a.txt": "4"}))).catch((thrown: unknown) => thrown);
        expect(busy).toBeInstanceOf(UploadServerError);
        expect((busy as UploadServerError).code).toBe("upload-busy");
        release();
        await Promise.all([usingFirst, usingThird]);
    });

    it("正在接收的也占位：满了的时候新的接收被拒，而不是把没收完的淘汰掉", async () => {
        const {uploads, root} = setup({maxUploads: 1});
        let push!: (chunk: Uint8Array) => void;
        let finish!: () => void;
        const stalled = new ReadableStream<Uint8Array>({
            start(controller) {
                push = (chunk) => controller.enqueue(chunk);
                finish = () => controller.close();
            },
        });
        const receiving = uploads.receive(stalled);
        // 它的目录建好时已经占了位（占位在建目录之前）。
        await waitUntil("第一个上传开始接收", async () => (await listing(root)).length === 1);
        const busy = await uploads.receive(body(frames({"a.txt": "1"}))).catch((thrown: unknown) => thrown);
        expect((busy as UploadServerError).code).toBe("upload-busy");
        push(frames({"a.txt": "1"}));
        finish();
        expect((await receiving).files).toBe(1);
    });

    it("清扫：每 10 分钟删掉 1 小时没被用过的可用上传；使用中的不删；用过之后重新计时", async () => {
        const {uploads, root, clock} = setup();
        const idle = await uploads.receive(body(frames({"a.txt": "1"})));
        const busy = await uploads.receive(body(frames({"a.txt": "2"})));
        const touched = await uploads.receive(body(frames({"a.txt": "3"})));
        let release!: () => void;
        const hold = new Promise<void>((resolve) => (release = resolve));
        const using = uploads.use(busy.id, () => hold);
        clock.advance(50 * 60 * 1000);
        await uploads.use(touched.id, () => Promise.resolve());
        clock.advance(20 * 60 * 1000);
        // 一轮清扫一次删完所有过期的：idle 的目录没了，这一轮就做完了。
        await waitUntil("清扫删掉没被用过的", async () => !(await listing(root)).includes(idle.id));
        expect(await listing(root)).toEqual([busy.id, touched.id].sort());
        expect(await uploads.use(idle.id, () => Promise.resolve())).toEqual({ok: false});
        release();
        await using;
    });

    it("第一次接收之前清空暂存区（上一次运行的残留）；只清一次，之后接收的不会被清掉", async () => {
        const {uploads, root} = setup();
        await mkdir(join(root, "leftover-from-last-run"), {recursive: true});
        await writeFile(join(root, "leftover-from-last-run", "a.txt"), "旧的");
        const first = await uploads.receive(body(frames({"a.txt": "1"})));
        expect(await listing(root)).toEqual([first.id]);
        const second = await uploads.receive(body(frames({"a.txt": "2"})));
        expect(await listing(root)).toEqual([first.id, second.id].sort());
    });

    it("stop：撤销清扫的计时器、取消正在接收的上传（连只发了半个帧头、不再发数据的也立即结束）并等它们收尾；之后不再接纳，零字节的帧也不收", async () => {
        const {uploads, root, clock} = setup();
        await uploads.receive(body(frames({"a.txt": "1"})));
        expect(clock.pending()).toBe(1);
        const stalled = new ReadableStream<Uint8Array>({
            start(controller) {
                // 只发了帧头长度的前两个字节，之后不再发、也不断开。
                controller.enqueue(new Uint8Array([0, 0]));
            },
        });
        const receiving = uploads.receive(stalled).catch((thrown: unknown) => thrown);
        await waitUntil("停住的上传开始接收", async () => (await listing(root)).length === 2);
        await uploads.stop();
        expect(clock.pending()).toBe(0);
        const error = await receiving;
        expect(error).toBeInstanceOf(UploadServerError);
        expect((error as UploadServerError).code).toBe("upload-failed");
        expect((await listing(root)).length).toBe(1);
        // 幂等；停止之后新的接收一律拒绝，没有内容的文件（零字节的帧）也一样。
        await uploads.stop();
        for (const bytes of [frames({"b.txt": "2"}), frames({"empty.txt": ""})]) {
            expect(await uploads.receive(body(bytes)).catch((thrown: unknown) => thrown)).toBeInstanceOf(UploadServerError);
        }
        expect((await listing(root)).length).toBe(1);
    });

    it("满了的时候两个接收同时到：淘汰与占位在同一个同步段里，总数不超限（一个收下、一个 upload-busy）", async () => {
        const {uploads, root} = setup({maxUploads: 1});
        await uploads.receive(body(frames({"a.txt": "1"})));
        const settled = await Promise.allSettled([uploads.receive(body(frames({"b.txt": "2"}))), uploads.receive(body(frames({"c.txt": "3"})))]);
        expect(settled.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
        const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
        expect((rejected.reason as UploadServerError).code).toBe("upload-busy");
        expect(await listing(root)).toHaveLength(1);
    });

    // 写盘只写了一部分时不能把截断的文件当成功：用系统真实的文件大小限制（prlimit --fsize）造短写，子进程里调公开的 receive。
    it.skipIf(Bun.which("prlimit") === null)("短写：文件大小限制让写入只写进一部分，整个上传失败，不留下截断的文件", async () => {
        const script = join(tmp, "short-write.ts");
        const root = join(tmp, "short-write-root");
        await writeFile(script, `
            import {createPluginUploads} from ${JSON.stringify(join(import.meta.dir, "uploads"))};
            import {encodeFrameHeader} from ${JSON.stringify(join(import.meta.dir, "..", "shared", "plugin-upload"))};
            const content = new Uint8Array(4096).fill(7);
            const header = encodeFrameHeader("data.bin", content.length);
            const bytes = new Uint8Array(header.length + content.length);
            bytes.set(header); bytes.set(content, header.length);
            const uploads = createPluginUploads({root: ${JSON.stringify(root)}, clock: {now: () => 0, schedule: () => () => undefined}, record: () => undefined});
            const result = await uploads.receive(new Blob([bytes]).stream()).then(() => "succeeded", (error) => error.code);
            console.log(result);
            await uploads.stop();
        `);
        const child = Bun.spawn(["prlimit", "--fsize=1024:1024", process.execPath, script], {stdout: "pipe", stderr: "pipe"});
        const out = (await new Response(child.stdout).text()).trim();
        await child.exited;
        expect(out).toBe("upload-failed");
        expect(await readdir(root).catch(() => [])).toEqual([]);
    });
});
