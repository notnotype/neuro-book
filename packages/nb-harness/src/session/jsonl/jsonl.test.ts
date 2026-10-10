import {afterAll, describe, expect, test} from "bun:test";
import {appendFile, chmod, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createSession, openSession} from "../log";
import {planRecovery, sessionStatus} from "../replay";
import {assistantMessage, invocation, titleChange, toolCall, toolResult, userMessage} from "../testing/fixtures";
import {describeStoreScenarios} from "../testing/store-scenarios";
import type {EntryInput, LogEndReason, SessionLog, SessionStore} from "../types";
import {createJsonlSessionStore} from "./jsonl";

const roots: string[] = [];

async function newRoot(): Promise<string> {
    const root = await createTestTmpRoot("nb-harness-session-jsonl", "session-jsonl");
    roots.push(root);
    return root;
}

afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

describeStoreScenarios("JSONL 存储", async () => createJsonlSessionStore({root: await newRoot()}));

async function newLog(store: SessionStore, id: string): Promise<SessionLog> {
    const result = await createSession(store, {id});
    if (!result.ok) throw new Error(`createSession 失败：${result.code} ${result.detail}`);
    return result.value;
}

async function appended(log: SessionLog, inputs: readonly EntryInput[]): Promise<void> {
    const result = await log.append(inputs);
    if (!result.ok) throw new Error(`append 失败：${result.code} ${result.detail}`);
}

function failure(result: {ok: boolean} & Record<string, unknown>): {code?: unknown; line?: unknown} {
    return result.ok ? {} : {code: result.code, line: result.line};
}

/** 包一层 JSONL 存储：`failNext(k)` 之后的下一次 append 把前 k 条与第 k+1 条的半行直接写进文件，然后报失败（Spec 场景 11）。 */
function partiallyWritingStore(root: string, inner: SessionStore): SessionStore & {failNext(written: number): void} {
    let pending: number | null = null;
    return {
        ...inner,
        failNext: (written) => {
            pending = written;
        },
        async append(id, entries) {
            if (pending === null) return inner.append(id, entries);
            const written = pending;
            pending = null;
            const lines = entries.map((entry) => JSON.stringify(entry));
            const half = lines[written] === undefined ? "" : lines[written].slice(0, Math.ceil(lines[written].length / 2));
            await appendFile(join(root, `${id}.jsonl`), `${lines.slice(0, written).map((line) => `${line}\n`).join("")}${half}`, "utf8");
            return {ok: false, code: "store-failed", detail: "模拟写到一半断电"};
        },
    };
}

describe("JSONL 存储：文件", () => {
    test("文件布局：<root>/<id>.jsonl，第一行是会话头，每行以换行结束；root 不存在时为 store-failed 且不创建它", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const log = await newLog(store, "layout");
        await appended(log, [userMessage("一"), titleChange("标题")]);
        const text = await readFile(join(root, "layout.jsonl"), "utf8");
        const lines = text.split("\n");
        expect(text.endsWith("\n")).toBe(true);
        expect(lines).toHaveLength(4);
        expect(JSON.parse(lines[0]!)).toMatchObject({type: "session", version: 1, id: "layout"});
        expect(JSON.parse(lines[2]!)).toMatchObject({type: "title_change", title: "标题"});

        const missingRoot = join(root, "does-not-exist");
        const created = await createSession(createJsonlSessionStore({root: missingRoot}), {id: "x"});
        expect(failure(created).code).toBe("store-failed");
        await expect(stat(missingRoot)).rejects.toMatchObject({code: "ENOENT"});
    });

    test("场景 3：文件末尾的半行是中断尾；追加为 damaged-tail，repair 截掉后可以继续，再打开没有中断尾", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const log = await newLog(store, "tail");
        await appended(log, [userMessage("一"), userMessage("二")]);
        log.close();
        const half = '{"type":"message","message":{"role":"user","content":"半行：你好';
        await appendFile(join(root, "tail.jsonl"), half, "utf8");

        const reopened = await openSession(store, "tail");
        expect(reopened.ok).toBe(true);
        if (!reopened.ok) return;
        expect(reopened.value.entries).toHaveLength(2);
        expect(reopened.value.damagedTail).toEqual({bytes: Buffer.byteLength(half)});
        const blocked = await reopened.value.append([userMessage("三")]);
        expect(failure(blocked).code).toBe("damaged-tail");
        const repaired = await reopened.value.repair();
        expect(repaired.ok && repaired.value).toEqual({droppedBytes: Buffer.byteLength(half)});
        expect(reopened.value.damagedTail).toBeNull();
        await appended(reopened.value, [userMessage("三")]);
        expect((await reopened.value.repair()).ok && (await reopened.value.repair())).toMatchObject({value: {droppedBytes: 0}});
        reopened.value.close();

        const again = await openSession(store, "tail");
        expect(again.ok && again.value.damagedTail).toBeNull();
        expect(again.ok && again.value.entries.length).toBe(3);
    });

    test("场景 4、输出 7：中间一行不是合法 JSON 或不符合条目规则时为 corrupt-session 并给出行号，文件字节不变", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const log = await newLog(store, "corrupt");
        await appended(log, [userMessage("一"), userMessage("二"), userMessage("三")]);
        log.close();
        const path = join(root, "corrupt.jsonl");
        const lines = (await readFile(path, "utf8")).split("\n");
        lines[2] = "{not json";
        await writeFile(path, lines.join("\n"), "utf8");
        const before = await readFile(path);

        const opened = await openSession(store, "corrupt");
        expect(failure(opened)).toEqual({code: "corrupt-session", line: 3});
        expect(Buffer.compare(await readFile(path), before)).toBe(0);

        lines[2] = JSON.stringify({type: "message", message: {role: "user", content: "没有 id"}});
        await writeFile(path, lines.join("\n"), "utf8");
        const malformed = await openSession(store, "corrupt");
        expect(failure(malformed)).toEqual({code: "corrupt-session", line: 3});

        await writeFile(join(root, "empty.jsonl"), "", "utf8");
        expect(failure(await openSession(store, "empty"))).toEqual({code: "corrupt-session", line: 1});
        await writeFile(join(root, "badhead.jsonl"), `${JSON.stringify({type: "nope", version: 1, id: "badhead"})}\n`, "utf8");
        expect(failure(await openSession(store, "badhead"))).toEqual({code: "corrupt-session", line: 1});
    });

    test("输出 8：会话头版本不是 1 时为 unsupported-version，文件不变", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const path = join(root, "v2.jsonl");
        const content = `${JSON.stringify({type: "session", version: 2, id: "v2", createdAt: new Date(0).toISOString()})}\n`;
        await writeFile(path, content, "utf8");
        const opened = await openSession(store, "v2");
        expect(failure(opened)).toEqual({code: "unsupported-version", line: 1});
        expect(await readFile(path, "utf8")).toBe(content);
        const listed = await store.list();
        expect(listed.ok && listed.value.map((summary) => summary.id)).toEqual([]);
    });

    test("场景 5：根目录在追加前被删除，append 为 store-failed，entries 不变，订阅以 broken 结束，下一次 append 为 log-broken", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const log = await newLog(store, "gone");
        await appended(log, [userMessage("一")]);
        const ends: LogEndReason[] = [];
        log.subscribe(() => undefined, {onEnd: (reason) => ends.push(reason)});
        await rm(root, {recursive: true, force: true});

        const failed = await log.append([userMessage("二")]);
        expect(failure(failed).code).toBe("store-failed");
        expect(log.entries).toHaveLength(1);
        expect(ends).toEqual(["broken"]);
        expect(failure(await log.append([userMessage("三")])).code).toBe("log-broken");
    });

    test("会话文件被删除后追加为 store-failed，不会重建一个没有会话头的文件", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const log = await newLog(store, "deleted");
        await rm(join(root, "deleted.jsonl"));
        expect(failure(await log.append([userMessage("一")])).code).toBe("store-failed");
        await expect(stat(join(root, "deleted.jsonl"))).rejects.toMatchObject({code: "ENOENT"});
    });

    test("场景 11：写入中途失败留下前缀与半行：原句柄只能关闭；重开读回前缀与中断尾，repair 后按 sessionStatus、planRecovery 收口并继续追加，按旧序号续订能补到已落盘的条目", async () => {
        const root = await newRoot();
        const store = partiallyWritingStore(root, createJsonlSessionStore({root}));
        const log = await newLog(store, "partial");
        await appended(log, [invocation("inv-1", "start"), userMessage("一"), assistantMessage([toolCall("c1", "read")], {stopReason: "toolUse"})]);
        let lastSeq = 0;
        log.subscribe((event) => {
            lastSeq = event.seq;
        });
        expect(lastSeq).toBe(3);

        store.failNext(1);
        const failed = await log.append([toolResult("c1", "read", "读到了"), userMessage("四"), userMessage("五")]);
        expect(failure(failed).code).toBe("store-failed");
        expect(failure(await log.append([userMessage("六")])).code).toBe("log-broken");
        expect(failure(await log.repair()).code).toBe("log-broken");
        log.close();

        const reopened = await openSession(store, "partial");
        expect(reopened.ok).toBe(true);
        if (!reopened.ok) return;
        expect(reopened.value.entries).toHaveLength(4);
        expect(reopened.value.entries[3]!.type === "message" && reopened.value.entries[3]!.message.role).toBe("toolResult");
        expect(reopened.value.damagedTail?.bytes ?? 0).toBeGreaterThan(0);
        expect((await reopened.value.repair()).ok).toBe(true);

        expect(sessionStatus(reopened.value.entries)).toMatchObject({phase: "running", invocationId: "inv-1", pending: []});
        const plan = planRecovery(reopened.value.entries);
        expect(plan).toEqual([invocation("inv-1", "interrupted")]);
        await appended(reopened.value, plan);
        expect(sessionStatus(reopened.value.entries).phase).toBe("idle");

        const caughtUp: number[] = [];
        reopened.value.subscribe((event) => caughtUp.push(event.seq), {afterSeq: lastSeq});
        expect(caughtUp).toEqual([4, 5]);
        await appended(reopened.value, [userMessage("四")]);
        expect(caughtUp).toEqual([4, 5, 6]);
        reopened.value.close();
    });

    test("场景 3：中断尾切在一个多字节字符中间时，bytes 仍按文件里的原始字节算，repair 恰好截掉这些字节", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const log = await newLog(store, "cut");
        await appended(log, [userMessage("完整的一行")]);
        log.close();
        const tail = Buffer.concat([Buffer.from('{"type":"message","x":"汉', "utf8").subarray(0, -1)]);
        await appendFile(join(root, "cut.jsonl"), tail);
        const before = (await readFile(join(root, "cut.jsonl"))).length;

        const reopened = await openSession(store, "cut");
        if (!reopened.ok) throw new Error(reopened.detail);
        expect(reopened.value.damagedTail).toEqual({bytes: tail.length});
        const repaired = await reopened.value.repair();
        expect(repaired.ok && repaired.value).toEqual({droppedBytes: tail.length});
        expect((await readFile(join(root, "cut.jsonl"))).length).toBe(before - tail.length);
        await appended(reopened.value, [userMessage("修好后追加")]);
        reopened.value.close();
        const again = await openSession(store, "cut");
        expect(again.ok && again.value.entries.length).toBe(2);
    });

    test("输出 5、7：文件名与会话头的 id 不一致时为 corrupt-session（第 1 行），list 也不列出它", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const log = await newLog(store, "b");
        await appended(log, [userMessage("一")]);
        log.close();
        await writeFile(join(root, "a.jsonl"), await readFile(join(root, "b.jsonl")));
        expect(failure(await openSession(store, "a"))).toEqual({code: "corrupt-session", line: 1});
        const listed = await store.list();
        expect(listed.ok && listed.value.map((summary) => summary.id)).toEqual(["b"]);
    });

    test("输出 17：读不出来的会话文件让 list 返回 store-failed，而不是当作损坏跳过", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const fine = await newLog(store, "fine");
        await appended(fine, [userMessage("一")]);
        const locked = await newLog(store, "locked");
        await appended(locked, [userMessage("二")]);
        const lockedPath = join(root, "locked.jsonl");
        await chmod(lockedPath, 0o000);
        try {
            const listed = await store.list();
            expect(failure(listed).code).toBe("store-failed");
        } finally {
            await chmod(lockedPath, 0o644);
        }
        const afterRestore = await store.list();
        expect(afterRestore.ok && afterRestore.value.map((summary) => summary.id).sort()).toEqual(["fine", "locked"]);
    });

    test("输出 17：损坏的会话不列出，有中断尾的照常列出，不是 .jsonl 的文件忽略", async () => {
        const root = await newRoot();
        const store = createJsonlSessionStore({root});
        const fine = await newLog(store, "fine");
        await appended(fine, [titleChange("好的")]);
        const damaged = await newLog(store, "damaged");
        await appended(damaged, [userMessage("一")]);
        await appendFile(join(root, "damaged.jsonl"), "{half", "utf8");
        await writeFile(join(root, "broken.jsonl"), "garbage\n", "utf8");
        await writeFile(join(root, "notes.txt"), "ignored", "utf8");

        const listed = await store.list();
        expect(listed.ok).toBe(true);
        if (!listed.ok) return;
        expect(listed.value.map((summary) => summary.id).sort()).toEqual(["damaged", "fine"]);
        expect(listed.value.find((summary) => summary.id === "fine")?.title).toBe("好的");
    });
});
