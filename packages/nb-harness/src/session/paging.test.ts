import {describe, expect, test} from "bun:test";
import {createMemorySessionStore, createSession, readEntry, readPage} from "./session";
import type {EntryInput, PageCursor, SessionEntry, SessionLog, TrimmedEntry} from "./session";
import {assistantMessage, reminder, seed, toolCall, toolResult, userMessage} from "./testing/fixtures";

const KiB = 1024;
const encoder = new TextEncoder();
const bytesOf = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

async function logWith(batches: readonly (readonly EntryInput[])[], id = "paged"): Promise<SessionLog> {
    const created = await createSession(createMemorySessionStore(), {id});
    if (!created.ok) throw new Error(created.detail);
    for (const batch of batches) {
        const result = await created.value.append(batch);
        if (!result.ok) throw new Error(`append 失败：${result.code} ${result.detail}`);
    }
    return created.value;
}

/** 一轮：用户输入、带工具调用的助手消息、工具结果、助手回答。`outputs` 给每个工具结果的文本。 */
function turn(index: number, outputs: readonly string[] = ["好的"]): EntryInput[] {
    const calls = outputs.map((_, call) => toolCall(`t${index}-c${call}`, "read"));
    return [
        userMessage(`第 ${index} 轮`),
        assistantMessage(calls, {stopReason: "toolUse"}),
        ...outputs.map((text, call) => toolResult(`t${index}-c${call}`, "read", text)),
        assistantMessage([{type: "text", text: `第 ${index} 轮的回答`}]),
    ];
}

function userTurnsIn(page: readonly TrimmedEntry[]): number {
    return page.filter(({entry}) => entry.type === "message" && entry.message.role === "user").length;
}

function pageBytes(page: readonly TrimmedEntry[]): number {
    return page.reduce((total, {entry}) => total + bytesOf(entry), 0);
}

describe("分页（输出 20–22）", () => {
    test("场景 15：三十轮按每页 10 轮、256 KiB、单字段 16 KiB 读取：页不超限、超大的一轮单独成页、大字段被截断、合起来恰好是全部条目、追加后旧游标仍读到同一页、别的会话的游标无效", async () => {
        const batches = Array.from({length: 30}, (_, index) => {
            const number = index + 1;
            if (number === 5) return turn(number, ["x".repeat(200 * KiB)]);
            if (number === 12) return turn(number, Array.from({length: 20}, (_, call) => `${call}:`.padEnd(15 * KiB, "y")));
            return turn(number);
        });
        const log = await logWith(batches);
        const options = {maxTurns: 10, maxBytes: 256 * KiB, fieldBudget: 16 * KiB};

        const pages: TrimmedEntry[][] = [];
        let before: PageCursor | undefined;
        for (;;) {
            const page = readPage(log, {...options, ...(before === undefined ? {} : {before})});
            expect(page.ok).toBe(true);
            if (!page.ok) return;
            pages.unshift([...page.value.entries]);
            expect(page.value.latestSeq).toBe(log.entries.length);
            if (page.value.next === null) break;
            before = page.value.next;
        }

        for (const page of pages) {
            const turns = userTurnsIn(page);
            expect(turns).toBeGreaterThanOrEqual(1);
            expect(turns).toBeLessThanOrEqual(10);
            const containsWideTurn = page.some(({entry}) => entry.type === "message" && entry.message.role === "user" && entry.message.content === "第 12 轮");
            if (containsWideTurn) expect(turns).toBe(1);
            else expect(pageBytes(page)).toBeLessThanOrEqual(256 * KiB);
        }
        const flat = pages.flat();
        expect(flat.map(({seq}) => seq)).toEqual(log.entries.map((_, index) => index + 1));
        expect(flat.map(({entry}) => entry.id)).toEqual(log.entries.map((entry) => entry.id));

        const big = flat.find(({trimmed}) => trimmed.some(({originalBytes}) => originalBytes === 200 * KiB))!;
        expect(big.trimmed).toEqual([{path: "message.content[0].text", originalBytes: 200 * KiB}]);
        expect(big.entry.type).toBe("message");
        if (big.entry.type !== "message" || big.entry.message.role !== "toolResult") throw new Error("截断的应是工具结果");
        expect(big.entry.message.toolCallId).toBe("t5-c0");
        expect(encoder.encode((big.entry.message.content[0] as {text: string}).text).length).toBeLessThanOrEqual(16 * KiB);
        const full = readEntry(log.entries, big.entry.id);
        expect(full.ok && full.value.seq).toBe(big.seq);
        expect(full.ok && full.value.entry.type === "message" && full.value.entry.message.role === "toolResult" && (full.value.entry.message.content[0] as {text: string}).text.length).toBe(200 * KiB);

        const latest = readPage(log, options);
        if (!latest.ok || latest.value.next === null) throw new Error("最后一页应有更早的一页");
        const olderBefore = readPage(log, {...options, before: latest.value.next});
        await log.append(turn(31));
        const olderAfter = readPage(log, {...options, before: latest.value.next});
        expect(olderAfter.ok && olderBefore.ok && olderAfter.value.entries).toEqual(olderBefore.ok ? olderBefore.value.entries : []);

        const other = await logWith(batches, "other-session");
        const foreign = readPage(other, options);
        if (!foreign.ok || foreign.value.next === null) throw new Error("另一个会话也应有游标");
        const rejected = readPage(log, {...options, before: foreign.value.next});
        expect(rejected.ok ? null : rejected.code).toBe("invalid-cursor");
    });

    test("输出 20：轮按用户发出的消息划分，种子、提醒不开始新的一轮；没有 before 时取最后一页；空会话返回空页", async () => {
        const log = await logWith([[seed("任务", {role: "developer"}), seed("目录")], turn(1), [reminder("保持第三人称")], turn(2), turn(3)]);
        const options = {maxTurns: 1, maxBytes: 1024 * KiB, fieldBudget: 16 * KiB};
        const last = readPage(log, options);
        expect(last.ok && last.value.entries.map(({entry}) => entry.type === "message" && entry.message.role === "user" ? entry.message.content : entry.type)).toEqual(["第 3 轮", "message", "message", "message"]);
        const middle = readPage(log, {...options, before: last.ok ? (last.value.next as string) : ""});
        expect(middle.ok && middle.value.entries[0]!.seq).toBe(log.entries.findIndex((entry) => entry.type === "message" && entry.message.content === "第 2 轮") + 1);
        const first = readPage(log, {...options, before: middle.ok ? (middle.value.next as string) : ""});
        // 第 1 轮到第 2 轮之前为止，中间的提醒不另起一轮；第一条用户消息之前的种子按 Spec 算作它们自己的一轮。
        expect(first.ok && first.value.entries.map(({entry}) => entry.type === "custom_message" ? entry.customType : entry.type === "message" ? entry.message.role : entry.type)).toEqual([
            "user", "assistant", "toolResult", "assistant", "harness/reminder",
        ]);
        const seeds = readPage(log, {...options, before: first.ok ? (first.value.next as string) : ""});
        expect(seeds.ok && seeds.value.entries.map(({entry}) => entry.type === "custom_message" && entry.customType)).toEqual(["harness/seed", "harness/seed"]);
        expect(seeds.ok && seeds.value.next).toBeNull();

        const empty = await logWith([], "empty");
        expect(readPage(empty, options)).toEqual({ok: true, value: {entries: [], next: null, latestSeq: 0}});
    });

    test("输出 20：游标格式不对、不是一轮的起点或超出当前条目时为 invalid-cursor", async () => {
        const log = await logWith([turn(1), turn(2)]);
        const options = {maxTurns: 1, maxBytes: 1024 * KiB, fieldBudget: 16 * KiB};
        const bad = (before: string): string | null => {
            const result = readPage(log, {...options, before});
            return result.ok ? null : result.code;
        };
        expect(bad("not-a-cursor")).toBe("invalid-cursor");
        expect(bad(Buffer.from(JSON.stringify({s: "paged", q: 2})).toString("base64url"))).toBe("invalid-cursor");
        expect(bad(Buffer.from(JSON.stringify({s: "paged", q: 99})).toString("base64url"))).toBe("invalid-cursor");
        expect(bad(Buffer.from(JSON.stringify({s: "paged", q: 5})).toString("base64url"))).toBeNull();
    });

    test("输出 21：只截正文、思考、工具参数、custom 数据与摘要；图片数据超预算置空；类型、角色、id、工具名原样；不拆开字符", async () => {
        const long = "汉".repeat(100);
        const log = await logWith([[
            assistantMessage([
                {type: "thinking", thinking: long, thinkingSignature: "keep-sig"},
                {type: "text", text: long},
                {type: "image", data: "a".repeat(400), mimeType: "image/png"},
                toolCall("call-with-long-id-".padEnd(80, "i"), "tool-name-that-is-long-".padEnd(80, "n"), {path: "short", body: {nested: [long]}}),
            ], {stopReason: "toolUse"}),
            {type: "custom", customType: "plugin.x/blob", data: {items: [{title: "短", body: long}]}},
            {type: "custom_message", customType: "plugin.x/note", content: [{type: "text", text: long}], display: true, details: {note: long}},
            {type: "compaction", summary: long, firstKeptEntryId: "whatever-id-long-".padEnd(80, "w"), tokensBefore: 1},
        ]]);
        const page = readPage(log, {maxTurns: 10, maxBytes: 1024 * KiB, fieldBudget: 64});
        if (!page.ok) throw new Error(page.detail);
        const [assistant, custom, note, compaction] = page.value.entries as [TrimmedEntry, TrimmedEntry, TrimmedEntry, TrimmedEntry];

        expect(assistant.trimmed.map(({path}) => path)).toEqual(["message.content[0].thinking", "message.content[1].text", "message.content[2].data", "message.content[3].arguments.body.nested[0]"]);
        expect(assistant.trimmed[0]!.originalBytes).toBe(300);
        const content = (assistant.entry as unknown as {message: {content: Record<string, unknown>[]}}).message.content;
        expect(content[0]!.thinking).toBe("汉".repeat(21));
        expect(content[0]!.thinkingSignature).toBe("keep-sig");
        expect(content[2]!.data).toBe("");
        expect(content[2]!.mimeType).toBe("image/png");
        expect((content[3]!.id as string).length).toBe(80);
        expect((content[3]!.name as string).length).toBe(80);
        expect(assistant.entry.id).toBe(log.entries[0]!.id);

        expect(custom.trimmed).toEqual([{path: "data.items[0].body", originalBytes: 300}]);
        expect(note.trimmed.map(({path}) => path)).toEqual(["content[0].text", "details.note"]);
        expect((note.entry as {customType: string}).customType).toBe("plugin.x/note");
        expect(compaction.trimmed).toEqual([{path: "summary", originalBytes: 300}]);
        expect((compaction.entry as {firstKeptEntryId: string}).firstKeptEntryId.length).toBe(80);
    });

    test("输出 22、场景 16：按 id 读取完整条目与序号，没有为 entry-not-found；分页与读取不改日志", async () => {
        const log = await logWith([turn(1, ["z".repeat(1000)])]);
        const snapshot = structuredClone(log.entries) as SessionEntry[];
        readPage(log, {maxTurns: 1, maxBytes: 10, fieldBudget: 10});
        const found = readEntry(log.entries, log.entries[2]!.id);
        expect(found.ok && found.value).toEqual({seq: 3, entry: log.entries[2]!});
        const missing = readEntry(log.entries, "nope");
        expect(missing.ok ? null : missing.code).toBe("entry-not-found");
        expect(log.entries).toEqual(snapshot);
    });
});
