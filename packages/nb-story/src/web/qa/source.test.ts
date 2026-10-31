/**
 * 问答页的数据源：记录与运行怎么接、看着运行结束后重读、断线按退避重连且不闪、基于旧记录的运行不接、换对话后旧的
 * 回调不再生效。客户端是按合同（contract.ts 的 `qa.get` 与 `QaFrame`）写的替身；真实的服务与推送见
 * src/server/qa.test.ts，页面里的整条链路见 e2e。
 */

import {describe, expect, test} from "bun:test";

import {QA_FIRST_TURN_RUNNING, QA_FIRST_TURN_UNSAVED, type QaFrame, type QaRecordView, type QaRunView, type ViewerResult} from "../../contract/contract";
import {StoryCallError, type QaSubscriber, type StoryClient} from "../host/client";
import {createQaSource, retryDelay, type QaSourceState} from "./source";

const AT = "2026-10-23T08:00:00.000Z";
const entry = (seq: number, kind: string, fields: Record<string, unknown> = {}) => ({seq, at: AT, kind, ...fields});
const userEntry = (seq: number, text: string) => entry(seq, "agent_message", {message: {role: "user", content: text, timestamp: seq}});
const replyEntry = (seq: number, text: string) => entry(seq, "agent_message", {message: {role: "assistant", content: [{type: "text", text}], model: "m", stopReason: "stop", timestamp: seq}});
const snapshotEntry = (seq: number) => entry(seq, "session_snapshot", {profile: {key: "story-qa", version: "2"}, initial: {}, tools: []});

const turn = (question: string, logFrom: number) => ({question, status: "answered" as const, answer: null, reply: {text: "答", truncated: false, unverifiedRefs: []}, error: null, chaptersRead: [], rejections: 0, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, complete: true}, ms: 1, model: "m", startedAt: AT, logFrom});
const record = (turns: QaRecordView["turns"]): QaRecordView => ({id: "c", at: {chapter: 38, paragraph: 57}, mode: "graph", answer: "markdown", maxChapters: 20, turns, startedAt: AT});
const run = (fields: Partial<QaRunView> = {}): QaRunView => ({runId: "r1", conversation: "c", turn: 2, baseTurns: 1, baseChanges: 0, logFrom: 4, question: "追问", at: {chapter: 38, paragraph: 57}, mode: "graph", model: "test/m", startedAt: AT, state: "running", result: null, saved: null, ...fields});

/** 第一轮：快照、提问、回复。 */
const FIRST = [snapshotEntry(1), userEntry(2, "第一问"), replyEntry(3, "第一答")];
type Got = ViewerResult<"qa.get">;
const got = (fields: Partial<Got> = {}): Got => ({record: record([turn("第一问", 1)]), log: {ok: true, entries: FIRST}, continuable: {ok: true}, run: null, ...fields});

function harness(gets: (Got | Error)[]) {
    const subscribers: {subscriber: QaSubscriber; closed: boolean}[] = [];
    const timers: {ms: number; run: () => void; cancelled: boolean}[] = [];
    const states: QaSourceState[] = [];
    let gets_ = 0;
    const client: StoryClient = {
        async call(method) {
            if (method !== "qa.get") throw new Error(`不该调用 ${method}`);
            gets_ += 1;
            const next = gets.shift();
            if (next === undefined) throw new Error("qa.get 的脚本用完了");
            if (next instanceof Error) throw next;
            return next as never;
        },
        subscribe(_book, _conversation, subscriber) {
            const item = {subscriber, closed: false};
            subscribers.push(item);
            return {close: () => void (item.closed = true)};
        },
    };
    const source = createQaSource({
        client,
        book: "fox",
        conversation: "c",
        onChange: state => states.push(state),
        // 帧合并同步做：测试按帧断言。
        schedule: flush => flush(),
        setTimer: (run, ms) => {
            const timer = {ms, run, cancelled: false};
            timers.push(timer);
            return () => void (timer.cancelled = true);
        },
    });
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const send = (frame: QaFrame) => subscribers.at(-1)!.subscriber.frame(frame);
    return {source, subscribers, timers, states, settle, send, gets: () => gets_};
}

const texts = (state: QaSourceState) => state.messages.map(message => (message.kind === "user" ? `问:${(message.blocks[0] as {text: string}).text}${message.delivery === "pending" ? "（待）" : ""}` : message.kind === "assistant" ? `答:${message.text}` : message.kind));

describe("记录与运行", () => {
    test("没有运行：只按记录与日志显示，不订阅", async () => {
        const h = harness([got()]);
        await h.settle();
        expect(h.source.state()).toMatchObject({phase: "ready", detached: false, logProblem: null});
        expect(texts(h.source.state())).toEqual(["问:第一问", "答:第一答"]);
        expect(h.subscribers).toHaveLength(0);
    });

    test("运行中：订阅，先放乐观的提问，日志与事件到了接在记录后面；看着它结束就重读、不再订阅", async () => {
        const h = harness([got({run: run()}), got({record: record([turn("第一问", 1), turn("追问", 4)]), log: {ok: true, entries: [...FIRST, userEntry(4, "追问"), replyEntry(5, "追答")]}, run: run({state: "ended", saved: {ok: true}})})]);
        await h.settle();
        expect(h.subscribers).toHaveLength(1);
        expect(texts(h.source.state())).toEqual(["问:第一问", "答:第一答", "问:追问（待）"]);

        h.send({type: "snapshot", run: run(), entries: []});
        h.send({type: "log", runId: "r1", entries: [userEntry(4, "追问")]});
        h.send({type: "event", runId: "r1", event: {type: "message_start", message: {role: "assistant", content: [{type: "text", text: "正在"}], timestamp: 9}}});
        expect(texts(h.source.state())).toEqual(["问:第一问", "答:第一答", "问:追问", "答:正在"]);
        // 别的运行的帧不算。
        h.send({type: "log", runId: "r0", entries: [replyEntry(99, "旧的")]});
        expect(texts(h.source.state())).toHaveLength(4);

        h.send({type: "ended", run: run({state: "ended", saved: {ok: true}})});
        h.subscribers[0]!.subscriber.end("closed");
        await h.settle();
        expect(h.gets()).toBe(2);
        expect(texts(h.source.state())).toEqual(["问:第一问", "答:第一答", "问:追问", "答:追答"]);
        expect(h.subscribers).toHaveLength(1);
    });

    test("读的时候在跑、订阅时已经结束并保存：重读一次，之后不再订阅；重读到的运行已保存就不再管它", async () => {
        const saved = run({state: "ended", saved: {ok: true}});
        const h = harness([got({run: run()}), got({record: record([turn("第一问", 1), turn("追问", 4)]), log: {ok: true, entries: [...FIRST, userEntry(4, "追问"), replyEntry(5, "追答")]}, run: saved})]);
        await h.settle();
        h.send({type: "snapshot", run: saved, entries: []});
        h.subscribers[0]!.subscriber.end("closed");
        await h.settle();
        expect(h.gets()).toBe(2);
        expect(h.subscribers).toHaveLength(1);
        expect(texts(h.source.state())).toEqual(["问:第一问", "答:第一答", "问:追问", "答:追答"]);
    });

    test("看着它结束并保存、重读回来之前：这一轮照样接在记录后面，提问 id 不变", async () => {
        // 重读的 qa.get 还没回（脚本里只有第一次的结果，第二次会抛错，但检查在它之前）。
        const h = harness([got({run: run()})]);
        await h.settle();
        h.send({type: "snapshot", run: run(), entries: [userEntry(4, "追问"), replyEntry(5, "追答")]});
        const ids = () => h.source.state().messages.map(message => message.id);
        const before = ids();
        expect(before).toContain("q:c:2");
        h.send({type: "ended", run: run({state: "ended", saved: {ok: true}})});
        expect(ids()).toEqual(before);
    });

    test("首轮运行中读到的“还在运行”：看着它结束并保存，重读回来之前就不再说不能续问（issue 269）", async () => {
        const first = run({turn: 1, baseTurns: 0, logFrom: 1, question: "第一问"});
        // 重读的 qa.get 没有回（脚本里只有第一次的结果）：横幅与输入框此刻看到的就是 ended 帧之后的状态。
        const h = harness([got({record: null, log: {ok: true, entries: []}, continuable: {ok: false, reason: QA_FIRST_TURN_RUNNING}, run: first})]);
        await h.settle();
        expect(h.source.state().continuable).toEqual({ok: false, reason: QA_FIRST_TURN_RUNNING});
        h.send({type: "snapshot", run: first, entries: []});
        h.send({type: "ended", run: {...first, state: "ended", saved: {ok: true}}});
        expect(h.source.state().continuable).toEqual({ok: true});
    });

    test("首轮运行中读到的“还在运行”：看着它结束但没保存，换成没保存的原因", async () => {
        const first = run({turn: 1, baseTurns: 0, logFrom: 1, question: "第一问"});
        const h = harness([got({record: null, log: {ok: true, entries: []}, continuable: {ok: false, reason: QA_FIRST_TURN_RUNNING}, run: first})]);
        await h.settle();
        h.send({type: "snapshot", run: first, entries: []});
        h.send({type: "ended", run: {...first, state: "ended", saved: {ok: false, reason: "write_failed", message: "磁盘满"}}});
        expect(h.source.state().continuable).toEqual({ok: false, reason: QA_FIRST_TURN_UNSAVED});
    });

    test("追问结束：已有记录的对话本来就能续问，结束帧不改 continuable", async () => {
        const h = harness([got({run: run()})]);
        await h.settle();
        h.send({type: "snapshot", run: run(), entries: []});
        h.send({type: "ended", run: run({state: "ended", saved: {ok: false, reason: "write_failed", message: "磁盘满"}})});
        expect(h.source.state().continuable).toEqual({ok: true});
    });

    test("运行基于较早的记录（命令行先保存了一轮）：不接进来，标为 detached", async () => {
        const h = harness([got({record: record([turn("第一问", 1), turn("命令行的", 4)]), run: run({baseTurns: 1})})]);
        await h.settle();
        expect(h.source.state().detached).toBe(true);
        expect(h.subscribers).toHaveLength(0);
    });

    test("运行开始后位置被别处改了（轮数没变，位置改动次数变了）：不接进来，标为 detached", async () => {
        const h = harness([got({record: {...record([turn("第一问", 1)]), currentAt: {chapter: 20, paragraph: 3}, positionChanges: 1}, run: run({baseChanges: 0})})]);
        await h.settle();
        expect(h.source.state().detached).toBe(true);
        expect(h.subscribers).toHaveLength(0);
    });

    test("结束了但没保存的首轮：没有记录，订阅一次拿它的条目显示", async () => {
        const ended = run({turn: 1, baseTurns: 0, logFrom: 1, question: "第一问", state: "ended", saved: {ok: false, reason: "write_failed", message: "磁盘满"}});
        const h = harness([got({record: null, log: {ok: true, entries: []}, continuable: {ok: false, reason: "第一轮没有保存，不能续问"}, run: ended})]);
        await h.settle();
        expect(h.source.state().detached).toBe(false);
        h.send({type: "snapshot", run: ended, entries: FIRST});
        h.subscribers[0]!.subscriber.end("closed");
        await h.settle();
        expect(texts(h.source.state())).toEqual(["问:第一问", "答:第一答"]);
        expect(h.gets()).toBe(1);
    });

    test("第二轮开始前就停了（日志里只有 run_end）：第一轮的回复不被改成已停止，第二轮单独显示", async () => {
        const stoppedTurn = {...turn("第二问", 4), status: "interrupted" as const, reply: null};
        const h = harness([got({record: record([turn("第一问", 1), stoppedTurn]), log: {ok: true, entries: [...FIRST, entry(4, "run_end", {stopReason: "aborted", error: null})]}})]);
        await h.settle();
        expect(h.source.state().messages.map(message => [message.kind, message.kind === "assistant" ? message.status : ""])).toEqual([["user", ""], ["assistant", "done"], ["user", ""], ["assistant", "stopped"]]);
    });

    test("日志读不成：只按记录显示", async () => {
        const h = harness([got({log: {ok: false, problem: "会话日志不在了"}, continuable: {ok: false, reason: "会话日志不在了"}})]);
        await h.settle();
        expect(h.source.state().logProblem).toBe("会话日志不在了");
        expect(h.source.state().messages.map(message => message.kind)).toEqual(["user", "assistant"]);
    });
});

describe("断线与换对话", () => {
    test("推送断开：按 1、2、4… 秒退避重连；同一个运行还在跑就沿用原来的转录，已画的消息对象不变", async () => {
        const h = harness([got({run: run()}), new StoryCallError("network", "连不上"), got({run: run()})]);
        await h.settle();
        h.send({type: "snapshot", run: run(), entries: [userEntry(4, "追问")]});
        const before = h.source.state().messages;
        h.subscribers[0]!.subscriber.end("dropped");
        expect(h.timers.map(timer => timer.ms)).toEqual([1000]);
        h.timers[0]!.run();
        await h.settle();
        // 重读也连不上：再等更久。
        expect(h.timers.map(timer => timer.ms)).toEqual([1000, 2000]);
        h.timers[1]!.run();
        await h.settle();
        expect(h.subscribers).toHaveLength(2);
        h.send({type: "snapshot", run: run(), entries: [userEntry(4, "追问"), replyEntry(5, "接着")]});
        const after = h.source.state().messages;
        expect(after.slice(0, before.length).every((message, index) => message === before[index])).toBe(true);
        expect(texts(h.source.state()).at(-1)).toBe("答:接着");
        expect([0, 1, 2, 3, 4, 5].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    });

    test("推送一连上就断（qa.get 照常成功）：重连间隔照样 1、2、4 秒变长；收到快照才清零", async () => {
        const h = harness([got({run: run()}), got({run: run()}), got({run: run()}), got({run: run()})]);
        await h.settle();
        for (let round = 0; round < 3; round += 1) {
            h.subscribers.at(-1)!.subscriber.end("dropped");
            h.timers.at(-1)!.run();
            await h.settle();
        }
        expect(h.timers.map(timer => timer.ms)).toEqual([1000, 2000, 4000]);
        h.send({type: "snapshot", run: run(), entries: []});
        h.subscribers.at(-1)!.subscriber.end("dropped");
        expect(h.timers.at(-1)!.ms).toBe(1000);
    });

    test("dispose 之后，晚到的读取结果与帧都不再生效", async () => {
        const h = harness([got({run: run()})]);
        await h.settle();
        const seen = h.states.length;
        h.source.dispose();
        expect(h.subscribers[0]!.closed).toBe(true);
        h.send({type: "log", runId: "r1", entries: [userEntry(4, "追问")]});
        h.subscribers[0]!.subscriber.end("dropped");
        expect(h.states).toHaveLength(seen);
        expect(h.timers).toHaveLength(0);
    });

    test("对话读不到（被删了）：给出失败的码", async () => {
        const h = harness([new StoryCallError("qa_record_not_found", "没有问答记录 c")]);
        await h.settle();
        expect(h.source.state()).toMatchObject({phase: "failed", error: {code: "qa_record_not_found"}});
    });
});
