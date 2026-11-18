/**
 * `read` 自身的行为（docs/specs/agent/builtin-tools.md 输出 5–7；测试名里的编号是它的输出条目）：分页、大文件、编码、图片与目录。
 * 文件访问用本机参考实现（过了 `SessionFiles` 的合同），地址方案与授权相关的条目留在宿主的测试里。
 */

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {deflateSync} from "node:zlib";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {ToolContext, ToolResult, ToolSessionContext} from "../../kernel/contracts.js";
import {renderVirtual} from "../files/index.js";
import type {ArtifactStore, SessionFiles, VirtualListing} from "../files/index.js";
import {localFiles} from "../files/local.js";
import {readTool} from "./read.js";
import {SessionEditStores} from "./snapshot.js";

let root = "";
let home = "";
let files: SessionFiles;
let artifacts: ArtifactStore;
const GLOBAL = "work://home";
const context = {sessionId: "s-1", profile: "p"} as ToolSessionContext;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-harness-kit", "tools-read");
    home = join(root, "work", "home");
    await mkdir(home, {recursive: true});
    ({files, artifacts} = localFiles({
        roots: {work: join(root, "work")},
        aliases: {home: GLOBAL},
        layout: {working: "home://", scratch: [], localWrites: [], shellEnv: {}, searchExcludes: () => []},
        classify: () => "allowed",
        artifacts: "work://artifacts",
    }));
});
afterEach(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

/** `nested`：当作 eval 的代码里调的（调用上下文带 `within`）。 */
async function read(args: Readonly<Record<string, unknown>>, using: SessionFiles = files, nested = false): Promise<ToolResult> {
    const call = {callId: "c-1", signal: new AbortController().signal, ...(nested ? {within: {tool: "nbook.agent.eval", invocation: "i-1"}} : {})};
    const result = await readTool(new SessionEditStores()).create(context, {files: using, artifacts}).execute(args, call as unknown as ToolContext);
    return typeof result === "string" ? {text: result} : result;
}

const numbered = (count: number): string => Array.from({length: count}, (_, index) => `第${String(index + 1)}行`).join("\n");
const headerTag = (text: string): string => /#([0-9A-F]{4})\]/u.exec(text)?.[1] ?? "";

/** 压不动的 PNG：伪随机噪声，`alpha` 时带透明通道。Bun.Image 不能从原始像素建图，这里自己组 PNG。 */
function noisePng(width: number, height: number, alpha: boolean): Uint8Array {
    const channels = alpha ? 4 : 3;
    const raw = Buffer.alloc((width * channels + 1) * height);
    let state = 12345;
    for (let index = 0; index < raw.length; index += 1) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        raw[index] = index % (width * channels + 1) === 0 ? 0 : state >> 16;
    }
    const crcTable = new Int32Array(256).map((_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c;
    });
    const crc = (bytes: Buffer): number => {
        let c = -1;
        for (const byte of bytes) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8);
        return (c ^ -1) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
        const body = Buffer.concat([Buffer.from(type), data]);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const sum = Buffer.alloc(4);
        sum.writeUInt32BE(crc(body));
        return Buffer.concat([length, body, sum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = alpha ? 6 : 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function png(width: number, height: number): Promise<Uint8Array> {
    const dot = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
    return new Bun.Image(dot).resize(width, height, {fit: "fill"}).png().bytes();
}

describe("read", () => {
    test("输出 5：头是全局地址加行锚，带行号；单数与全局写法等价；分页", async () => {
        await writeFile(join(home, "a.md"), `${numbered(3)}\n`);
        const first = await read({path: "home://a.md"});
        expect(first.status).toBeUndefined();
        expect(first.text.split("\n")[0]).toMatch(/^\[work:\/\/home\/a\.md#[0-9A-F]{4}\]$/u);
        expect(first.text).toContain("1:第1行");
        expect(first.text).toContain("3:第3行");
        expect((await read({path: `${GLOBAL}/a.md`})).text).toBe(first.text);
        const page = await read({path: "home://a.md", offset: 2, limit: 1});
        expect(page.text).toContain("2:第2行");
        expect(page.text).not.toContain("1:第1行");
        expect(page.text).toContain("offset=3");
    });

    test("输出 5：大文件分页读回，超过 4 MiB 没有行锚；长行截断", async () => {
        await writeFile(join(home, "big.md"), `${"长".repeat(2_500)}\n${Array.from({length: 400_000}, (_, index) => `line ${String(index)} ${"x".repeat(20)}`).join("\n")}\n`);
        const first = await read({path: "home://big.md", limit: 3});
        expect(first.text).toContain("本行共 2500 字符");
        expect(first.text).toContain("没有行锚");
        expect(headerTag(first.text)).toBe("");
        expect((await read({path: "home://big.md", offset: 300_000, limit: 2})).text).toContain("line 299998");
        const budget = await read({path: "home://big.md", offset: 10, limit: 2_000});
        expect(Buffer.byteLength(budget.text, "utf8")).toBeLessThan(60 * 1024);
        expect(budget.text).toContain("offset=");
    });

    test("输出 5：大文件的非法 UTF-8 是 not-text，不替换成别的字符；一行特别长时内存有界、行号不乱", async () => {
        await writeFile(join(home, "坏.txt"), Buffer.concat([Buffer.from([0xff]), Buffer.alloc(5 * 1024 * 1024, 0x61)]));
        expect(await read({path: "home://坏.txt"})).toMatchObject({status: "error", code: "not-text"});
        await writeFile(join(home, "单行.txt"), `${"甲".repeat(3 * 1024 * 1024)}\n第二行\n`);
        const long = await read({path: "home://单行.txt"});
        expect(long.status).toBeUndefined();
        expect(long.text).toContain("本行超过");
        expect(long.text).toContain("2:第二行");
    });

    test("定位之后文件被删：not-found，不是工具抛错", async () => {
        await writeFile(join(home, "a.md"), "内容");
        const racing: SessionFiles = {...files, readPath: async (address, options) => {
            const located = await files.readPath(address, options);
            await rm(join(home, "a.md"));
            return located;
        }};
        expect(await read({path: "home://a.md"}, racing)).toMatchObject({status: "error", code: "not-found"});
    });

    test("输出 6：目录列出一层，地址是全局的、目录带斜杠；虚拟根（取不到本机路径）照列出的内容显示", async () => {
        await mkdir(join(home, "子目录"));
        await writeFile(join(home, "a.md"), "内容");
        const listed = await read({path: "home://"});
        expect(listed.text).toContain(`${GLOBAL}/a.md`);
        expect(listed.text).toContain(`${GLOBAL}/子目录/`);
        const virtual: VirtualListing = {kind: "virtual", description: "最近的东西", entries: [{address: "things://一", title: "第一个"}]};
        const withVirtual: SessionFiles = {
            ...files,
            readPath: async (address, options) => (address === "things://" ? {ok: false, code: "unsupported-capability", detail: "虚拟根"} : files.readPath(address, options)),
            list: async (address, options) => (address === "things://" ? {ok: true, value: virtual} : files.list(address, options)),
        };
        expect((await read({path: "things://"}, withVirtual)).text).toBe(renderVirtual(virtual));
    });

    test("eval.md 输出 7：代码里调时另交回对象：原文不带地址头与行号，截短的行只留前 2000 字并列出行号，分页写 next；目录列条目、图片写尺寸；顶层调用不带", async () => {
        await writeFile(join(home, "a.md"), `第1行\n${"长".repeat(2_500)}\n第3行\n`);
        const nested = await read({path: "home://a.md"}, files, true);
        expect(nested.details).toEqual({kind: "text", address: `${GLOBAL}/a.md`, content: `第1行\n${"长".repeat(2_000)}\n第3行`, from: 1, to: 3, total: 3, more: false, next: null, clipped: [2]});
        expect((await read({path: "home://a.md", limit: 1}, files, true)).details).toMatchObject({content: "第1行", from: 1, to: 1, more: true, next: 2});
        expect((await read({path: "home://a.md"})).details).toBeUndefined();

        await mkdir(join(home, "子目录"));
        expect((await read({path: "home://"}, files, true)).details).toEqual({kind: "directory", address: GLOBAL, entries: [`${GLOBAL}/a.md`, `${GLOBAL}/子目录/`], more: false});
        await writeFile(join(home, "图.png"), noisePng(12, 8, false));
        expect((await read({path: "home://图.png"}, files, true)).details).toMatchObject({kind: "image", address: `${GLOBAL}/图.png`, width: 12, height: 8});
    });

    test("输出 7：压不动的图逐级压到 500 KiB 内；可能有透明的不用 JPEG；小图放大", async () => {
        await writeFile(join(home, "噪声.dat"), noisePng(3000, 2000, false));
        const opaque = await read({path: "home://噪声.dat"});
        const opaqueBytes = Buffer.from(opaque.images![0]!.data, "base64");
        expect(opaqueBytes.length).toBeLessThanOrEqual(500 * 1024);
        expect(["image/jpeg", "image/webp"]).toContain(opaque.images![0]!.mime);
        const opaqueMeta = await new Bun.Image(opaqueBytes).metadata();
        expect([opaqueMeta.width, opaqueMeta.height]).toEqual([opaque.images![0]!.width!, opaque.images![0]!.height!]);
        expect(opaqueMeta.width).toBeLessThanOrEqual(1568);

        await writeFile(join(home, "透明.png"), noisePng(1500, 1000, true));
        const translucent = await read({path: "home://透明.png"});
        expect(translucent.images![0]!.mime).not.toBe("image/jpeg");
        expect(Buffer.from(translucent.images![0]!.data, "base64").length).toBeLessThanOrEqual(500 * 1024);

        await writeFile(join(home, "点.png"), await png(1, 1));
        expect((await read({path: "home://点.png"})).images).toMatchObject([{width: 200, height: 200}]);
        await writeFile(join(home, "细长.png"), await png(3000, 20));
        const thin = await read({path: "home://细长.png"});
        expect(thin.images![0]!.width).toBe(1568);
        expect(thin.images![0]!.height).toBeLessThan(200);
    }, 60_000);

    test("输出 7：图片按文件头判断，缩到最长边 1568；太大 too-large；别的二进制 not-text", async () => {
        await writeFile(join(home, "封面.dat"), await png(3136, 1000));
        const big = await read({path: "home://封面.dat"});
        expect(big.status).toBeUndefined();
        expect(big.images).toMatchObject([{width: 1568, height: 500}]);
        expect(await new Bun.Image(Buffer.from(big.images![0]!.data, "base64")).metadata()).toMatchObject({width: 1568, height: 500});
        expect(big.text).toContain("3136x1000");

        const small = await png(300, 300);
        await writeFile(join(home, "小.png"), small);
        expect(Buffer.from((await read({path: "home://小.png"})).images![0]!.data, "base64").equals(Buffer.from(small))).toBe(true);

        const huge = new Uint8Array(21 * 1024 * 1024);
        huge.set(small.subarray(0, 8));
        await writeFile(join(home, "巨大.png"), huge);
        expect(await read({path: "home://巨大.png"})).toMatchObject({status: "error", code: "too-large", details: {code: "too-large"}});
        await writeFile(join(home, "坏.png"), small.subarray(0, 16));
        expect(await read({path: "home://坏.png"})).toMatchObject({code: "not-text"});
        await writeFile(join(home, "数据.bin"), new Uint8Array([1, 0, 2]));
        expect(await read({path: "home://数据.bin"})).toMatchObject({code: "not-text"});
    });
});
