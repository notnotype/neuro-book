/**
 * 扩展（docs/specs/harness/extensions.md）：装配、片与归约、反应与写入批、装上、helper。测试名里的编号是 Spec 的输出条目与验收场景。
 * 都经 `createTestSession` 走真内核；假的只有模型与时钟。
 */

import {describe, expect, test} from "bun:test";
import {Type} from "typebox";
import type {LogEvent} from "../api/index.js";
import type {SessionEnv} from "../api/index.js";
import {createMemoryStore} from "../log/memory-store.js";
import {closeSession, createSession, extensionState, openSession} from "../session/session.js";
import {createTestClock} from "../testing/clock.js";
import {createTestModel} from "../testing/model.js";
import {createTestSession, defaultTestProfile} from "../testing/test-session.js";
import {opening} from "../helpers/opening.js";
import {reminder} from "../helpers/reminder.js";
import {conv, coreHistory, defineContract, defineExtension, ext, optional, shape, slice} from "./define.js";
import {defineProfile} from "./profile.js";

const types = (events: readonly LogEvent[]) => events.map((event) => event.type);
const ofType = (events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type);

describe("装配", () => {
    test("输出 1：id 不合规则、前缀与插件不符、重复、依赖缺失或成环时拒绝，列出全部问题", async () => {
        const a = defineExtension({id: "lab.a", dependsOn: [defineContract("lab.missing", {})]});
        const b1 = defineExtension({id: "lab.b"});
        const b2 = defineExtension({id: "lab.b"});
        const wrongPrefix = defineExtension({id: "other.x"});
        const bad = defineExtension({id: "Lab_Bad"});
        const failure = await createTestSession({extensions: [a, b1, b2, {extension: wrongPrefix, plugin: "lab"}, bad]}).then(() => null, (error: Error) => error.message);
        for (const code of ["dependency-missing", "duplicate-extension-id", "bad-extension-id"]) expect(failure).toContain(code);
        expect(failure).toContain("does not start with its id");
    });

    test("输出 1：依赖成环拒绝；同一个扩展装两次拒绝", async () => {
        const left: {id: string; events: {}} = {id: "lab.left", events: {}};
        const right = defineExtension({id: "lab.right", dependsOn: [left as never]});
        const leftReal = defineExtension({id: "lab.left", dependsOn: [right]});
        expect(await createTestSession({extensions: [leftReal, right]}).then(() => null, (error: Error) => error.message)).toContain("dependency-cycle");
        const once = defineExtension({id: "lab.once"});
        expect(await createTestSession({extensions: [once, once]}).then(() => null, (error: Error) => error.message)).toContain("installed twice");
    });

    test("输出 1：扩展事件与内核事件同名、片的初值不是 JSON 时拒绝（类型挡得住，这里模拟绕过类型的作者）", async () => {
        const clash = defineExtension({id: "lab.clash", events: {notice: conv()}} as never);
        const mapped = defineExtension({id: "lab.mapped", state: {seen: slice.path(new Map<string, number>())}});
        const failure = await createTestSession({extensions: [clash, mapped]}).then(() => null, (error: Error) => error.message);
        expect(failure).toContain("event-name-reserved");
        expect(failure).toContain("slice-initial-not-json");
    });

    test("输出 2：设置缺缺省值、处理函数挂在不存在的事件上、槽名不合法、提醒没有触发条件：装配照常，留诊断", async () => {
        const sloppy = defineExtension({
            id: "lab.sloppy",
            settings: Type.Object({level: Type.String()}),
            // 故意拼错的键：TypeScript 作者在编译期就会报，这里模拟 JavaScript 作者。
            on: {turnStarted: () => undefined, turnStated: () => undefined} as never,
            contribute: {"Bad Slot": {value: () => null}},
        });
        const silent = (reminder as (options: object) => never)({id: "lab.silent", text: () => "x"});
        await using session = await createTestSession({extensions: [sloppy, silent]});
        const diagnostics = await session.raw.diagnostics();
        const byCode = new Map(diagnostics.map((item) => [item.code, item]));
        expect(byCode.get("setting-missing-default")?.params).toEqual({key: "level"});
        expect(byCode.get("unknown-event-handler")?.hint).toBe("did you mean turnStarted?");
        expect(byCode.get("bad-slot-name")?.params).toEqual({slot: "Bad Slot"});
        expect(byCode.get("reminder-without-trigger")?.extension).toBe("lab.silent");
    });

    test("输出 3、14：依赖在前；同一条事件的输出按装配序写入", async () => {
        const base = defineExtension({id: "lab.z-base", events: {note: conv<{text: string}>()}, on: {turnStarted: async (_event, ctx) => ctx.emit("note", {text: "base"})}});
        const user = defineExtension({id: "lab.a-user", dependsOn: [base], events: {note: conv<{text: string}>()}, on: {turnStarted: (_event, ctx) => ctx.emit("note", {text: "user"})}});
        await using session = await createTestSession({extensions: [user, base]});
        session.model.script("好");
        const report = await session.say("你好");
        expect(report.events.filter((event) => event.type.endsWith("/note")).map((event) => event.source)).toEqual(["lab.z-base", "lab.a-user"]);
        expect(report.requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:lab.z-base/note | event:lab.a-user/note | event:input"]);
    });
});

describe("片与归约", () => {
    const counter = defineExtension({
        id: "lab.counter",
        state: {inputs: slice.path(0), seen: slice.session(0)},
        events: {bump: ext.session()},
        reduce: {
            input: (_event, state) => ({inputs: state.inputs + 1}),
            bump: (_event, state) => ({seen: state.seen + 1}),
        },
        on: {input: (_event, ctx) => ctx.emit("bump")},
    });

    test("输出 5、11：按作用域归约；处理函数在写入之后调用；重开时照日志归约、不跑反应", async () => {
        await using session = await createTestSession({extensions: [counter]});
        session.model.script("一", "二");
        await session.say("第一句");
        await session.say("第二句");
        expect(await session.state(counter)).toEqual({inputs: 2, seen: 2});
        await session.reopen();
        expect(await session.state(counter)).toEqual({inputs: 2, seen: 2});
        expect(ofType(await session.raw.log({afterSeq: 0}).then((page) => page.events), "lab.counter/bump")).toHaveLength(2);
    });

    test("输出 7：归约出错时这次补丁不用，叶子照样前进，留诊断；重开结果一样", async () => {
        const flaky = defineExtension({
            id: "lab.flaky",
            state: {n: slice.path(0)},
            reduce: {input: (event, state) => {
                if ((event.data as {text: string}).text === "坏") throw new Error("boom");
                return {n: state.n + 1};
            }},
        });
        await using session = await createTestSession({extensions: [flaky]});
        session.model.script("一", "二", "三");
        await session.say("好");
        await session.say("坏");
        await session.say("好");
        expect(await session.state(flaky)).toEqual({n: 2});
        expect((await session.raw.diagnostics()).find((item) => item.code === "reduce-threw")?.extension).toBe("lab.flaky");
        await session.reopen();
        expect(await session.state(flaky)).toEqual({n: 2});
    });

    test("输出 8：状态递归只读，改它抛错（处理函数以 threw 失败）", async () => {
        const mutating = defineExtension({id: "lab.mutating", state: {items: slice.path<string[]>([])}, on: {turnStarted: (_event, ctx) => {
            (ctx.state.items as string[]).push("x");
        }}});
        await using session = await createTestSession({extensions: [mutating]});
        session.model.script("好");
        const report = await session.say("你好");
        expect(ofType(report.events, "extensionFailed").map((event) => event.data)).toEqual([{extension: "lab.mutating", entry: "on", code: "threw", dropped: {events: 0, sets: 0}}]);
    });
});

describe("反应", () => {
    test("输出 12、13：ctx.state 不含自己这次的 set；同一片 set 多次取最后一次；值没变不写", async () => {
        const seen: number[] = [];
        const setter = defineExtension({id: "lab.setter", state: {n: slice.path(0)}, on: {turnStarted: (_event, ctx) => {
            ctx.set("n", 1);
            ctx.set("n", 2);
            seen.push(ctx.state.n);
        }, input: (_event, ctx) => ctx.set("n", 2)}});
        await using session = await createTestSession({extensions: [setter]});
        session.model.script("好");
        const report = await session.say("你好");
        expect(seen).toEqual([0]);
        expect(ofType(report.events, "lab.setter/stateSet").map((event) => event.data)).toEqual([{slice: "n", value: 2}]);
        expect(await session.state(setter)).toEqual({n: 2});
    });

    test("输出 13：抛错时整批丢弃，extensionFailed 带丢弃的条数；完成后再 emit 只留诊断", async () => {
        let later: (() => void) | null = null;
        const failing = defineExtension({id: "lab.failing", state: {n: slice.path(0)}, events: {note: conv()}, on: {
            turnStarted: (_event, ctx) => {
                ctx.emit("note", {text: "丢"});
                ctx.set("n", 5);
                throw new Error("boom");
            },
            input: (_event, ctx) => {
                later = () => ctx.emit("note", {text: "迟到"});
            },
        }});
        await using session = await createTestSession({extensions: [failing]});
        session.model.script("好");
        const report = await session.say("你好");
        expect(ofType(report.events, "extensionFailed").map((event) => event.data)).toEqual([{extension: "lab.failing", entry: "on", code: "threw", dropped: {events: 1, sets: 1}}]);
        expect(ofType(report.events, "lab.failing/note")).toHaveLength(0);
        later!();
        expect((await session.raw.diagnostics()).find((item) => item.code === "emit-after-settle")?.params).toEqual({call: "emit"});
        expect(ofType((await session.raw.log({afterSeq: 0})).events, "lab.failing/note")).toHaveLength(0);
    });

    test("输出 13：emit 没声明的事件、写不是 JSON 的值：整批丢弃，记 invalid-output", async () => {
        const wrong = defineExtension({id: "lab.wrong", events: {note: conv()}, on: {turnStarted: (_event, ctx) => {
            ctx.emit("note", {text: "好的"});
            (ctx.emit as (name: string, data: unknown) => void)("undeclared", {});
        }}});
        await using session = await createTestSession({extensions: [wrong]});
        session.model.script("好");
        const report = await session.say("你好");
        expect(ofType(report.events, "extensionFailed").map((event) => (event.data as {code: string}).code)).toEqual(["invalid-output"]);
        expect(ofType(report.events, "lab.wrong/note")).toHaveLength(0);
    });

    test("输出 13：带幂等键的 emit 同一个键只写一次，命中时不引出反应；同一批里、mount 里同步连写两次也一样，重开照常", async () => {
        let reactions = 0;
        const keyed = defineExtension({id: "lab.keyed", events: {once: ext.session(), fact: ext.session()}, on: {
            turnStarted: (_event, ctx) => {
                ctx.emit("once", undefined, {key: "only"});
                ctx.emit("once", undefined, {key: "only"});
            },
            once: () => void (reactions += 1),
        }, mount: (ctx) => {
            ctx.emit("fact", undefined, {key: "boot"});
            ctx.emit("fact", undefined, {key: "boot"});
        }});
        await using session = await createTestSession({extensions: [keyed]});
        session.model.script("一", "二");
        await session.say("第一句");
        await session.say("第二句");
        const keysOf = async (type: string) => ofType((await session.raw.log({afterSeq: 0})).events, type).map((event) => event.key);
        expect(await keysOf("lab.keyed/once")).toEqual(["only"]);
        expect(await keysOf("lab.keyed/fact")).toEqual(["boot"]);
        expect(reactions).toBe(1);
        await session.reopen();
        expect(await keysOf("lab.keyed/fact")).toEqual(["boot"]);
    });

    test("输出 14：同一条事件的处理函数并发执行、看同一份状态", async () => {
        const order: string[] = [];
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const slow = defineExtension({id: "lab.a-slow", on: {turnStarted: async () => {
            order.push("slow:start");
            await gate;
            order.push("slow:end");
        }}});
        const fast = defineExtension({id: "lab.b-fast", on: {turnStarted: () => {
            order.push("fast");
            release();
        }}});
        await using session = await createTestSession({extensions: [slow, fast]});
        session.model.script("好");
        await session.say("你好");
        expect(order).toEqual(["slow:start", "fast", "slow:end"]);
    });

    test("输出 15：反应链最多写到第 3 层，再往下写 reactionLimit", async () => {
        const echo = defineExtension({id: "lab.echo", events: {ping: ext()}, on: {
            turnStarted: (_event, ctx) => ctx.emit("ping"),
            ping: (_event, ctx) => ctx.emit("ping"),
        }});
        await using session = await createTestSession({extensions: [echo]});
        session.model.script("好");
        const report = await session.say("你好");
        expect(ofType(report.events, "lab.echo/ping").map((event) => event.depth)).toEqual([1, 2, 3]);
        expect(ofType(report.events, "reactionLimit")).toHaveLength(1);
        expect((await session.raw.diagnostics()).some((item) => item.code === "reaction-depth-limit")).toBe(true);
    });

    test("输出 16：处理函数超过时限：中止它的信号、丢弃输出、记 timeout", async () => {
        const clock = createTestClock();
        let aborted = false;
        let started: () => void = () => undefined;
        const startedPromise = new Promise<void>((resolve) => (started = resolve));
        const stuck = defineExtension({id: "lab.stuck", timeoutMs: 1_000, events: {note: conv()}, on: {turnStarted: (_event, ctx) => new Promise<void>((resolve) => {
            ctx.emit("note", {text: "不会写下"});
            started();
            ctx.signal.addEventListener("abort", () => {
                aborted = true;
                resolve();
            });
        })}});
        await using session = await createTestSession({extensions: [stuck], clock});
        session.model.script("好");
        const pending = session.say("你好");
        await startedPromise;
        await clock.advance(1_000);
        const report = await pending;
        expect(aborted).toBe(true);
        expect(ofType(report.events, "extensionFailed").map((event) => event.data)).toEqual([{extension: "lab.stuck", entry: "on", code: "timeout", dropped: {events: 1, sets: 0}}]);
    });

    test("输出 17：assistant 的处理函数 continue：写 continued 再请求一次，这一轮这个扩展到上限就不再接着", async () => {
        const writer = defineExtension({id: "lab.writer", on: {assistant: (_event, ctx) => {
            ctx.continue("请接着写。", {max: 2});
        }}});
        await using session = await createTestSession({extensions: [writer]});
        session.model.script("一段", "二段", "三段");
        const report = await session.say("写吧");
        expect(report.requests).toHaveLength(3);
        expect(ofType(report.events, "continued").map((event) => (event.data as {count: number}).count)).toEqual([1, 2]);
        expect(report.requests[2]!.outline().at(-1)).toBe("user: event:continued");
        expect(report.result.text).toBe("三段");
        expect((await session.raw.diagnostics()).some((item) => item.code === "continue-limit")).toBe(true);
    });

    test("输出 18：中止运行时不再等运行引出的反应，输出丢弃并记 aborted，运行以 aborted 收口", async () => {
        let started: () => void = () => undefined;
        const startedPromise = new Promise<void>((resolve) => (started = resolve));
        const hanging = defineExtension({id: "lab.hanging", events: {note: conv()}, on: {assistant: (_event, ctx) => {
            ctx.emit("note", {text: "不会写下"});
            started();
            return new Promise<void>(() => undefined);
        }}});
        await using session = await createTestSession({extensions: [hanging]});
        session.model.script("好");
        const sent = await session.raw.send({commandId: "c", input: {text: "你好"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await startedPromise;
        expect(await session.raw.abort({commandId: "a"})).toMatchObject({ok: true, value: {aborted: true}});
        const result = await session.raw.waitRun(sent.value.runId);
        expect(result.reason).toBe("aborted");
        const events = (await session.raw.log({afterSeq: 0})).events;
        expect(ofType(events, "extensionFailed").map((event) => event.data)).toEqual([{extension: "lab.hanging", entry: "on", code: "aborted", dropped: {events: 1, sets: 0}}]);
        expect(ofType(events, "lab.hanging/note")).toHaveLength(0);
    });
});

describe("装上", () => {
    function watcherExtension(log: string[]) {
        let notify: ((uri: string) => void) | null = null;
        const extension = defineExtension({
            id: "lab.watcher",
            events: {fileChanged: ext.session<{uri: string}>()},
            state: {changes: slice.session<string[]>([])},
            reduce: {fileChanged: (event, state) => ({changes: [...state.changes, event.data.uri]})},
            mount: (ctx) => {
                log.push("mount");
                notify = ctx.callback((uri: string) => ctx.emit("fileChanged", {uri}));
                return () => {
                    log.push("cleanup");
                };
            },
        });
        return {extension, change: (uri: string) => notify!(uri)};
    }

    test("输出 19、20、22：新建与重开时装上；空闲时的外部事实立刻写入；关闭时清理，之后回调不再调用", async () => {
        const log: string[] = [];
        const watcher = watcherExtension(log);
        const session = await createTestSession({extensions: [watcher.extension]});
        watcher.change("project://第一章.md");
        await session.raw.snapshot();
        await new Promise((resolve) => setImmediate(resolve));
        expect(await session.state(watcher.extension)).toEqual({changes: ["project://第一章.md"]});
        await session.reopen();
        expect(log).toEqual(["mount", "cleanup", "mount"]);
        expect(await session.state(watcher.extension)).toEqual({changes: ["project://第一章.md"]});
        await session.close();
        watcher.change("project://第二章.md");
        expect(log).toEqual(["mount", "cleanup", "mount", "cleanup"]);
    });

    test("输出 20：运行中到达的外部事实排到下一个边界写入", async () => {
        const log: string[] = [];
        const watcher = watcherExtension(log);
        const trigger = defineExtension({id: "lab.trigger", on: {turnStarted: () => watcher.change("project://运行中.md")}});
        await using session = await createTestSession({extensions: [watcher.extension, trigger]});
        session.model.script("好");
        const report = await session.say("你好");
        const order = types(report.events);
        expect(order.indexOf("lab.watcher/fileChanged")).toBeLessThan(order.indexOf("modelStarted"));
        expect(order.indexOf("lab.watcher/fileChanged")).toBeGreaterThan(order.indexOf("turnStarted"));
    });

    test("输出 22：ctx.callback 包的回调出错只留诊断，不成为没人接的拒绝", async () => {
        let fire: () => void = () => undefined;
        const noisy = defineExtension({id: "lab.noisy", mount: (ctx) => {
            fire = ctx.callback(async () => {
                throw new Error("watcher failed");
            });
        }});
        await using session = await createTestSession({extensions: [noisy]});
        fire();
        await new Promise((resolve) => setImmediate(resolve));
        expect((await session.raw.diagnostics()).find((item) => item.code === "handler-threw" && item.extension === "lab.noisy")?.cause?.message).toBe("watcher failed");
    });

    test("输出 21：mount 超时或抛错：记 extensionFailed，这个扩展不再派发，会话照常", async () => {
        const clock = createTestClock();
        let reacted = 0;
        const stuck = defineExtension({id: "lab.stuck-mount", mount: () => new Promise<void>(() => undefined), on: {turnStarted: () => void (reacted += 1)}});
        const broken = defineExtension({id: "lab.broken-mount", mount: () => {
            throw new Error("no service");
        }, on: {turnStarted: () => void (reacted += 1)}});
        const creating = createTestSession({extensions: [stuck, broken], clock});
        await new Promise((resolve) => setImmediate(resolve));
        await clock.advance(30_000);
        await using session = await creating;
        session.model.script("好");
        await session.say("你好");
        expect(reacted).toBe(0);
        const failures = ofType((await session.raw.log({afterSeq: 0})).events, "extensionFailed").map((event) => event.data);
        expect(failures).toEqual([{extension: "lab.broken-mount", entry: "mount", code: "threw"}, {extension: "lab.stuck-mount", entry: "mount", code: "timeout"}]);
    });
});

describe("读取与设置", () => {
    const tasks = defineContract("lab.tasks", {exports: shape<{open: number}>()});
    const tasksImpl = defineExtension({id: "lab.tasks", state: {open: slice.path(3)}, exports: {open: (state) => state.open}});

    test("输出 24、25：read 只读依赖与 core.history，可选依赖没装为 undefined；设置是缺省值加覆盖", async () => {
        const seen: unknown[] = [];
        const reader = defineExtension({
            id: "lab.reader",
            dependsOn: [tasks, optional(defineContract("lab.absent", {exports: shape<{x: number}>()}))],
            settings: Type.Object({mode: Type.Union([Type.Literal("full"), Type.Literal("off")], {default: "full"})}),
            on: {turnStarted: (_event, ctx) => {
                seen.push(ctx.read(tasks).open, ctx.read(coreHistory).turns, ctx.settings.mode);
                seen.push((ctx.read as (dependency: unknown) => unknown)(defineContract("lab.absent", {})));
            }},
        });
        await using session = await createTestSession({extensions: [tasksImpl, reader]});
        session.model.script("好");
        await session.say("你好");
        expect(seen).toEqual([3, 0, "full", undefined]);
    });
});

describe("helper", () => {
    test("reminder：值变了的那一轮提醒；第一次 text 返回 null 不写但记下值", async () => {
        let switchTo: (to: "normal" | "plan") => void = () => undefined;
        const mode = defineExtension({
            id: "lab.mode",
            state: {mode: slice.session<"normal" | "plan">("normal")},
            events: {switch: ext.session<{to: "normal" | "plan"}>()},
            reduce: {switch: (event) => ({mode: event.data.to})},
            exports: {mode: (state) => state.mode},
            mount: (ctx) => {
                switchTo = ctx.callback((to: "normal" | "plan") => ctx.emit("switch", {to}));
            },
        });
        const remind = reminder({id: "lab.mode.reminder", dependsOn: [mode], watch: ({read}) => read(mode).mode, text: ({value, first}) => (value === "plan" ? "计划模式" : first ? null : "退出计划模式")});
        await using session = await createTestSession({extensions: [mode, remind]});
        session.model.script("1", "2", "3", "4");
        const texts: string[][] = [];
        const say = async (input: string) => texts.push(ofType((await session.say(input)).events, "lab.mode.reminder/reminder").map((event) => (event.data as {text: string}).text));
        await say("a");
        switchTo("plan");
        await new Promise((resolve) => setImmediate(resolve));
        await say("b");
        await say("c");
        switchTo("normal");
        await new Promise((resolve) => setImmediate(resolve));
        await say("d");
        expect(texts).toEqual([[], ["计划模式"], [], ["退出计划模式"]]);
    });

    test("reminder：watch 返回不是 JSON 的值时写 handler-threw 诊断，不悄悄当成 null", async () => {
        const watching = reminder({id: "lab.watch.set", watch: () => new Set([1]) as never, text: () => "变了"});
        await using session = await createTestSession({extensions: [watching]});
        session.model.script("1");
        await session.say("a");
        expect((await session.raw.diagnostics()).filter((item) => item.code === "handler-threw").map((item) => item.extension)).toEqual(["lab.watch.set"]);
    });

    test("reminder：every 轮提醒一次", async () => {
        const every = reminder({id: "lab.every", every: 2, text: ({first}) => (first ? "第一次" : "又到了")});
        await using session = await createTestSession({extensions: [every]});
        session.model.script("1", "2", "3", "4");
        const texts: string[] = [];
        for (const input of ["a", "b", "c", "d"]) {
            const report = await session.say(input);
            texts.push(...ofType(report.events, "lab.every/reminder").map((event) => (event.data as {text: string}).text));
        }
        expect(texts).toEqual(["第一次", "又到了"]);
    });

    test("opening：会话创建时读一次，交给 opening 槽，缺省布局放在历史前面", async () => {
        const profile = defineProfile({
            id: "test.opening",
            version: "1",
            name: "o",
            description: "o",
            initial: Type.Object({chapter: Type.String()}),
            extensions: [opening({id: "test.opening.parts", initial: Type.Object({chapter: Type.String()}), load: ({initial}) => [`本章是 ${initial.chapter}。`, null, "参考：人物表"]})],
        });
        await using session = await createTestSession({profile, initial: {chapter: "第三章"}});
        session.model.script("好");
        const report = await session.say("续写");
        expect(report.requests[0]!.outline()).toEqual(["user: slot:opening@test.opening.parts", "user: event:input"]);
        expect(report.requests[0]!.raw.messages[0]!.content[0]).toMatchObject({text: "本章是 第三章。\n\n参考：人物表"});
    });
});

describe("扩展事件的版本（session.md 输出 14）", () => {
    test("插件降级后打开新日志：高版本的事件留在日志里，归约跳过，留诊断", async () => {
        const store = createMemoryStore();
        const env = (extension: ReturnType<typeof defineExtension>): SessionEnv => ({
            store,
            profiles: {resolve: (key) => (key === defaultTestProfile.id ? defaultTestProfile : undefined)},
            extensions: () => [{extension, plugin: null}],
            models: createTestModel().port,
            tools: {declarations: () => [], create: () => Promise.reject(new Error("no tools"))},
            resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
            sessions: {get: () => Promise.reject(new Error("no sessions"))},
            clock: createTestClock(),
            approve: async () => ({verdict: "allow", by: "test-policy"}),
        });
        const declare = (version: number) => defineExtension({id: "lab.versioned", version: String(version), events: {mark: ext.session({version})}, state: {marks: slice.session(0)}, reduce: {mark: (_event, state) => ({marks: state.marks + 1})}, mount: (ctx) => ctx.emit("mark")});
        const created = await createSession(env(declare(2)), {profile: defaultTestProfile.id, id: "versioned"});
        if (!created.ok) throw new Error(created.code);
        expect(extensionState(created.value, "lab.versioned")).toEqual({marks: 1});
        await closeSession(created.value);
        const opened = await openSession(env(declare(1)), "versioned");
        if (!opened.ok) throw new Error(opened.code);
        // 降级后的 mount 又写了一条版本 1 的：只有它被归约。
        expect(extensionState(opened.value, "lab.versioned")).toEqual({marks: 1});
        expect((await opened.value.diagnostics()).find((item) => item.code === "event-version-unsupported")?.params).toEqual({version: 2, declared: 1});
        expect(ofType((await opened.value.log({afterSeq: 0})).events, "lab.versioned/mark").map((event) => event.version)).toEqual([2, 1]);
        await closeSession(opened.value);
    });
});
