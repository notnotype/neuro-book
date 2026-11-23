/**
 * 提供方的合同测试（docs/specs/workbench/background-tasks.md 输出 18–24、26 的服务端部分、27，验收 7–9）：真实服务端入口与经 JSON
 * 编解码的远程链路；测试插件经真实的按调用方门面登记成提供方，窗口经远程合同读行、订阅与停止。推送的合并与停止的等待按手动时钟推进。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createTasksCore} from "./backend/core";
import {PROVIDER_ROW_LIMIT, STOP_WAIT_MS} from "./backend/providers";
import {PUSH_INTERVAL_MS} from "./backend/remote";
import type {OwnPayload, ProvidedRow, RowGroup, RowsPayload, StopOutcome, TaskProvider} from "./shared/contracts";
import {tasksWorld} from "./testing/world";
import type {TasksClient, TasksWorld} from "./testing/world";

let root = "";
let counter = 0;
const worlds: TasksWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-tasks", "providers");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function world(): Promise<TasksWorld> {
    counter += 1;
    const created = await tasksWorld(join(root, `world-${String(counter)}`));
    worlds.push(created);
    return created;
}

function value<T>(result: {readonly ok: true; readonly value: T} | {readonly ok: false; readonly code: string}): T {
    if (!result.ok) throw new Error(`remote call failed: ${result.code}`);
    return result.value;
}

const value_ = value;

function diagnostics(w: TasksWorld, event: string): unknown[] {
    return w.settings.diagnostics("hub").query({}).records.filter((record) => record.event === event);
}

/** 一个可以从测试里改行、看停止调用的提供方。`stop` 的结果由 `answer` 定（缺省已受理）。 */
function provider(initial: readonly ProvidedRow[] = []) {
    let rows: readonly ProvidedRow[] = initial;
    let notify: (() => void) | null = null;
    const state = {
        stops: [] as {readonly row: string; readonly signal: AbortSignal}[],
        unsubscribed: 0,
        answer: (_row: string, _signal: AbortSignal): Promise<StopOutcome> => Promise.resolve({kind: "accepted"}),
        throwOnRows: false,
    };
    const value: TaskProvider = {
        rows: () => {
            if (state.throwOnRows) throw new Error("rows broke");
            return rows;
        },
        subscribe: (listener) => {
            notify = listener;
            return () => {
                state.unsubscribed += 1;
            };
        },
        stop: (row, signal) => {
            state.stops.push({row, signal});
            return state.answer(row, signal);
        },
    };
    return {
        value,
        state,
        set(next: readonly ProvidedRow[]) {
            rows = next;
            notify?.();
        },
    };
}

const row = (id: string, over: Partial<ProvidedRow> = {}): ProvidedRow => ({
    id,
    title: `行 ${id}`,
    state: "running",
    kind: "work",
    kindLabel: "工作",
    form: "once",
    owner: {kind: "app"},
    startedAt: 1_000,
    stoppable: true,
    ...over,
});

const ALL = {project: null, all: true} as const;

async function rows(client: TasksClient, filter: {readonly project: string | null; readonly all: boolean} = ALL): Promise<RowsPayload> {
    return value(await client.rows(filter));
}

const keys = (payload: RowsPayload): string[] => payload.groups.flatMap((group) => [...(group.kind === "session" && group.head !== null ? [group.head.key] : []), ...group.rows.map((item) => item.key)]);
const titles = (payload: RowsPayload): unknown[] => payload.groups.flatMap((group) => [...(group.kind === "session" && group.head !== null ? [group.head.title] : []), ...group.rows.map((item) => item.title)]);

describe("提供方登记（输出 18、19）", () => {
    test("一个调用方同一时刻一个；撤回之后可以再登记，键换了代次；种类盖上插件前缀", async () => {
        const w = await world();
        const client = await w.window("a");
        const a = await w.owner("a");
        const first = provider([row("1")]);
        const revoke = a.tasks.provide(first.value);
        expect(() => a.tasks.provide(provider().value)).toThrow(TypeError);
        const before = await rows(client);
        expect(before.groups).toMatchObject([{kind: "app", rows: [{kind: "test.tasks-owner-a.work", kindLabel: "工作", source: {kind: "provider", plugin: "test.tasks-owner-a"}}]}]);
        revoke();
        revoke();
        expect(keys(await rows(client))).toEqual([]);
        const second = provider([row("1")]);
        a.tasks.provide(second.value);
        const after = await rows(client);
        expect(keys(after)).toHaveLength(1);
        expect(keys(after)[0]).not.toBe(keys(before)[0]);
        // 同一个调用方、同 id 的行：旧一代的键停不到新一代（验收 7）。
        expect(await client.stop({key: keys(before)[0]!})).toMatchObject({ok: false, code: "row-gone"});
        expect(second.state.stops).toEqual([]);
    });

    test("不合格的行逐行丢掉、记诊断；同 id 留第一个；打开别人的命令不收", async () => {
        const w = await world();
        const client = await w.window("a");
        const a = await w.owner("a");
        a.tasks.provide(provider([
            row("ok"),
            row("ok", {title: "重复"}),
            row("bad-kind", {kind: "Work"}),
            row("bad-state", {state: "paused" as ProvidedRow["state"]}),
            row("foreign-open", {open: {command: "nbook.agent.focus-session"}}),
            row("own-open", {open: {command: "test.tasks-owner-a.open", args: {id: "1"}}}),
            row("huge", {message: "长".repeat(500), kindLabel: "长".repeat(200), title: {"zh-CN": "长".repeat(400), "en-US": "x".repeat(400)}}),
        ]).value);
        const payload = await rows(client);
        expect(titles(payload).sort()).toEqual(["行 ok", "行 own-open"]);
        expect(diagnostics(w, "tasks.provider-row-invalid")).toHaveLength(4);
    });

    test("时刻超出 Date 能表示的范围、按发出去的样子超过 2 KiB 的行丢掉；同一行同一原因只记一次诊断", async () => {
        const w = await world();
        const client = await w.window("a");
        const p = provider([row("ok"), row("far", {startedAt: 1e16}), row("big", {message: "长".repeat(500), kindLabel: "种".repeat(200)})]);
        (await w.owner("a")).tasks.provide(p.value);
        expect(titles(await rows(client))).toEqual(["行 ok"]);
        for (let round = 0; round < 3; round += 1) {
            p.set([row("ok", {message: `第 ${String(round)} 次`}), row("far", {startedAt: 1e16}), row("big", {message: "长".repeat(500), kindLabel: "种".repeat(200)})]);
            await rows(client);
        }
        expect(diagnostics(w, "tasks.provider-row-invalid").map((record) => (record as {data: {row: string}}).data.row).sort()).toEqual(["big", "far"]);
    });

    test("取某一行的字段时抛错：当作这一家出错，行清空、记一次诊断，别家照常", async () => {
        const w = await world();
        const client = await w.window("a");
        const bad = provider([row("b1")]);
        (await w.owner("bad")).tasks.provide(bad.value);
        (await w.owner("good")).tasks.provide(provider([row("g1")]).value);
        expect(keys(await rows(client))).toHaveLength(2);
        bad.set([Object.defineProperty({...row("b2")}, "title", {get: () => {
            throw new Error("getter broke");
        }}) as ProvidedRow]);
        expect(titles(await rows(client))).toEqual(["行 g1"]);
        expect(diagnostics(w, "tasks.provider-failed")).toHaveLength(1);
    });

    test("一家超过 100 行的只计数：列出 100 行，其余计进 more 与后台工作的件数，诊断记一次", async () => {
        const w = await world();
        const client = await w.window("a");
        const many = (round: number) => Array.from({length: 150}, (_, index) => row(`r${String(index)}`, {message: `第 ${String(round)} 轮`}));
        const p = provider(many(0));
        (await w.owner("a")).tasks.provide(p.value);
        const payload = await rows(client);
        expect(keys(payload)).toHaveLength(PROVIDER_ROW_LIMIT);
        expect(payload.more).toBe(50);
        expect(value(await client.own({})).background.count).toBe(150);
        p.set(many(1));
        await rows(client);
        expect(diagnostics(w, "tasks.provider-rows-capped")).toHaveLength(1);
    });

    test("start 的归属：不给是应用，不合格或带 open 同步抛 TypeError", async () => {
        const w = await world();
        expect(w.tasks.start({title: "应用的"}).id).toBeString();
        expect(() => w.tasks.start({title: "坏", owner: {kind: "project", project: "", title: "雾港"}})).toThrow(TypeError);
        expect(() => w.tasks.start({title: "坏", owner: {kind: "session", session: "s1", title: "会话", open: {command: "x.y"}} as never})).toThrow(TypeError);
        const client = await w.window("a");
        expect(value(await client.own({})).tasks.map((task) => task.owner)).toEqual([{kind: "app"}]);
    });

    test("一家超过 100 行：先留在跑与等用户的，结束的按结束时刻新到旧补满", async () => {
        const w = await world();
        const client = await w.window("a");
        const a = await w.owner("a");
        const ended = Array.from({length: PROVIDER_ROW_LIMIT}, (_, index) => row(`e${String(index)}`, {state: "succeeded", endedAt: 10_000 + index}));
        a.tasks.provide(provider([...ended, row("live"), row("wait", {state: "waiting"})]).value);
        const listed = keys(await rows(client));
        expect(listed).toHaveLength(PROVIDER_ROW_LIMIT);
        expect(listed.some((key) => key.endsWith(":live"))).toBe(true);
        expect(listed.some((key) => key.endsWith(":wait"))).toBe(true);
        expect(listed.some((key) => key.endsWith(":e0"))).toBe(false);
        expect(listed.some((key) => key.endsWith(`:e${String(PROVIDER_ROW_LIMIT - 1)}`))).toBe(true);
    });
});

describe("隔离与撤回（输出 20、21，验收 7、8）", () => {
    test("一家 rows() 抛错只清它自己的行，诊断只记一次；别家照常更新", async () => {
        const w = await world();
        const client = await w.window("a");
        const bad = provider([row("b1")]);
        const good = provider([row("g1")]);
        (await w.owner("bad")).tasks.provide(bad.value);
        (await w.owner("good")).tasks.provide(good.value);
        expect(keys(await rows(client))).toHaveLength(2);
        bad.state.throwOnRows = true;
        bad.set([row("b2")]);
        good.set([row("g2")]);
        expect(titles(await rows(client))).toEqual(["行 g2"]);
        bad.set([row("b3")]);
        await rows(client);
        expect(diagnostics(w, "tasks.provider-failed")).toHaveLength(1);
        bad.state.throwOnRows = false;
        bad.set([row("b4")]);
        expect(titles(await rows(client)).sort()).toEqual(["行 b4", "行 g2"]);
    });

    test("登记方的入口停止：行没了、退订，旧的 notify 不起作用；旧一代的键停不到新一代", async () => {
        const w = await world();
        const client = await w.window("a");
        const owner = await w.owner("a");
        const old = provider([row("1")]);
        owner.tasks.provide(old.value);
        const [oldKey] = keys(await rows(client));
        await owner.stop();
        expect(old.state.unsubscribed).toBe(1);
        expect(keys(await rows(client))).toEqual([]);
        const again = await w.owner("a2");
        const fresh = provider([row("1")]);
        again.tasks.provide(fresh.value);
        expect(await client.stop({key: oldKey!})).toMatchObject({ok: false, code: "row-gone"});
        expect(fresh.state.stops).toEqual([]);
    });
});

describe("撤回推一次（输出 21）", () => {
    test("撤回之后没有别的变化，订阅也收到去掉这一家的那一份", async () => {
        const w = await world();
        const client = await w.window("a");
        const seen: RowsPayload[] = [];
        expect((await client.events.rowsChanged.subscribe(ALL, (payload) => void seen.push(payload))).ok).toBe(true);
        const revoke = (await w.owner("a")).tasks.provide(provider([row("1")]).value);
        await waitUntil("推到这一行", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return seen.at(-1) !== undefined && keys(seen.at(-1)!).length === 1;
        });
        revoke();
        await waitUntil("推到去掉之后的那一份", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return keys(seen.at(-1)!).length === 0;
        });
    });
});

describe("停止（输出 24，验收 9）", () => {
    test("按最新读到的行查键：提供方刚去掉的行，窗口手里的旧键得 row-gone，不转给提供方", async () => {
        const w = await world();
        const client = await w.window("a");
        const p = provider([row("1")]);
        (await w.owner("a")).tasks.provide(p.value);
        const [key] = keys(await rows(client));
        p.set([]);
        expect(await client.stop({key: key!})).toMatchObject({ok: false, code: "row-gone"});
        expect(p.state.stops).toEqual([]);
    });

    test("交回提供方的结果：已受理、被拒带原因；不可停的得 not-stoppable，没有的行得 row-gone", async () => {
        const w = await world();
        const client = await w.window("a");
        const p = provider([row("go"), row("no"), row("fixed", {stoppable: false})]);
        p.state.answer = (id) => Promise.resolve(id === "no" ? {kind: "rejected", reason: "已经结束"} : {kind: "accepted"});
        (await w.owner("a")).tasks.provide(p.value);
        const keyOf = async (id: string) => keys(await rows(client)).find((key) => key.endsWith(`:${id}`))!;
        expect(value(await client.stop({key: await keyOf("go")}))).toEqual({outcome: "accepted"});
        expect(value(await client.stop({key: await keyOf("no")}))).toEqual({outcome: "rejected", reason: "已经结束"});
        expect(await client.stop({key: await keyOf("fixed")})).toMatchObject({ok: false, code: "not-stoppable"});
        expect(await client.stop({key: "p:test.tasks-owner-a:1:none"})).toMatchObject({ok: false, code: "row-gone"});
        expect(p.state.stops.map((item) => item.row)).toEqual(["go", "no"]);
    });

    test("提供方 10 秒没有结果：交回未知、abort 它的信号；撤回时在途的立即交回未知", async () => {
        const w = await world();
        const client = await w.window("a");
        const p = provider([row("slow"), row("hang")]);
        p.state.answer = () => new Promise(() => {});
        const revoke = (await w.owner("a")).tasks.provide(p.value);
        const listed = keys(await rows(client));
        const slow = client.stop({key: listed.find((key) => key.endsWith(":slow"))!});
        await waitUntil("提供方收到停止", () => p.state.stops.length === 1);
        w.settings.clock.advance(STOP_WAIT_MS - 1);
        expect(p.state.stops[0]!.signal.aborted).toBe(false);
        w.settings.clock.advance(1);
        expect(value(await slow)).toEqual({outcome: "unknown"});
        expect(p.state.stops[0]!.signal.aborted).toBe(true);

        const hang = client.stop({key: listed.find((key) => key.endsWith(":hang"))!});
        await waitUntil("提供方收到第二次停止", () => p.state.stops.length === 2);
        revoke();
        expect(value(await hang)).toEqual({outcome: "unknown"});
        expect(p.state.stops[1]!.signal.aborted).toBe(true);
    });

    test("提供方交回不合格的结果或抛错：交回未知、记诊断", async () => {
        const w = await world();
        const client = await w.window("a");
        const p = provider([row("odd"), row("boom")]);
        p.state.answer = (id) => (id === "odd" ? Promise.resolve({kind: "rejected"} as unknown as StopOutcome) : Promise.reject(new Error("boom")));
        (await w.owner("a")).tasks.provide(p.value);
        const listed = keys(await rows(client));
        for (const id of ["odd", "boom"]) expect(value(await client.stop({key: listed.find((key) => key.endsWith(`:${id}`))!}))).toEqual({outcome: "unknown"});
        expect(diagnostics(w, "tasks.provider-stop-invalid")).toHaveLength(1);
        expect(diagnostics(w, "tasks.provider-stop-failed")).toHaveLength(1);
    });
});

describe("归属、范围与分组（输出 22、23、26 的服务端部分）", () => {
    test("当前项目范围留应用、这个项目与全部会话；别的项目在跑的计进 elsewhere；全部项目时当前项目在前", async () => {
        const w = await world();
        const client = await w.window("a");
        w.tasks.start({title: "应用的"});
        w.tasks.start({title: "雾港的", owner: {kind: "project", project: "p-fog", title: "雾港"}});
        w.tasks.start({title: "长夜的", owner: {kind: "project", project: "p-night", title: "长夜"}});
        (await w.owner("a")).tasks.provide(provider([row("s", {owner: {kind: "session", session: "root-1", title: "第十二章修订"}})]).value);
        const current = await rows(client, {project: "p-night", all: false});
        expect(current.groups.map((group) => group.kind)).toEqual(["session", "project", "app"]);
        expect(current.groups[1]).toMatchObject({project: "p-night", current: true});
        expect(current.elsewhere).toBe(1);
        const all = await rows(client, {project: "p-night", all: true});
        expect(all.groups.filter((group) => group.kind === "project").map((group) => (group as {project: string}).project)).toEqual(["p-night", "p-fog"]);
        expect(all.elsewhere).toBe(0);
    });

    test("会话块：组头取 head 行；块里有等用户的就算等你处理、排在前面；其余按组头开始时刻新的在前", async () => {
        const w = await world();
        const client = await w.window("a");
        const open = {command: "test.tasks-owner-a.open", args: {session: "r"}};
        (await w.owner("a")).tasks.provide(provider([
            row("head-old", {head: true, foreground: true, startedAt: 1_000, owner: {kind: "session", session: "old", title: "早的"}}),
            row("head-new", {head: true, foreground: true, startedAt: 5_000, owner: {kind: "session", session: "new", title: "晚的"}}),
            row("job-new", {startedAt: 9_000, owner: {kind: "session", session: "old", title: "早的"}}),
            row("idle-root-job", {startedAt: 2_000, owner: {kind: "session", session: "idle", title: "空闲的", open}}),
            row("waiting-job", {state: "waiting", startedAt: 500, owner: {kind: "session", session: "asks", title: "等你的"}}),
        ]).value);
        const groups = (await rows(client)).groups as Extract<RowGroup, {kind: "session"}>[];
        expect(groups.map((group) => group.session)).toEqual(["asks", "new", "idle", "old"]);
        expect(groups[0]).toMatchObject({waiting: true, head: null});
        expect(groups.find((group) => group.session === "old")).toMatchObject({head: {title: "行 head-old"}, rows: [{title: "行 job-new"}]});
        expect(groups.find((group) => group.session === "idle")).toMatchObject({head: null, title: "空闲的", open});
    });

    test("几家交了同一个根会话的组头：认最早登记的那家，别家的当普通行，记诊断一次", async () => {
        const w = await world();
        const client = await w.window("a");
        const owner = {kind: "session", session: "root", title: "同一个"} as const;
        (await w.owner("first")).tasks.provide(provider([row("h1", {head: true, owner})]).value);
        (await w.owner("second")).tasks.provide(provider([row("h2", {head: true, owner})]).value);
        const [group] = (await rows(client)).groups as Extract<RowGroup, {kind: "session"}>[];
        expect(group!.head!.source).toEqual({kind: "provider", plugin: "test.tasks-owner-first"});
        expect(group!.rows.map((item) => item.title)).toEqual(["行 h2"]);
        await rows(client);
        expect(diagnostics(w, "tasks.provider-head-conflict")).toHaveLength(1);
    });

    test("整份超过上限：先不列提供方结束的行，再不列在跑的，组头最后；自己失败的任务一直列", async () => {
        const w = await world();
        const client = await w.window("a");
        // 每行编码后约 1.9 KiB（上限 2 KiB），三家各 100 行约 570 KiB，超过整份的 512 KiB。
        const long = (id: string, over: Partial<ProvidedRow> = {}) => row(id, {message: "长".repeat(420), title: "题".repeat(100), ...over});
        const failed = w.tasks.start({title: "自己的失败"});
        failed.fail({message: "坏了"});
        for (const name of ["x", "y", "z"]) {
            const owner = {kind: "session", session: `root-${name}`, title: name} as const;
            (await w.owner(name)).tasks.provide(provider([
                long(`${name}-head`, {head: true, owner}),
                ...Array.from({length: 40}, (_, index) => long(`${name}-end-${String(index)}`, {state: "succeeded", endedAt: 2_000 + index, owner})),
                ...Array.from({length: 59}, (_, index) => long(`${name}-run-${String(index)}`, {owner, startedAt: 3_000 + index})),
            ]).value);
        }
        const payload = await rows(client);
        expect(diagnostics(w, "tasks.provider-row-invalid")).toEqual([]);
        expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThanOrEqual(512 * 1024);
        expect(payload.more).toBeGreaterThan(0);
        const listed = keys(payload);
        // 只去掉了结束的行：在跑的与组头一件不少，留下的结束行是结束得最晚的。
        expect(listed.filter((key) => key.includes("-head")).length).toBe(3);
        expect(listed.filter((key) => key.includes("-run-")).length).toBe(3 * 59);
        const ended = listed.filter((key) => key.includes("-end-")).map((key) => Number(key.split("-end-")[1]));
        expect(ended.length).toBe(3 * 40 - payload.more);
        expect(Math.min(...ended)).toBeGreaterThan(Math.floor(payload.more / 3) - 1);
        expect(payload.groups.find((group) => group.kind === "app")?.rows.map((item) => item.title)).toEqual(["自己的失败"]);
    });
});

describe("ownChanged 与后台工作（输出 23、27）", () => {
    test("background 数自己在跑的与提供方不是前台的在跑行；提供方只改前台的行时 ownChanged 不重推", async () => {
        const w = await world();
        const client = await w.window("a");
        const seen: OwnPayload[] = [];
        expect((await client.events.ownChanged.subscribe({}, (payload) => void seen.push(payload))).ok).toBe(true);
        const p = provider([row("bg"), row("fg", {foreground: true}), row("done", {state: "succeeded", endedAt: 3_000})]);
        (await w.owner("a")).tasks.provide(p.value);
        w.tasks.start({title: "自己的"});
        await waitUntil("推到两件后台工作", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return seen.at(-1)?.background.count === 2;
        });
        const pushes = seen.length;
        p.set([row("bg"), row("fg", {foreground: true, message: "换了一句"}), row("done", {state: "succeeded", endedAt: 3_000})]);
        for (let step = 0; step < 4; step += 1) w.settings.clock.advance(PUSH_INTERVAL_MS);
        await client.own({});
        expect(seen.length).toBe(pushes);
    });

    test("rowsChanged 按订阅的范围推，内容没变不重推", async () => {
        const w = await world();
        const client = await w.window("a");
        const seen: RowsPayload[] = [];
        expect((await client.events.rowsChanged.subscribe({project: "p-fog", all: false}, (payload) => void seen.push(payload))).ok).toBe(true);
        const p = provider([row("1")]);
        (await w.owner("a")).tasks.provide(p.value);
        await waitUntil("推到这一行", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return seen.at(-1) !== undefined && keys(seen.at(-1)!).length === 1;
        });
        const pushes = seen.length;
        p.set([row("1")]);
        for (let step = 0; step < 4; step += 1) w.settings.clock.advance(PUSH_INTERVAL_MS);
        await client.own({});
        expect(seen.length).toBe(pushes);
        w.tasks.start({title: "别的项目", owner: {kind: "project", project: "p-night", title: "长夜"}});
        await waitUntil("别的项目计进 elsewhere", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return seen.at(-1)?.elsewhere === 1;
        });
    });
});

describe("清单关闭时提供方还登记着（输出 21）", () => {
    // 真实装配里登记方依赖 `tasksKey`，门面总是先于清单释放；这里直接用核心，覆盖可选依赖时清单先停的那一路。
    test("close：每家退订，在途的停止交回未知并 abort 信号；之后的撤回函数是空操作", async () => {
        const consumer = {instanceId: "i-1", location: "server", client: null, plugin: "test.closing", entry: "server", generation: 1, via: null} as const;
        const reports: string[] = [];
        const core = createTasksCore({clock: {now: () => 0, schedule: () => () => undefined}, newId: () => "1", report: (event) => void reports.push(event)});
        const p = provider([row("hang")]);
        p.state.answer = () => new Promise(() => {});
        const revoke = core.facade(consumer).provide(p.value);
        const [key] = keys(core.rows(ALL));
        const pending = core.stop(key!);
        await waitUntil("提供方收到停止", () => p.state.stops.length === 1);
        core.close();
        expect(await pending).toEqual({ok: true, value: {outcome: "unknown"}});
        expect(p.state.stops[0]!.signal.aborted).toBe(true);
        expect(p.state.unsubscribed).toBe(1);
        revoke();
        expect(p.state.unsubscribed).toBe(1);
        expect(reports).toEqual([]);
    });
});

describe("清单关闭（输出 21）", () => {
    test("服务停止：每家退订，在途的停止交回未知并 abort 信号", async () => {
        const w = await world();
        const client = await w.window("a");
        const p = provider([row("hang")]);
        p.state.answer = () => new Promise(() => {});
        (await w.owner("a")).tasks.provide(p.value);
        const [key] = keys(await rows(client));
        const pending = client.stop({key: key!});
        await waitUntil("提供方收到停止", () => p.state.stops.length === 1);
        expect(await w.settings.hub.stop()).toMatchObject({status: "closed"});
        expect(p.state.stops[0]!.signal.aborted).toBe(true);
        expect(p.state.unsubscribed).toBe(1);
        // 链路随服务一起关：调用要么在关之前拿到“未知”，要么以链路断开结束，不会一直挂着。
        const result = await pending;
        expect(result.ok ? result.value : result.code).toSatisfy((value: unknown) => JSON.stringify(value) === JSON.stringify({outcome: "unknown"}) || typeof value === "string");
    });
});

describe("实现审查补的边界（第 1 片 omp）", () => {
    test("撤回只能在调过提供方之后：同一段里先调 stop 再退订，撤回之后的停止得 row-gone、不再调它", async () => {
        const w = await world();
        const client = await w.window("a");
        const order: string[] = [];
        let revoke: () => void = () => undefined;
        const value: TaskProvider = {
            rows: () => [row("1")],
            subscribe: () => () => void order.push("unsubscribe"),
            stop: () => {
                order.push("stop");
                queueMicrotask(revoke);
                return new Promise(() => {});
            },
        };
        revoke = (await w.owner("a")).tasks.provide(value);
        const [key] = keys(await rows(client));
        expect(value_(await client.stop({key: key!}))).toEqual({outcome: "unknown"});
        expect(order).toEqual(["stop", "unsubscribe"]);
        expect(await client.stop({key: key!})).toMatchObject({ok: false, code: "row-gone"});
        expect(order).toEqual(["stop", "unsubscribe"]);
    });

    test("停止的结果读字段时抛错：当场交回未知、记诊断，不留未处理的拒绝", async () => {
        const w = await world();
        const client = await w.window("a");
        const p = provider([row("1")]);
        p.state.answer = () => Promise.resolve(Object.defineProperty({kind: "rejected"}, "reason", {get: () => {
            throw new Error("reason broke");
        }}) as StopOutcome);
        (await w.owner("a")).tasks.provide(p.value);
        const [key] = keys(await rows(client));
        expect(value_(await client.stop({key: key!}))).toEqual({outcome: "unknown"});
        expect(diagnostics(w, "tasks.provider-stop-failed")).toHaveLength(1);
    });

    test("布尔字段不是布尔值的行丢掉、记诊断", async () => {
        const w = await world();
        const client = await w.window("a");
        (await w.owner("a")).tasks.provide(provider([row("ok"), row("bad", {foreground: "yes" as unknown as boolean})]).value);
        expect(titles(await rows(client))).toEqual(["行 ok"]);
        expect(diagnostics(w, "tasks.provider-row-invalid")).toHaveLength(1);
    });

    test("会话块有组头时，打开只取组头那一家的，不拼别家的", async () => {
        const w = await world();
        const client = await w.window("a");
        (await w.owner("early")).tasks.provide(provider([row("job", {owner: {kind: "session", session: "r", title: "根", open: {command: "test.tasks-owner-early.open", args: {session: "other"}}}})]).value);
        (await w.owner("late")).tasks.provide(provider([row("head", {head: true, owner: {kind: "session", session: "r", title: "根", open: {command: "test.tasks-owner-late.open", args: {session: "r"}}}})]).value);
        const [group] = (await rows(client)).groups as Extract<RowGroup, {kind: "session"}>[];
        expect(group!.head!.source).toEqual({kind: "provider", plugin: "test.tasks-owner-late"});
        expect(group!.open).toEqual({command: "test.tasks-owner-late.open", args: {session: "r"}});
    });

    test("门面释放：自己的任务先落定为中断，退订回调里再调句柄不起作用", async () => {
        const w = await world();
        const client = await w.window("a");
        const owner = await w.owner("a");
        const handle = owner.tasks.start({title: "导出"});
        owner.tasks.provide({rows: () => [], subscribe: () => () => handle.succeed("退订时报成功"), stop: async () => ({kind: "accepted"})});
        await owner.stop();
        expect(value_(await client.own({})).tasks.find((task) => task.id === handle.id)).toMatchObject({state: "interrupted"});
    });

    test("只有提供方的变化也推：后台工作的件数随提供方的行变，分组行跟着推", async () => {
        const w = await world();
        const client = await w.window("a");
        const own: OwnPayload[] = [];
        const grouped: RowsPayload[] = [];
        expect((await client.events.ownChanged.subscribe({}, (payload) => void own.push(payload))).ok).toBe(true);
        expect((await client.events.rowsChanged.subscribe(ALL, (payload) => void grouped.push(payload))).ok).toBe(true);
        const p = provider([]);
        (await w.owner("a")).tasks.provide(p.value);
        p.set([row("1")]);
        await waitUntil("两路都推到这一行", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return own.at(-1)?.background.count === 1 && grouped.at(-1) !== undefined && keys(grouped.at(-1)!).length === 1;
        });
    });

    test("撤回发生在算好之后、发出之前：那一份不发，下一份去掉这一家", async () => {
        const w = await world();
        const client = await w.window("a");
        const grouped: RowsPayload[] = [];
        expect((await client.events.rowsChanged.subscribe(ALL, (payload) => void grouped.push(payload))).ok).toBe(true);
        let current: readonly ProvidedRow[] = [row("original")];
        let notify: () => void = () => undefined;
        let revoke: () => void = () => undefined;
        revoke = (await w.owner("a")).tasks.provide({rows: () => {
            const rows_ = current;
            if (rows_[0]?.id === "obsolete") queueMicrotask(revoke);
            return rows_;
        }, subscribe: (listener) => {
            notify = listener;
            return () => undefined;
        }, stop: async () => ({kind: "accepted"})});
        await waitUntil("推到 original", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return grouped.some((payload) => keys(payload).some((key) => key.endsWith(":original")));
        });
        current = [row("obsolete")];
        notify();
        for (let step = 0; step < 6; step += 1) {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            await Promise.resolve();
        }
        await waitUntil("推到去掉之后的那一份", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return keys(grouped.at(-1)!).length === 0;
        });
        expect(grouped.some((payload) => keys(payload).some((key) => key.endsWith(":obsolete")))).toBe(false);
    });

    test("自己 50 件失败的任务字段写满、各在一个会话里：分组行仍不超过 512 KiB，一件不少", async () => {
        const w = await world();
        const client = await w.window("a");
        const nul = "\u0000";
        for (let index = 0; index < 50; index += 1) {
            const handle = w.tasks.start({title: nul.repeat(200), owner: {kind: "session", session: `s${String(index)}`, title: nul.repeat(200)}});
            handle.fail({message: nul.repeat(500)});
        }
        const payload = await rows(client);
        expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThanOrEqual(512 * 1024);
        expect(payload.groups).toHaveLength(50);
        expect(payload.more).toBe(0);
    });

    test("几百个小组不会被每组的余量裁空", async () => {
        const w = await world();
        const client = await w.window("a");
        for (let index = 0; index < 260; index += 1) w.tasks.start({title: `t${String(index)}`, owner: {kind: "project", project: `p${String(index)}`, title: `项目 ${String(index)}`}});
        const payload = await rows(client);
        expect(payload.groups).toHaveLength(260);
        expect(payload.more).toBe(0);
    });

    test("只有在跑的行也超出上限时：先不列不是组头的在跑行（最早开始的先），组头留着", async () => {
        const w = await world();
        const client = await w.window("a");
        const long = (id: string, over: Partial<ProvidedRow> = {}) => row(id, {message: "长".repeat(420), title: "题".repeat(100), ...over});
        for (const name of ["x", "y", "z"]) {
            const owner = {kind: "session", session: `root-${name}`, title: name} as const;
            (await w.owner(name)).tasks.provide(provider([long(`${name}-head`, {head: true, owner, startedAt: 0}), ...Array.from({length: 99}, (_, index) => long(`${name}-run-${String(index)}`, {owner, startedAt: 1_000 + index}))]).value);
        }
        const payload = await rows(client);
        expect(payload.more).toBeGreaterThan(0);
        const listed = keys(payload);
        expect(listed.filter((key) => key.endsWith("-head"))).toHaveLength(3);
        const kept = listed.filter((key) => key.includes("-run-")).map((key) => Number(key.split("-run-")[1]));
        expect(kept.length).toBe(3 * 99 - payload.more);
        expect(Math.min(...kept)).toBeGreaterThanOrEqual(Math.floor(payload.more / 3) - 1);
    });
});
