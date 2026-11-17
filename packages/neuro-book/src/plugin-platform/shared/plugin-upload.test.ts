/**
 * 插件文件夹上传的分帧与路径规则（plugin-upload.ts，plugin-install 输出 11）：路径规则逐条、分帧在任意切块位置都读对、各种坏
 * 请求体得到对应的失败码、限额在读内容之前就生效。流用真实的 `ReadableStream`。
 */

import {describe, expect, it} from "bun:test";

import {encodeFrameHeader, frameBytes, readUploadStream, UploadError, UploadPathSet, uploadPathProblem} from "./plugin-upload";
import type {UploadFileSink} from "./plugin-upload";

const encoder = new TextEncoder();

/** 一个文件的完整帧。 */
function frame(path: string, content: string | Uint8Array): Uint8Array {
    const bytes = typeof content === "string" ? encoder.encode(content) : content;
    const header = encodeFrameHeader(path, bytes.length);
    const out = new Uint8Array(header.length + bytes.length);
    out.set(header);
    out.set(bytes, header.length);
    return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** 把字节按给定的块大小切开送出（最后一块可以短）。 */
function streamOf(bytes: Uint8Array, sizes: number[]): ReadableStream<Uint8Array> {
    let offset = 0;
    let index = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset >= bytes.length) {
                controller.close();
                return;
            }
            const size = sizes[index % sizes.length]!;
            index += 1;
            controller.enqueue(bytes.slice(offset, offset + size));
            offset += size;
        },
    });
}

/** 落盘口替身：把收到的内容按路径存在内存里，记下开、收齐、丢弃的先后。 */
function recorder() {
    const files = new Map<string, Uint8Array[]>();
    const log: string[] = [];
    return {
        files,
        log,
        open: (path: string, size: number): Promise<UploadFileSink> => {
            log.push(`open ${path} ${String(size)}`);
            const chunks: Uint8Array[] = [];
            files.set(path, chunks);
            return Promise.resolve({
                write: (chunk) => {
                    chunks.push(chunk.slice());
                    return Promise.resolve();
                },
                end: () => {
                    log.push(`end ${path}`);
                    return Promise.resolve();
                },
                abort: () => {
                    log.push(`abort ${path}`);
                    return Promise.resolve();
                },
            });
        },
        text: (path: string) => new TextDecoder().decode(concat(files.get(path) ?? [])),
    };
}

async function failure(promise: Promise<unknown>): Promise<UploadError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof UploadError) return error;
        throw error;
    }
    throw new Error("应该失败，却成功了");
}

describe("上传的路径规则", () => {
    it("合规的相对路径通过：嵌套目录、点开头的文件、中文名、带点的名字", () => {
        for (const path of ["package.json", "dist/index.js", ".npmignore", "locales/zh-CN.json", "资源/封面 图.png", "a.b.c", "a/b/c/d.txt"]) expect(uploadPathProblem(path)).toBeNull();
    });

    it("不合规的路径：空、绝对、空段、点段、反斜杠、冒号、控制字符、Windows 不合法的字符、结尾的空格与点、保留名、过长", () => {
        // COM¹ 这类上标数字的写法，Windows 也当设备名。
        for (const path of ["COM\u00b9", "LPT\u00b2.txt", "com\u00b3/a.txt"]) expect(uploadPathProblem(path)).not.toBeNull();
        // NFC 之后变长：原样 200 字节、规范化后 400 字节，超过单段上限的要在这里就拒绝，不等落盘时 ENAMETOOLONG。
        expect(uploadPathProblem("\u0344".repeat(100))).not.toBeNull();
        const bad = ["", "/a", "a//b", "a/", "./a", "a/./b", "../a", "a/..", "a\\b", "C:/a", "a:b", "a\u0000b", "a\tb", "a<b", "a>b", 'a"b', "a|b", "a?b", "a*b", "a ", "a.", "dir /a", "CON", "con", "nul.txt", "a/PRN.md", "COM1", "lpt9.x", "a".repeat(256), `${"a/".repeat(600)}a`, "\ud800"];
        for (const path of bad) expect(uploadPathProblem(path)).not.toBeNull();
        expect(uploadPathProblem("com10")).toBeNull();
        expect(uploadPathProblem("console.log")).toBeNull();
    });

    it("同一次上传里：只差大小写或归一化形式的两条路径、文件与目录同名都不合规；写盘用 NFC", () => {
        const set = new UploadPathSet();
        expect(set.add("Dist/Index.js")).toBe("Dist/Index.js");
        expect(() => set.add("dist/index.js")).toThrow(UploadError);
        expect(() => set.add("Dist")).toThrow(UploadError);
        expect(() => set.add("Dist/Index.js/x")).toThrow(UploadError);
        expect(set.add("Dist/other.js")).toBe("Dist/other.js");
        // “é”的两种写法（预组合与分解）是同一个名字；写盘是预组合的 NFC。
        expect(set.add("caf\u00e9.txt")).toBe("caf\u00e9.txt");
        expect(() => set.add("cafe\u0301.txt")).toThrow(UploadError);
        // 土耳其文的无点 ı、希腊文的词尾 ς：只做小写比较会漏掉，大写再小写才撞上。
        const turkish = new UploadPathSet();
        turkish.add("ΣΑΣ.txt");
        expect(() => turkish.add("σας.txt")).toThrow(UploadError);
        expect(() => turkish.add("σασ.txt")).toThrow(UploadError);
    });
});

describe("分帧的读取", () => {
    const sample = concat([frame("package.json", '{"name":"x"}'), frame("dist/index.js", "console.log(1);\n".repeat(50)), frame("empty.txt", ""), frame("资源/说明.md", "你好")]);

    it("在任意切块位置都读对：一次给完、逐字节、各种块大小", async () => {
        for (const sizes of [[sample.length], [1], [2], [3, 5, 7], [4], [13, 1, 29], [100]]) {
            const sink = recorder();
            const result = await readUploadStream(streamOf(sample, sizes), {open: sink.open});
            expect(result).toEqual({files: 4, bytes: sample.length});
            expect(sink.text("package.json")).toBe('{"name":"x"}');
            expect(sink.text("dist/index.js")).toBe("console.log(1);\n".repeat(50));
            expect(sink.text("empty.txt")).toBe("");
            expect(sink.text("资源/说明.md")).toBe("你好");
            expect(sink.log.filter((entry) => entry.startsWith("open "))).toHaveLength(4);
            expect(sink.log.filter((entry) => entry.startsWith("abort"))).toEqual([]);
        }
    });

    it("总字节数与页面用 frameBytes 数出来的一致", () => {
        expect(frameBytes("package.json", 12) + frameBytes("dist/index.js", 800) + frameBytes("empty.txt", 0) + frameBytes("资源/说明.md", 6)).toBe(sample.length);
    });

    it("上传的路径合规检查、写盘用 NFC：不合规的路径整个上传失败，不开落盘口", async () => {
        const sink = recorder();
        expect((await failure(readUploadStream(streamOf(frame("../evil.js", "x"), [7]), {open: sink.open}))).code).toBe("upload-path-invalid");
        expect(sink.log).toEqual([]);
        const dup = recorder();
        expect((await failure(readUploadStream(streamOf(concat([frame("A.txt", "1"), frame("a.txt", "2")]), [5]), {open: dup.open}))).code).toBe("upload-path-invalid");
        const nfc = recorder();
        await readUploadStream(streamOf(frame("cafe\u0301.txt", "1"), [9]), {open: nfc.open});
        expect(nfc.log[0]).toBe("open caf\u00e9.txt 1");
    });

    it("坏的分帧得到 upload-malformed：空请求体、帧中间结束、头长度为 0 或超上限、头不是 JSON、头有多余的键、size 不是非负整数", async () => {
        const open = recorder().open;
        const header = (json: string, declared = encoder.encode(json).length) => {
            const bytes = encoder.encode(json);
            const out = new Uint8Array(4 + bytes.length);
            new DataView(out.buffer).setUint32(0, declared);
            out.set(bytes, 4);
            return out;
        };
        const bads: Array<[string, Uint8Array]> = [
            ["空请求体", new Uint8Array()],
            ["长度没收齐", new Uint8Array([0, 0])],
            ["头长度为 0", new Uint8Array([0, 0, 0, 0])],
            ["头长度超上限", new Uint8Array([0, 0, 0x08, 0x01])],
            ["头没收齐", header('{"path":"a","size":1}').slice(0, 10)],
            ["内容没收齐", frame("a.txt", "hello").slice(0, -2)],
            ["头不是 JSON", header("not json")],
            ["头不是对象", header("[1,2]")],
            ["头有多余的键", header('{"path":"a","size":1,"x":1}')],
            ["头缺 size", header('{"path":"a"}')],
            ["path 不是字符串", header('{"path":1,"size":1}')],
            ["size 是负数", header('{"path":"a","size":-1}')],
            ["size 是小数", header('{"path":"a","size":1.5}')],
            ["size 是字符串", header('{"path":"a","size":"1"}')],
            ["头不是合法的 UTF-8", concat([new Uint8Array([0, 0, 0, 2, 0xff, 0xfe])])],
        ];
        for (const [name, bytes] of bads) expect([name, (await failure(readUploadStream(streamOf(bytes, [3]), {open}))).code]).toEqual([name, "upload-malformed"]);
    });

    it("限额：单个文件、总量（含帧头）、文件数；size 超限在读内容之前就失败，不开落盘口", async () => {
        const limits = {maxFiles: 3, maxTotalBytes: 200, maxFileBytes: 50};
        const sink = recorder();
        // 声明的 size 超过单个上限：只发了帧头，一个内容字节都没发。
        const declared = encodeFrameHeader("big.bin", 51);
        expect((await failure(readUploadStream(streamOf(declared, [4]), {limits, open: sink.open}))).code).toBe("upload-too-large");
        expect(sink.log).toEqual([]);

        const total = recorder();
        const frames = concat([frame("a", "x".repeat(50)), frame("b", "x".repeat(50)), frame("c", "x".repeat(50))]);
        expect(frames.length).toBeGreaterThan(200);
        expect((await failure(readUploadStream(streamOf(frames, [30]), {limits, open: total.open}))).code).toBe("upload-too-large");

        const count = recorder();
        const many = concat([frame("a", ""), frame("b", ""), frame("c", ""), frame("d", "")]);
        expect((await failure(readUploadStream(streamOf(many, [4]), {limits, open: count.open}))).code).toBe("upload-too-large");
    });

    it("落盘失败时取消读流，并让正在写的那个文件的落盘口 abort；已收齐的文件不受影响", async () => {
        let cancelled!: () => void;
        const cancelledSeen = new Promise<void>((resolve) => (cancelled = resolve));
        const bytes = concat([frame("ok.txt", "fine"), frame("cut.txt", "0123456789")]);
        let offset = 0;
        // 请求体一直有数据可读、不自己结束：只有失败时的取消能让它停。
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(offset < bytes.length ? bytes.slice(offset, (offset += 5)) : new Uint8Array(0));
            },
            cancel: () => cancelled(),
        }, {highWaterMark: 0});
        const log: string[] = [];
        const failing = readUploadStream(body, {
            open: (path) => Promise.resolve({
                write: (chunk) => (path === "cut.txt" && chunk.length > 0 ? Promise.reject(new Error("磁盘满了")) : Promise.resolve()),
                end: () => Promise.resolve(void log.push(`end ${path}`)),
                abort: () => Promise.resolve(void log.push(`abort ${path}`)),
            }),
        });
        await expect(failing).rejects.toThrow("磁盘满了");
        await cancelledSeen;
        expect(log).toEqual(["end ok.txt", "abort cut.txt"]);
    });

    it("落盘口慢：读流按它的节奏被拉动，不会一次把后面的块都读走（背压）", async () => {
        const chunkSize = 1024;
        const chunks = 40;
        const content = new Uint8Array(chunkSize * chunks);
        const bytes = frame("big.bin", content);
        let pulled = 0;
        let written = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (pulled * chunkSize >= bytes.length) {
                    controller.close();
                    return;
                }
                controller.enqueue(bytes.slice(pulled * chunkSize, (pulled + 1) * chunkSize));
                pulled += 1;
            },
        }, {highWaterMark: 0});
        let maxAhead = 0;
        await readUploadStream(body, {
            open: () => Promise.resolve({
                write: async (chunk) => {
                    await Bun.sleep(1);
                    written += chunk.length;
                    maxAhead = Math.max(maxAhead, pulled - Math.ceil((written + 4 + 40) / chunkSize));
                },
                end: () => Promise.resolve(),
                abort: () => Promise.resolve(),
            }),
        });
        expect(maxAhead).toBeLessThanOrEqual(2);
        expect(written).toBe(content.length);
    });
});
