/** 用户附件进请求（docs/specs/harness/runtime.md 输出 82–84）：真内核、真日志，模型是脚本。 */

import {describe, expect, test} from "bun:test";

import type {AnyProfile, AttachmentPort, CompactionMethodImpl, Message, ModelRequest, UserInput} from "../api/index.js";
import {defineExtension} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {createTestSession} from "../testing/test-session.js";
import type {TestSession} from "../testing/test-session.js";
import {createAttachmentResolver, limitImages, MAX_REQUEST_IMAGES} from "./attachments.js";

/** 不调模型的摘要：整段换掉，当前这一轮的输入留着。 */
const wholeSummary: CompactionMethodImpl = async (job) => ({method: job.method, firstKeptEntryId: null, replacement: "摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 1, details: {require: []}});
const URI = "sessions://s/home/attachments/a.png";
const NEW = "sessions://s/home/attachments/new.png";
const label = `![image #1](${URI})`;
const image = (uri = URI) => ({kind: "image" as const, uri, width: 800, height: 600});
const port = (reads: string[] = []): AttachmentPort => ({
    read: async (uri) => {
        reads.push(uri);
        return uri.includes("missing") ? {missing: true} : uri.includes("bad") ? {unusable: "corrupt"} : {data: "QUJD", mime: "image/png", width: 800, height: 600};
    },
});
let commands = 0;
const run = async (session: TestSession, input: UserInput): Promise<void> => {
    commands += 1;
    const sent = await session.raw.send({commandId: `c${String(commands)}`, input});
    if (!sent.ok) throw new Error(sent.code);
    await session.raw.waitRun(sent.value.runId!);
};
const userBlocks = (messages: readonly Message[]) => messages.filter((message) => message.role === "user").flatMap((message) => message.content);

describe("输出 82：图片进请求", () => {
    test("按范围放在文字中间，标签不进请求；模型收到的是图片，拦截层看到的是引用", async () => {
        const seen: string[] = [];
        const watcher = defineExtension({id: "lab.watch", intercept: {model: async (request, next) => {
            seen.push(...request.messages.flatMap((message) => message.content.map((block) => block.kind)));
            return next(request);
        }}});
        const reads: string[] = [];
        await using session = await createTestSession({extensions: [watcher], attachments: port(reads)});
        session.model.script("看到了");
        const text = `看这张${label}怎么样`;
        await run(session, {text, attachments: [{...image(), from: 3, to: 3 + label.length}]});
        const blocks = userBlocks(session.requests.at(-1)!.raw.messages);
        expect(blocks.map((block) => block.kind)).toEqual(["text", "image", "text"]);
        expect(blocks.map((block) => (block.kind === "text" ? block.text : ""))).toEqual(["看这张", "", "怎么样"]);
        expect(seen).toContain("imageRef");
        expect(seen).not.toContain("image");
        expect(reads).toEqual([URI]);
    });

    test("没有范围、范围对不上、`render` 改过文字的放末尾；文件给一行地址；代码里的同样文字不算", async () => {
        await using session = await createTestSession({attachments: port()});
        session.model.script("好");
        const code = "`![image #1](x)`";
        await run(session, {text: code, attachments: [image(), {kind: "file", uri: "sessions://s/home/attachments/b.txt", name: "b.txt"}, {...image("sessions://s/home/attachments/c.png"), from: 0, to: 3}]});
        const blocks = userBlocks(session.requests.at(-1)!.raw.messages);
        expect(blocks[0]).toMatchObject({kind: "text", text: code});
        expect(blocks.map((block) => block.kind)).toEqual(["text", "image", "text", "image"]);
        expect(blocks[2]).toMatchObject({kind: "text", text: "[文件 b.txt：sessions://s/home/attachments/b.txt]"});
    });

    test("缺失与发不了换一行字并写诊断，整轮照常；没给端口的宿主也是；相同地址只读一次", async () => {
        const reads: string[] = [];
        await using session = await createTestSession({attachments: port(reads)});
        session.model.script("好");
        await run(session, {text: "看", attachments: [image("sessions://s/home/attachments/missing.png"), image("sessions://s/home/attachments/bad.png"), image(), image()]});
        const blocks = userBlocks(session.requests.at(-1)!.raw.messages);
        expect(blocks.filter((block) => block.kind === "text").map((block) => (block as {text: string}).text).join()).toContain("读不到了");
        expect(blocks.filter((block) => block.kind === "text").map((block) => (block as {text: string}).text).join()).toContain("发不了");
        expect(blocks.filter((block) => block.kind === "image")).toHaveLength(2);
        expect(reads.filter((uri) => uri === URI)).toHaveLength(1);
        expect((await session.raw.diagnostics()).some((item) => item.code === "attachment-unreadable")).toBe(true);

        await using bare = await createTestSession();
        bare.model.script("好");
        await run(bare, {text: "看", attachments: [image()]});
        expect(userBlocks(bare.requests.at(-1)!.raw.messages).some((block) => block.kind === "image")).toBe(false);
    });

    test("预览不带字节，估算按尺寸；和真实请求同样的块位置", async () => {
        const reads: string[] = [];
        await using session = await createTestSession({attachments: port(reads)});
        await session.raw.enqueue({commandId: "c1", input: {text: "看", attachments: [image()]}, mode: "followup"});
        const preview = await session.raw.preview();
        const blocks = userBlocks(preview.request.messages);
        expect(blocks.some((block) => block.kind === "imageRef")).toBe(true);
        expect(reads).toEqual([]);
        expect(preview.tokens.estimated).toBeGreaterThan(600);
    });
});

describe("输出 83：压缩之后", () => {
    test("摘要之前的用户消息，图换成带地址的占位，当前这一轮也是；回退到压缩前恢复", async () => {
        const reads: string[] = [];
        const profile = defineProfile({id: "lab.compact", version: "1", name: "压缩", description: "压缩测试", system: "系统", compaction: {onThreshold: ["summarize"], onOverflow: ["summarize"]}}) as AnyProfile;
        await using session = await createTestSession({profile, attachments: port(reads), compaction: {methods: {summarize: wholeSummary}}});
        session.model.script("第一");
        await run(session, {text: "看", attachments: [image()]});
        expect(reads).toEqual([URI]);
        const before = await session.raw.rewindTargets();
        const compacted = await session.raw.compact({commandId: "compact"});
        if (!compacted.ok) throw new Error(compacted.code);
        if (compacted.value.runId !== undefined) await session.raw.waitRun(compacted.value.runId);

        session.model.script("第二");
        await run(session, {text: "再看", attachments: [image(NEW)]});
        const after = session.requests.at(-1)!.raw.messages.flatMap((message) => message.content);
        // 压缩之后发的那张还在；压缩之前的不再带（被摘要盖掉了，或换成占位）。
        expect(after.filter((block) => block.kind === "image")).toHaveLength(1);
        expect(reads.at(-1)).toBe(NEW);

        // 回退到压缩之前：图回来了。
        await session.raw.rewind({commandId: "back", to: before.at(-1)!.id});
        session.model.script("第三");
        await run(session, {text: "接着"});
        const restored = session.requests.at(-1)!.raw.messages.flatMap((message) => message.content);
        expect(restored.filter((block) => block.kind === "image")).toHaveLength(1);
    });

    test("当前这一轮的图也换占位：摘要之后重发不再带它们，占位里有地址", async () => {
        const profile = defineProfile({id: "lab.compact2", version: "1", name: "压缩", description: "压缩测试", system: "系统", compaction: {onThreshold: ["summarize"], onOverflow: ["summarize"]}}) as AnyProfile;
        await using session = await createTestSession({profile, attachments: port(), compaction: {methods: {summarize: wholeSummary}}});
        session.model.script({fail: "context_overflow"}, "摘要之后好了");
        await run(session, {text: "看", attachments: [image()]});
        const requests = session.requests;
        expect(requests.length).toBeGreaterThanOrEqual(2);
        const retried = requests.at(-1)!.raw.messages.flatMap((message) => message.content);
        expect(retried.some((block) => block.kind === "image")).toBe(false);
        expect(retried.some((block) => block.kind === "text" && block.text.includes(URI))).toBe(true);
    });
});

describe("输出 84：张数上限", () => {
    const block = (kind: "image" | "imageRef") => ({kind, uri: "u", data: "x", mime: "image/png", origin: {kind: "fixed", by: "profile"}}) as never;
    const request = (count: number): ModelRequest => ({purpose: "turn", model: "m", params: {}, headers: {}, system: [], tools: [], messages: Array.from({length: count}, () => ({role: "user" as const, content: [block("imageRef")]}))});

    test("超过上限从最旧的起换成一行字；不超不动；不改原对象", () => {
        const under = request(MAX_REQUEST_IMAGES);
        expect(limitImages(under)).toBe(under);
        const over = request(MAX_REQUEST_IMAGES + 2);
        const limited = limitImages(over);
        expect(limited.messages.slice(0, 2).map((message) => message.content[0]!.kind)).toEqual(["text", "text"]);
        expect(limited.messages.slice(2).every((message) => message.content[0]!.kind === "imageRef")).toBe(true);
        expect(over.messages[0]!.content[0]!.kind).toBe("imageRef");
    });

    test("拦截层加的图也算：模型收到的不超过上限", async () => {
        const adder = defineExtension({id: "lab.add", intercept: {model: async (request, next) => next({...request, messages: [...request.messages, ...Array.from({length: MAX_REQUEST_IMAGES + 1}, () => ({role: "user" as const, content: [block("image")]}))]})}});
        await using session = await createTestSession({extensions: [adder], attachments: port()});
        session.model.script("好");
        await run(session, {text: "看"});
        const images = session.requests.at(-1)!.raw.messages.flatMap((message) => message.content).filter((item) => item.kind === "image");
        expect(images).toHaveLength(MAX_REQUEST_IMAGES);
    });
});

describe("读取的缓存", () => {
    test("读过的不再读；中止时这个请求不等了，读完的还进缓存；并发读同一地址只读一次", async () => {
        let release = () => undefined as void;
        let reads = 0;
        const slow: AttachmentPort = {read: () => {
            reads += 1;
            return new Promise((resolve) => {
                release = () => resolve({data: "QUJD", mime: "image/png"});
            });
        }};
        const resolver = createAttachmentResolver(slow, () => undefined);
        const ref = {kind: "imageRef" as const, uri: "u", origin: {kind: "fixed" as const, by: "profile" as const}};
        const base: ModelRequest = {purpose: "turn", model: "m", params: {}, headers: {}, system: [], tools: [], messages: [{role: "user", content: [ref]}]};
        const controller = new AbortController();
        const aborted = resolver.resolve(base, controller.signal);
        const other = resolver.resolve(base, new AbortController().signal);
        controller.abort();
        expect((await aborted).messages[0]!.content[0]!.kind).toBe("text");
        release();
        expect((await other).messages[0]!.content[0]!.kind).toBe("image");
        expect((await resolver.resolve(base, new AbortController().signal)).messages[0]!.content[0]!.kind).toBe("image");
        expect(reads).toBe(1);
    });
});
