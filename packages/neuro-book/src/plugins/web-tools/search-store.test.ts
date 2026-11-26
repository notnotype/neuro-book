/**
 * 设置页的数据模块（`web/search-store.ts`）接真实的服务端：场地里起 `nbook.web`，窗口经真实的远程合同调用，检测打到本机的
 * 假 DeepSeek 接口（docs/specs/web/settings-page.md 输出 2、6、7、8 与“状态与转换”）。这里的密钥是假的，只发往本机。链路中断、
 * 入口停用这类取决于运行时码与时机的结局用远程合同替身造，在第二组。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {fakeEndpoint} from "nbook/plugins/agent/testing/endpoint";
import type {FakeEndpoint} from "nbook/plugins/agent/testing/endpoint";

import {fakeDeepSeek} from "./testing/fake-deepseek";
import type {FakeDeepSeek} from "./testing/fake-deepseek";
import {fakeTavily} from "./testing/fake-tavily";
import type {FakeTavily} from "./testing/fake-tavily";
import {webWorld} from "./testing/world";
import type {WebWorld} from "./testing/world";
import {createSearchStore} from "./web/search-store";
import type {SearchStore, WebSettingsRemote} from "./web/search-store";

const KEY = "sk-store-not-real-0123456789";

let tmp = "";
let model: FakeEndpoint;
let deepseek: FakeDeepSeek;
let tavily: FakeTavily;
let world: WebWorld | null = null;
let counter = 0;
const stores: SearchStore[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-web", "设置页的数据模块");
    model = fakeEndpoint();
    deepseek = fakeDeepSeek();
    tavily = fakeTavily();
});
afterEach(async () => {
    for (const store of stores.splice(0)) store.dispose();
    deepseek.reset();
    tavily.reset();
    await world?.close();
    world = null;
});
afterAll(async () => {
    model.stop();
    deepseek.stop();
    tavily.stop();
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function storeOf(prepare?: (root: string) => Promise<void>): Promise<SearchStore> {
    counter += 1;
    const root = join(tmp, `w${String(counter)}`);
    await prepare?.(root);
    world = await webWorld(root, {deepseekBaseUrl: deepseek.baseUrl, tavilyBaseUrl: tavily.baseUrl, modelBaseUrl: model.baseUrl});
    const store = createSearchStore(await world.settings("w"), () => 1000);
    stores.push(store);
    return store;
}

describe("数据模块接真实服务端", () => {
    it("start 之前是读取中，取到之后是未设置；写入在途时记着这一家，写入后已设置，清除后未设置（输出 2、3、5、8）", async () => {
        const store = await storeOf();
        expect(store.status.value).toBeNull();
        await store.start();
        expect(store.status.value).toEqual({providers: {deepseek: {hasKey: false}, tavily: {hasKey: false}}});
        const writing = store.setKey("deepseek", KEY);
        expect(store.writing.has("deepseek")).toBe(true);
        expect(await writing).toEqual({ok: true});
        expect(store.writing.has("deepseek")).toBe(false);
        expect(store.status.value).toEqual({providers: {deepseek: {hasKey: true}, tavily: {hasKey: false}}});
        expect(await store.clearKey("deepseek")).toEqual({ok: true});
        expect(store.status.value).toEqual({providers: {deepseek: {hasKey: false}, tavily: {hasKey: false}}});
    });

    it("填完直接检测：检测等这一家在途的写入结束再发，用到刚填的密钥（输出 8）", async () => {
        const store = await storeOf();
        await store.start();
        const writing = store.setKey("deepseek", KEY);
        const checking = store.check("deepseek");
        await writing;
        // 写入成功时排在它后面的检测仍是进行中，不被当成旧结果清掉。
        expect(store.checks.get("deepseek")).toEqual({status: "running"});
        await checking;
        expect(store.checks.get("deepseek")).toEqual({status: "done", result: {ok: true}, at: 1000});
        expect(deepseek.requests).toMatchObject([{path: "/v1/tools/search", authorization: `Bearer ${KEY}`}]);
    });

    it("写入或清除成功后检测结果清掉；检测失败的码原样交回；进行中不重复发（输出 8）", async () => {
        const store = await storeOf();
        await store.start();
        await store.setKey("deepseek", KEY);
        deepseek.script("/v1/tools/search", {status: 401, json: {error: {message: "bad key"}}});
        await store.check("deepseek");
        expect(store.checks.get("deepseek")).toEqual({status: "done", result: {ok: false, code: "auth", detail: "bad key"}, at: 1000});
        await store.setKey("deepseek", `${KEY}-2`);
        expect(store.checks.has("deepseek")).toBe(false);

        deepseek.script("/v1/tools/search", {hang: true});
        const before = deepseek.requests.length;
        const first = store.check("deepseek");
        const second = store.check("deepseek");
        await waitUntil("the check reached the endpoint", () => deepseek.requests.length > before || undefined);
        expect(store.checks.get("deepseek")).toEqual({status: "running"});
        deepseek.release();
        await Promise.all([first, second]);
        // 两次 check 都结束了，端点只多收到一次请求。
        expect(deepseek.requests.length - before).toBe(1);
        expect(store.checks.get("deepseek")?.status).toBe("done");
    });

    it("检测已经发出、之后写入成功：旧密钥的检测取消，回到空闲，不显示它的结果；再检测用新密钥（输出 8）", async () => {
        const store = await storeOf();
        await store.start();
        await store.setKey("deepseek", KEY);
        deepseek.script("/v1/tools/search", {hang: true});
        const stale = store.check("deepseek");
        await waitUntil("the check reached the endpoint", () => deepseek.requests.length >= 1 || undefined);
        expect(await store.setKey("deepseek", `${KEY}-new`)).toEqual({ok: true});
        expect(store.checks.has("deepseek")).toBe(false);
        // 假端点一直不答：这次检测只有被取消才会结束。
        await stale;
        expect(store.checks.has("deepseek")).toBe(false);

        await store.check("deepseek");
        expect(store.checks.get("deepseek")).toEqual({status: "done", result: {ok: true}, at: 1000});
        expect(deepseek.requests.at(-1)?.authorization).toBe(`Bearer ${KEY}-new`);
    });

    it("两家互不影响：一家写入成功不取消另一家已经发出的检测，也不清它的结果（输出 8）", async () => {
        const store = await storeOf();
        await store.start();
        await store.setKey("tavily", "tvly-store-not-real-0123456789");
        await store.setKey("deepseek", KEY);
        tavily.script("/search", {hang: true});
        const checking = store.check("tavily");
        await waitUntil("the Tavily check reached the endpoint", () => tavily.requests.length >= 1 || undefined);
        expect(await store.setKey("deepseek", `${KEY}-new`)).toEqual({ok: true});
        expect(store.checks.get("tavily")).toEqual({status: "running"});
        // 放开挂着的请求（假端点以 500 作答）：这次检测照常结束，结果留着。
        tavily.release();
        await checking;
        expect(store.checks.get("tavily")).toMatchObject({status: "done", result: {ok: false, code: "failed"}});
        expect(await store.clearKey("deepseek")).toEqual({ok: true});
        expect(store.checks.get("tavily")).toMatchObject({status: "done", result: {ok: false, code: "failed"}});
        expect(deepseek.requests).toHaveLength(0);
    });

    it("入口停用：已经发出的检测被取消，迟到的结局不写进状态（时序与寿命）", async () => {
        const store = await storeOf();
        await store.start();
        await store.setKey("deepseek", KEY);
        deepseek.script("/v1/tools/search", {hang: true});
        const checking = store.check("deepseek");
        await waitUntil("the check reached the endpoint", () => deepseek.requests.length >= 1 || undefined);
        store.dispose();
        await checking;
        expect(store.checks.get("deepseek")).toEqual({status: "running"});
    });

    it("密钥文件读不了：取状态失败带 credentials-unavailable，状态仍是 null；写入后恢复（输出 7）", async () => {
        const store = await storeOf(async (root) => {
            const path = join(root, "state", "web", "keys.json");
            await mkdir(dirname(path), {recursive: true});
            await writeFile(path, "{broken");
        });
        await store.start();
        expect(store.status.value).toBeNull();
        expect(store.statusFailure.value?.code).toBe("credentials-unavailable");
        expect(store.available.value).toBe(true);
        expect(await store.setKey("deepseek", KEY)).toEqual({ok: true});
        expect(store.status.value).toEqual({providers: {deepseek: {hasKey: true}, tavily: {hasKey: false}}});
        expect(store.statusFailure.value).toBeNull();
    });
});

describe("链路的结局（远程合同替身）", () => {
    type Failure = {readonly ok: false; readonly code: string};
    const KEYED = {ok: true as const, value: {providers: {deepseek: {hasKey: true}, tavily: {hasKey: false}}}};

    /** 这几条要造链路中断、入口停用的结局：它们取决于运行时的码与时机，与服务端无关。`calls` 依次记下被调用的方法。 */
    function scriptedRemote(script: {
        /** 依次作为 status 的结局；用完以后照常答。 */
        readonly status?: readonly Failure[];
        /** 写方法的结局；缺省照常答。 */
        readonly write?: () => Promise<Failure | typeof KEYED>;
        /** check 的结局；缺省通过。 */
        readonly check?: Failure;
    }): {readonly remote: WebSettingsRemote; readonly calls: string[]} {
        const calls: string[] = [];
        const statusOutcomes = [...(script.status ?? [])];
        const write = async (method: string) => {
            calls.push(method);
            return script.write === undefined ? KEYED : script.write();
        };
        const remote = {
            status: async () => {
                calls.push("status");
                return statusOutcomes.shift() ?? KEYED;
            },
            setKey: async () => write("setKey"),
            clearKey: async () => write("clearKey"),
            check: async () => {
                calls.push("check");
                return script.check ?? {ok: true, value: {ok: true}};
            },
            events: {},
        };
        return {remote: remote as unknown as WebSettingsRemote, calls};
    }

    function storeOn(remote: WebSettingsRemote): SearchStore {
        const store = createSearchStore(remote);
        stores.push(store);
        return store;
    }

    it("写入结果未知：交回 unknown-outcome，并重取状态（输出 6）", async () => {
        const {remote, calls} = scriptedRemote({write: async () => ({ok: false, code: "unknown-outcome"})});
        const store = storeOn(remote);
        await store.start();
        expect(await store.setKey("deepseek", KEY)).toMatchObject({ok: false, failure: {code: "unknown-outcome"}});
        await waitUntil("the status was fetched again", () => calls.filter((call) => call === "status").length >= 2 || undefined);
    });

    it("unavailable 让页面只读；检测的远程失败记为没检成（输出 7、8）", async () => {
        const {remote} = scriptedRemote({check: {ok: false, code: "unavailable"}});
        const store = storeOn(remote);
        await store.start();
        await store.check("deepseek");
        expect(store.checks.get("deepseek")).toMatchObject({status: "error", failure: {code: "unavailable"}});
        expect(store.available.value).toBe(false);
    });

    it("取状态没连上（unavailable、target-gone）：只读；下一次 start 重取，取到后可用；已取到且可用时 start 不再取（状态与转换）", async () => {
        for (const code of ["unavailable", "target-gone"]) {
            const {remote, calls} = scriptedRemote({status: [{ok: false, code}]});
            const store = storeOn(remote);
            await store.start();
            expect(store.available.value).toBe(false);
            expect(store.statusFailure.value?.code).toBe(code);
            await store.start();
            expect(store.available.value).toBe(true);
            expect(store.status.value).toEqual(KEYED.value);
            await store.start();
            expect(calls).toEqual(["status", "status"]);
        }
    });

    it("检测排在在途的写入后面时入口停用：写入结束后不再发检测（时序与寿命）", async () => {
        const gate = Promise.withResolvers<typeof KEYED>();
        const {remote, calls} = scriptedRemote({write: () => gate.promise});
        const store = storeOn(remote);
        await store.start();
        const writing = store.setKey("deepseek", KEY);
        const checking = store.check("deepseek");
        store.dispose();
        gate.resolve(KEYED);
        await Promise.all([writing, checking]);
        expect(calls).toEqual(["status", "setKey"]);
    });
});
