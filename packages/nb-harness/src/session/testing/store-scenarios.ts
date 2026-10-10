/**
 * 两种存储都要通过的日志行为（docs/specs/harness/session.md 输出 18：内存与 JSONL 对输出 1–11、17、19 行为相同）。
 * 每个存储的测试文件调用 `describeStoreScenarios`，自己只写与存储介质有关的部分。
 */

import {describe, expect, test} from "bun:test";
import {createSession, openSession} from "../log";
import type {EntryInput, LogEndReason, SessionEntry, SessionLog, SessionStore} from "../types";
import {assistantMessage, titleChange, toolCall, toolResult, userMessage} from "./fixtures";

/** 包一层存储：`failNext()` 之后的下一次 `append` 不写入、直接报 I/O 失败。模拟 Spec 输出 10 的“存储在 append 中失败”。 */
export function withFailingAppend(store: SessionStore): SessionStore & {failNext(): void} {
    let armed = false;
    return {
        ...store,
        failNext: () => {
            armed = true;
        },
        async append(id, entries) {
            if (armed) {
                armed = false;
                return {ok: false, code: "store-failed", detail: "模拟的 I/O 失败"};
            }
            return store.append(id, entries);
        },
    };
}

function received(log: SessionLog, afterSeq?: number): {seqs: number[]; ends: LogEndReason[]; release(): void} {
    const seqs: number[] = [];
    const ends: LogEndReason[] = [];
    const subscription = log.subscribe((event) => seqs.push(event.seq), {...(afterSeq === undefined ? {} : {afterSeq}), onEnd: (reason) => ends.push(reason)});
    return {seqs, ends, release: subscription.release};
}

async function opened(store: SessionStore, options: {id?: string; now?: () => Date} = {}): Promise<SessionLog> {
    const result = await createSession(store, options);
    if (!result.ok) throw new Error(`createSession 失败：${result.code} ${result.detail}`);
    return result.value;
}

async function appended(log: SessionLog, inputs: readonly EntryInput[]): Promise<readonly SessionEntry[]> {
    const result = await log.append(inputs);
    if (!result.ok) throw new Error(`append 失败：${result.code} ${result.detail}`);
    return result.value;
}

export function describeStoreScenarios(label: string, makeStore: () => Promise<SessionStore>): void {
    describe(`${label}：日志句柄`, () => {
        test("场景 1：新建、分批追加、关闭后用同一存储打开，条目逐项相等、序号相同", async () => {
            const store = await makeStore();
            const log = await opened(store, {id: "s1"});
            const written = [
                ...(await appended(log, [userMessage("改第三章")])),
                ...(await appended(log, [assistantMessage([toolCall("c1", "read", {path: "a"}), toolCall("c2", "read", {path: "b"})], {stopReason: "toolUse"})])),
                ...(await appended(log, [toolResult("c1", "read", "A"), toolResult("c2", "read", "B")])),
                ...(await appended(log, [titleChange("第三章修订")])),
            ];
            log.close();

            const reopened = await openSession(store, "s1");
            expect(reopened.ok).toBe(true);
            if (!reopened.ok) return;
            expect(reopened.value.entries).toEqual(written);
            expect(reopened.value.entries.map((entry) => entry.id)).toEqual(written.map((entry) => entry.id));
            expect(reopened.value.header.id).toBe("s1");
            expect(reopened.value.damagedTail).toBeNull();
        });

        test("输出 1：会话 id 不合规则为 invalid-session-id；重复新建为 session-exists 且不改动已有会话", async () => {
            const store = await makeStore();
            expect((await createSession(store, {id: "有 空格"})).ok).toBe(false);
            const bad = await createSession(store, {id: "a/b"});
            expect(bad.ok ? null : bad.code).toBe("invalid-session-id");

            const first = await opened(store, {id: "dup"});
            await appended(first, [userMessage("只有这一条")]);
            const again = await createSession(store, {id: "dup"});
            expect(again.ok ? null : again.code).toBe("session-exists");
            const reopened = await openSession(store, "dup");
            expect(reopened.ok && reopened.value.entries.length).toBe(1);
        });

        test("输出 2：条目 id 会话内唯一、parentId 接上一条、第一条为 null；空批返回空数组且不写入", async () => {
            const store = await makeStore();
            const log = await opened(store);
            const empty = await log.append([]);
            expect(empty.ok && empty.value).toEqual([]);
            expect(log.entries).toHaveLength(0);

            const entries = await appended(log, [userMessage("1"), userMessage("2"), userMessage("3")]);
            expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
            expect(entries[0]!.parentId).toBeNull();
            expect(entries[1]!.parentId).toBe(entries[0]!.id);
            expect(entries[2]!.parentId).toBe(entries[1]!.id);
            const more = await appended(log, [userMessage("4")]);
            expect(more[0]!.parentId).toBe(entries[2]!.id);
            expect(log.entries).toHaveLength(4);
        });

        test("输出 3：一批里有一条不合规则，整批不写入，index 指向第一条不合规则的输入", async () => {
            const store = await makeStore();
            const log = await opened(store);
            const result = await log.append([userMessage("好的"), {type: "model_change", model: 123} as unknown as EntryInput, {type: "nope"} as unknown as EntryInput]);
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.code).toBe("invalid-entry");
            expect(result.index).toBe(1);
            expect(result.detail).toContain("model");
            expect(log.entries).toHaveLength(0);
            const reopened = await openSession(store, log.header.id);
            expect(reopened.ok && reopened.value.entries.length).toBe(0);
        });

        test("输出 4：时间戳取自 now；时钟倒退时沿用上一条的时间", async () => {
            const store = await makeStore();
            const ticks = [10_000, 20_000, 30_000, 25_000, 40_000];
            const log = await opened(store, {now: () => new Date(ticks.shift() ?? 50_000)});
            const entries = await appended(log, [userMessage("a"), userMessage("b"), userMessage("c"), userMessage("d")]);
            expect(entries.map((entry) => Date.parse(entry.timestamp))).toEqual([20_000, 30_000, 30_000, 40_000]);
        });

        test("输出 5：打开不存在的会话为 session-not-found；id 不合规则为 invalid-session-id", async () => {
            const store = await makeStore();
            const missing = await openSession(store, "missing");
            expect(missing.ok ? null : missing.code).toBe("session-not-found");
            const bad = await openSession(store, "../etc");
            expect(bad.ok ? null : bad.code).toBe("invalid-session-id");
        });

        test("场景 2：订阅先补发再推送；以第二批最后一条的序号续订，先补发第三批，之后两个订阅收到相同的新条目", async () => {
            const store = await makeStore();
            const log = await opened(store);
            const first = received(log);
            await appended(log, [userMessage("1"), userMessage("2")]);
            await appended(log, [userMessage("3")]);
            await appended(log, [userMessage("4"), userMessage("5")]);
            expect(first.seqs).toEqual([1, 2, 3, 4, 5]);

            const second = received(log, 3);
            expect(second.seqs).toEqual([4, 5]);
            await appended(log, [userMessage("6"), userMessage("7")]);
            expect(first.seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
            expect(second.seqs).toEqual([4, 5, 6, 7]);
            expect(first.ends).toEqual([]);
            expect(second.ends).toEqual([]);

            // 推送途中新建的订阅自己补发全部条目，不会再从这批里收到第二次。
            let midBatch: ReturnType<typeof received> | null = null;
            log.subscribe((event) => {
                if (event.seq === 8) midBatch = received(log, 6);
            }, {afterSeq: 7});
            await appended(log, [userMessage("8"), userMessage("9")]);
            expect(midBatch === null ? null : (midBatch as ReturnType<typeof received>).seqs).toEqual([7, 8, 9]);
        });

        test("场景 12：close 后订阅立即结束；补发中监听函数抛错只结束该订阅；监听函数里 append 排在当前批之后；监听函数里 close 时其余条目不再推送", async () => {
            const store = await makeStore();
            const log = await opened(store);
            await appended(log, [userMessage("1"), userMessage("2")]);

            const healthy = received(log);
            const throwingEnds: LogEndReason[] = [];
            const throwingSeqs: number[] = [];
            log.subscribe(
                (event) => {
                    throwingSeqs.push(event.seq);
                    throw new Error("监听函数坏了");
                },
                {onEnd: (reason) => throwingEnds.push(reason)},
            );
            expect(throwingSeqs).toEqual([1]);
            expect(throwingEnds).toEqual(["listener-error"]);
            const afterThrow = await log.append([userMessage("3")]);
            expect(afterThrow.ok).toBe(true);
            expect(throwingSeqs).toEqual([1]);
            expect(healthy.seqs).toEqual([1, 2, 3]);

            const nested: number[] = [];
            let nestedAppend: Promise<unknown> | null = null;
            log.subscribe((event) => {
                nested.push(event.seq);
                if (event.seq === 4) nestedAppend = log.append([userMessage("嵌套")]);
            }, {afterSeq: 3});
            const outer = await log.append([userMessage("4"), userMessage("5")]);
            expect(outer.ok && outer.value.length).toBe(2);
            expect(nested).toEqual([4, 5]);
            await nestedAppend;
            expect(nested).toEqual([4, 5, 6]);
            expect(healthy.seqs).toEqual([1, 2, 3, 4, 5, 6]);

            const closingSeqs: number[] = [];
            const closingEnds: LogEndReason[] = [];
            log.subscribe((event) => {
                closingSeqs.push(event.seq);
                log.close();
            }, {afterSeq: 6, onEnd: (reason) => closingEnds.push(reason)});
            const lastBatch = await log.append([userMessage("7"), userMessage("8"), userMessage("9")]);
            expect(lastBatch.ok && lastBatch.value.length).toBe(3);
            expect(closingSeqs).toEqual([7]);
            expect(closingEnds).toEqual(["closed"]);
            expect(healthy.seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
            expect(healthy.ends).toEqual(["closed"]);

            const late = received(log);
            expect(late.seqs).toEqual([]);
            expect(late.ends).toEqual(["closed"]);
            late.release();
            const afterClose = await log.append([userMessage("10")]);
            expect(afterClose.ok ? null : afterClose.code).toBe("log-closed");
            expect((await log.repair()).ok).toBe(false);
            log.close();
            expect(healthy.ends).toEqual(["closed"]);
        });

        test("输出 9.2、9.6：监听函数里 release 从下一条起不再收到且不调用 onEnd；release 后不再推送、不调用 onEnd", async () => {
            const store = await makeStore();
            const log = await opened(store);
            const selfReleasing: number[] = [];
            const selfReleasingEnds: LogEndReason[] = [];
            const subscription = log.subscribe((event) => {
                selfReleasing.push(event.seq);
                subscription.release();
            }, {onEnd: (reason) => selfReleasingEnds.push(reason)});
            await appended(log, [userMessage("1"), userMessage("2")]);
            expect(selfReleasing).toEqual([1]);

            const other = received(log);
            other.release();
            await appended(log, [userMessage("3")]);
            expect(other.seqs).toEqual([1, 2]);
            expect(selfReleasing).toEqual([1]);
            log.close();
            expect(selfReleasingEnds).toEqual([]);
            expect(other.ends).toEqual([]);
        });

        test("输出 10、11：存储写入失败后这批不进入 entries、订阅以 broken 结束、句柄只能关闭", async () => {
            const store = withFailingAppend(await makeStore());
            const log = await opened(store);
            await appended(log, [userMessage("1")]);
            const watcher = received(log);

            store.failNext();
            const failed = await log.append([userMessage("2")]);
            expect(failed.ok ? null : failed.code).toBe("store-failed");
            expect(log.entries).toHaveLength(1);
            expect(watcher.seqs).toEqual([1]);
            expect(watcher.ends).toEqual(["broken"]);

            const next = await log.append([userMessage("3")]);
            expect(next.ok ? null : next.code).toBe("log-broken");
            const repaired = await log.repair();
            expect(repaired.ok ? null : repaired.code).toBe("log-broken");
            const late = received(log);
            expect(late.ends).toEqual(["broken"]);

            log.close();
            const closed = await log.append([userMessage("4")]);
            expect(closed.ok ? null : closed.code).toBe("log-closed");

            const reopened = await openSession(store, log.header.id);
            expect(reopened.ok && reopened.value.entries.length).toBe(1);
        });

        test("输出 17：list 列出 id、创建时间、父会话、最后的标题与最后条目的时间", async () => {
            const store = await makeStore();
            const ticks = [1_000, 2_000, 3_000];
            const log = await opened(store, {id: "listed", now: () => new Date(ticks.shift() ?? 9_000)});
            await appended(log, [titleChange("旧标题"), titleChange("新标题", "user")]);
            const child = await createSession(store, {id: "child", parentSession: "listed"});
            expect(child.ok).toBe(true);

            const listed = await store.list();
            expect(listed.ok).toBe(true);
            if (!listed.ok) return;
            const byId = new Map(listed.value.map((summary) => [summary.id, summary]));
            expect(byId.get("listed")).toEqual({id: "listed", createdAt: new Date(1_000).toISOString(), title: "新标题", updatedAt: new Date(3_000).toISOString()});
            expect(byId.get("child")?.parentSession).toBe("listed");
            expect(byId.get("child")?.updatedAt).toBe(byId.get("child")?.createdAt as string);
        });

        test("场景 13：追加后改传入的对象、在监听函数里改收到的条目，日志与其它订阅者都不变，改收到的条目抛 TypeError", async () => {
            const store = await makeStore();
            const log = await opened(store);
            const input = userMessage("原文");
            const mutations: string[] = [];
            log.subscribe((event) => {
                if (event.entry.type !== "message" || event.entry.message.role !== "user") return;
                try {
                    (event.entry.message as {content: string}).content = "被监听函数改了";
                } catch (error) {
                    mutations.push(error instanceof TypeError ? "TypeError" : "其它");
                }
            });
            const other = received(log);
            const [entry] = await appended(log, [input]);
            (input.type === "message" ? (input.message as {content: string}) : {content: ""}).content = "追加后改了输入";

            expect(mutations).toEqual(["TypeError"]);
            expect(entry!.type === "message" && entry!.message.content).toBe("原文");
            expect(log.entries[0]!.type === "message" && log.entries[0]!.message.content).toBe("原文");
            expect(() => {
                (log.entries as SessionEntry[]).push(entry!);
            }).toThrow(TypeError);
            expect(other.seqs).toEqual([1]);
            const reopened = await openSession(store, log.header.id);
            expect(reopened.ok && reopened.value.entries[0]!.type === "message" && reopened.value.entries[0]!.message.content).toBe("原文");
        });
    });
}
