/**
 * 读取层（world.ts；docs/specs/canon/author-ui.md 输出 26、27、29）接在进程内的真实世界服务上（testing/node-world.ts）。
 * 读取次数经一层只转发、记方法名的包装数出来：世界客户端与服务都是真的。
 */

import {rm} from "node:fs/promises";

import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {watch} from "vue";

import type {Entry, WriteRequest} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {CanonClient, CanonEvent} from "../shared/contracts";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import {createCanonWorld, KEEP_UNUSED} from "./world";
import type {CanonWorld} from "./world";

let tmp: string;
let venue: CanonNodeWorld | null = null;
const worlds: CanonWorld[] = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "read-layer");
});

afterEach(async () => {
    for (const world of worlds.splice(0)) world.dispose();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
});

/** 只转发、记下每次 `call` 的方法名。 */
function counted(client: CanonClient): {readonly client: CanonClient; readonly calls: string[]} {
    const calls: string[] = [];
    return {
        calls,
        client: {
            call: (method, input) => {
                calls.push(method);
                return client.call(method, input);
            },
            publish: (request, token) => client.publish(request, token),
            subscribe: (listener) => client.subscribe(listener),
            hold: (label, onEnded) => client.hold(label, onEnded),
        },
    };
}

const INITIAL = {kind: "initial"} as const;
let sequence = 0;
function person(name: string, id = `tmp:${String(++sequence)}`): Entry {
    return {id, type: "nbook.canon.person", parent: null, folder: "人物", order: 0, init: {name, aliases: [], summary: "", text: [], data: {character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null}}}}};
}
const put = (entry: Entry, baseVersion: number): WriteRequest => ({requestId: `req-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: entry.init.name, baseVersion, puts: [{ref: {kind: "entry", id: entry.id}, after: entry}]});

async function versionOf(canon: CanonClient): Promise<number> {
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error(JSON.stringify(status.failure));
    return status.value.version;
}

/** 别的窗口建一个人物，返回它的 id。 */
async function create(other: CanonNodeWindow, name: string): Promise<string> {
    const result = await other.canon.publish(put(person(name), await versionOf(other.canon)));
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return Object.values(result.value.ids)[0]!;
}

async function setup(): Promise<{world: CanonWorld; calls: string[]; other: CanonNodeWindow; client: CanonClient}> {
    venue = await canonNodeWorld(tmp);
    const mine = await venue.window("mine");
    const other = await venue.window("other");
    const {client, calls} = counted(mine.canon);
    const world = createCanonWorld(client);
    worlds.push(world);
    await waitUntil("订阅建好、读到状态", () => world.connection.value === "online" && world.status.value.data !== undefined, {timeoutMs: 10_000});
    return {world, calls, other, client};
}

/** 等这一轮重读做完：新读一个没读过的键，它回来时同一轮里别的到期读取也读完了。 */
async function settled(world: CanonWorld): Promise<void> {
    const probe = world.read("lookup", {names: [`probe-${String(++sequence)}`]});
    await waitUntil("探针读完", () => !probe.state.value.loading);
    probe.release();
}

describe("读取层", () => {
    it("第一次读取期间是加载中；别处发布以后重读并原地替换，重读期间不回到加载中", async () => {
        const {world, other} = await setup();
        const star = await create(other, "星瑾");
        const handle = world.read("entry", {id: star, position: INITIAL, mode: "actual"});
        expect(handle.state.value.loading).toBe(true);
        await waitUntil("读到条目", () => handle.state.value.data?.view?.name === "星瑾");

        const states: boolean[] = [];
        const stop = watch(handle.state, (state) => states.push(state.loading));
        const renamed = await other.canon.publish(put(person("星瑾（妹妹）", star), await versionOf(other.canon)));
        expect(renamed.ok).toBe(true);
        await waitUntil("换上新名字", () => handle.state.value.data?.view?.name === "星瑾（妹妹）");
        stop();
        expect(states.every((loading) => !loading)).toBe(true);
        handle.release();
    });

    it("同一个读取在两处用只发一次；连续几次发布以后停在最后那一版，重读次数不多于发布次数", async () => {
        const {world, calls, other} = await setup();
        const star = await create(other, "星瑾");
        const first = world.read("entry", {id: star, position: INITIAL, mode: "actual"});
        const second = world.read("entry", {mode: "actual", id: star, position: INITIAL});
        await waitUntil("读到条目", () => first.state.value.data !== undefined);
        expect(second.state.value).toBe(first.state.value);
        expect(calls.filter((method) => method === "entry")).toHaveLength(1);

        for (let round = 1; round <= 5; round += 1) {
            const result = await other.canon.publish(put(person(`星瑾 ${String(round)}`, star), await versionOf(other.canon)));
            expect(result.ok).toBe(true);
        }
        await waitUntil("停在最后一版", () => first.state.value.data?.view?.name === "星瑾 5");
        expect(calls.filter((method) => method === "entry").length).toBeLessThanOrEqual(1 + 5);
        first.release();
        second.release();
    });

    it("本窗口写入成功返回时已经按它的版本重读；这次写入的事件与返回加起来只重读一次", async () => {
        const {world, calls, other} = await setup();
        const star = await create(other, "星瑾");
        const handle = world.read("entry", {id: star, position: INITIAL, mode: "actual"});
        await waitUntil("读到条目", () => handle.state.value.data !== undefined);

        // 另订一条，用来知道本窗口写入的 changed 事件什么时候到了。真实服务里事件先于写入结果到达，读取层在事件时就重读了，
        // 写入返回时不再读第二次。
        const events: CanonEvent[] = [];
        const raw = await (venue!).window("watcher");
        expect((await raw.canon.subscribe((event) => events.push(event))).ok).toBe(true);

        const before = calls.filter((method) => method === "entry").length;
        const written = await world.write("publish", {request: put(person("哥哥", star), world.status.value.data!.version)});
        if (!written.ok) throw new Error(JSON.stringify(written.failure));
        expect(handle.state.value.data?.version).toBe(written.value.version);
        expect(handle.state.value.data?.view?.name).toBe("哥哥");
        expect(calls.filter((method) => method === "entry")).toHaveLength(before + 1);

        await waitUntil("changed 事件已到", () => events.some((event) => event.kind === "changed" && event.version === written.value.version));
        await settled(world);
        expect(calls.filter((method) => method === "entry")).toHaveLength(before + 1);
        handle.release();
    });

    it(`没人用的读取留最近 ${String(KEEP_UNUSED)} 个，多了丢最久没用的；留着的再用时先给旧结果`, async () => {
        const {world} = await setup();
        for (let index = 0; index <= KEEP_UNUSED; index += 1) {
            const handle = world.read("entry", {id: `missing-${String(index)}`, position: INITIAL, mode: "actual"});
            await waitUntil("读完", () => !handle.state.value.loading);
            handle.release();
        }
        const dropped = world.read("entry", {id: "missing-0", position: INITIAL, mode: "actual"});
        const kept = world.read("entry", {id: `missing-${String(KEEP_UNUSED)}`, position: INITIAL, mode: "actual"});
        expect(dropped.state.value.loading).toBe(true);
        expect(kept.state.value.loading).toBe(false);
        dropped.release();
        kept.release();
    });

    it("翻过页的列表在世界变了以后按已读的条数从头重读，作者翻到的位置还在", async () => {
        const {world, other} = await setup();
        for (const name of ["甲", "乙", "丙"]) await create(other, name);
        const tree = world.list("tree", {parent: null}, 1);
        await waitUntil("第一页", () => tree.state.value.items.length === 1);
        await tree.more();
        expect(tree.state.value.items).toHaveLength(2);

        await create(other, "丁");
        await waitUntil("按新版本重读", () => tree.state.value.data?.version === world.status.value.data?.version && world.status.value.data?.version !== undefined);
        await settled(world);
        expect(tree.state.value.items).toHaveLength(2);
        expect(tree.state.value.more).toBe(true);
        tree.release();
    });

    it("断线期间别处发布了：重连以后按当前版本重读", async () => {
        venue = await canonNodeWorld(tmp);
        const mine = await venue.window("mine");
        const other = await venue.window("other");
        const world = createCanonWorld(mine.canon);
        worlds.push(world);
        const star = await create(other, "星瑾");
        const handle = world.read("entry", {id: star, position: INITIAL, mode: "actual"});
        await waitUntil("读到条目", () => handle.state.value.data?.view?.name === "星瑾", {timeoutMs: 10_000});

        mine.disconnect();
        const renamed = await other.canon.publish(put(person("哥哥", star), await versionOf(other.canon)));
        expect(renamed.ok).toBe(true);
        await mine.reconnect();
        await waitUntil("重连后重读", () => handle.state.value.data?.view?.name === "哥哥", {timeoutMs: 10_000});
        expect(world.connection.value).toBe("online");
        handle.release();
    });

    it("项目实例停止：连接是 ended，已读的内容留着", async () => {
        const {world, other} = await setup();
        const star = await create(other, "星瑾");
        const handle = world.read("entry", {id: star, position: INITIAL, mode: "actual"});
        await waitUntil("读到条目", () => handle.state.value.data !== undefined);
        await venue!.endProject();
        await waitUntil("连接结束", () => world.connection.value === "ended", {timeoutMs: 10_000});
        expect(handle.state.value.data?.view?.name).toBe("星瑾");
        handle.release();
    });

    it("没有绑定项目：连接是 no-project", async () => {
        const {createCanonClient} = await import("./client");
        const world = createCanonWorld(createCanonClient(null));
        worlds.push(world);
        await waitUntil("连接状态", () => world.connection.value !== "connecting");
        expect(world.connection.value).toBe("no-project");
    });
});

// 外部读取（输出 35）：别的插件的远程读取挂进同一份读取层。这里用同一个世界客户端的读取充当“别的插件的远程读取”：取数是调用方
// 给的函数，读取层只管它什么时候读、读到的什么时候换上。
describe("外部读取", () => {
    it("与世界读取同一代失效、同一轮换上：一次发布以后，不会一边已是新的、另一边还是旧的", async () => {
        const {world, other, client} = await setup();
        const star = await create(other, "星瑾");
        const entry = world.read("entry", {id: star, position: INITIAL, mode: "actual"});
        const names = world.external("external:test:names", () => client.call("lookup", {names: ["星瑾（妹妹）"]}));
        await waitUntil("两边都读到", () => entry.state.value.data !== undefined && names.state.value.data !== undefined);

        const pairs: [string | undefined, number | undefined][] = [];
        const stop = watch([entry.state, names.state], ([read, found]) => pairs.push([read.data?.view?.name, found.data?.version]));
        const renamed = await other.canon.publish(put(person("星瑾（妹妹）", star), await versionOf(other.canon)));
        if (!renamed.ok) throw new Error(JSON.stringify(renamed.failure));
        await waitUntil("换上新名字", () => entry.state.value.data?.view?.name === "星瑾（妹妹）" && names.state.value.data?.version === renamed.value.version);
        stop();
        expect(pairs.filter(([name, version]) => (name === "星瑾（妹妹）") !== (version === renamed.value.version))).toEqual([]);
        entry.release();
        names.release();
    });

    it("取数抛错：这个读取得到 external-failed，同一轮别的读取照常换上，之后的发布照常重读", async () => {
        const {world, other} = await setup();
        const star = await create(other, "星瑾");
        const entry = world.read("entry", {id: star, position: INITIAL, mode: "actual"});
        const broken = world.external<never>("external:test:broken", () => Promise.reject(new Error("剧情的读取坏了")));
        await waitUntil("两个都读过一次", () => entry.state.value.data !== undefined && !broken.state.value.loading);
        expect(broken.state.value.error).toEqual({code: "external-failed", detail: "剧情的读取坏了"});

        const renamed = await other.canon.publish(put(person("星瑾 2", star), await versionOf(other.canon)));
        expect(renamed.ok).toBe(true);
        await waitUntil("照常重读", () => entry.state.value.data?.view?.name === "星瑾 2");
        entry.release();
        broken.release();
    });

    it("重试：在线时把读失败了的再读一次，不等世界变化；读成功的不重读", async () => {
        const {world, client} = await setup();
        let attempts = 0;
        const flaky = world.external("external:test:flaky", () => {
            attempts += 1;
            return attempts === 1 ? Promise.reject(new Error("剧情还没启动")) : client.call("lookup", {names: ["星瑾"]});
        });
        let healthyReads = 0;
        const healthy = world.external("external:test:healthy", () => {
            healthyReads += 1;
            return client.call("lookup", {names: ["星瑕"]});
        });
        await waitUntil("都读过一次", () => !flaky.state.value.loading && healthy.state.value.data !== undefined);
        expect(flaky.state.value.error?.code).toBe("external-failed");

        await world.retry();
        await waitUntil("重试以后读到", () => flaky.state.value.data !== undefined);
        expect(flaky.state.value.error).toBeNull();
        expect([attempts, healthyReads]).toEqual([2, 1]);
        flaky.release();
        healthy.release();
    });

    it("结果的世界版本比已知的旧：这一代补读一次，不一直重读", async () => {
        const {world, client} = await setup();
        let fetched = 0;
        const lagging = world.external("external:test:lagging", async () => {
            fetched += 1;
            const version = await versionOf(client);
            // 第一次装作对方的快照还没追上本窗口已知的版本。
            return {ok: true as const, value: {version: fetched === 1 ? version - 1 : version}};
        });
        await waitUntil("补读完", () => fetched >= 2 && !lagging.state.value.stale);
        await settled(world);
        expect(fetched).toBe(2);
        expect(lagging.state.value.data?.version).toBe(world.status.value.data?.version);
        lagging.release();
    });

    it("外部列表翻过页以后世界变了：按真实页长从头翻到已读的条数，翻到的位置还在", async () => {
        const {world, other, client} = await setup();
        for (const name of ["甲", "乙", "丙", "丁"]) await create(other, name);
        const asked: (string | undefined)[] = [];
        const tree = world.externalList("external:test:tree", (cursor, limit) => {
            asked.push(cursor);
            return client.call("tree", {parent: null, limit, ...(cursor === undefined ? {} : {cursor})});
        }, 1);
        await waitUntil("第一页", () => tree.state.value.items.length === 1);
        await tree.more();
        await tree.more();
        expect(tree.state.value.items).toHaveLength(3);

        asked.length = 0;
        await create(other, "戊");
        await waitUntil("按新版本重读", () => tree.state.value.data?.version === world.status.value.data?.version && world.status.value.data?.version !== undefined);
        await settled(world);
        // 一页一条，翻回三条要从头取三页。
        expect(asked).toHaveLength(3);
        expect(asked[0]).toBeUndefined();
        expect(tree.state.value.items).toHaveLength(3);
        expect(tree.state.value.more).toBe(true);
        tree.release();
    });
});
