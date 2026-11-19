/**
 * 设置页的数据模块（`web/search-store.ts`）接真实的服务端：场地里起 `nbook.web-tools`，窗口经真实的远程合同调用，检测打到本机的
 * 假 DeepSeek 接口（docs/specs/web/settings-page.md 输出 2、6、7、8）。这里的密钥是假的，只发往本机。
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
import {webWorld} from "./testing/world";
import type {WebWorld} from "./testing/world";
import {createSearchStore} from "./web/search-store";
import type {SearchStore, WebSettingsRemote} from "./web/search-store";

const KEY = "sk-store-not-real-0123456789";

let tmp = "";
let model: FakeEndpoint;
let deepseek: FakeDeepSeek;
let world: WebWorld | null = null;
let counter = 0;
const stores: SearchStore[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-web", "设置页的数据模块");
    model = fakeEndpoint();
    deepseek = fakeDeepSeek();
});
afterEach(async () => {
    for (const store of stores.splice(0)) store.dispose();
    deepseek.reset();
    await world?.close();
    world = null;
});
afterAll(async () => {
    model.stop();
    deepseek.stop();
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function storeOf(prepare?: (root: string) => Promise<void>): Promise<SearchStore> {
    counter += 1;
    const root = join(tmp, `w${String(counter)}`);
    await prepare?.(root);
    world = await webWorld(root, {deepseekBaseUrl: deepseek.baseUrl, modelBaseUrl: model.baseUrl});
    const store = createSearchStore(await world.settings("w"), () => 1000);
    stores.push(store);
    return store;
}

describe("数据模块接真实服务端", () => {
    it("start 之前是读取中，取到之后是未设置；写入后已设置，清除后未设置（输出 2、3、5）", async () => {
        const store = await storeOf();
        expect(store.status.value).toBeNull();
        await store.start();
        expect(store.status.value).toEqual({providers: {deepseek: {hasKey: false}}});
        expect(await store.setKey("deepseek", KEY)).toEqual({ok: true});
        expect(store.status.value).toEqual({providers: {deepseek: {hasKey: true}}});
        expect(await store.clearKey("deepseek")).toEqual({ok: true});
        expect(store.status.value).toEqual({providers: {deepseek: {hasKey: false}}});
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
        const first = store.check("deepseek");
        const second = store.check("deepseek");
        await waitUntil("the check reached the endpoint", () => deepseek.requests.length >= 2 || undefined);
        expect(store.checks.get("deepseek")).toEqual({status: "running"});
        deepseek.reset();
        await Promise.all([first, second]);
        expect(deepseek.requests).toHaveLength(0);
        expect(store.checks.get("deepseek")?.status).toBe("done");
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
        expect(store.status.value).toEqual({providers: {deepseek: {hasKey: true}}});
        expect(store.statusFailure.value).toBeNull();
    });
});

describe("结果未知与不可用（远程合同替身）", () => {
    /** 只有这两条要造链路中断的结局：它们取决于运行时的码，与服务端无关。 */
    function remoteWith(first: {readonly ok: false; readonly code: string}): {readonly remote: WebSettingsRemote; readonly statusCalls: () => number} {
        let calls = 0;
        const remote = {
            status: async () => {
                calls += 1;
                return {ok: true, value: {providers: {deepseek: {hasKey: true}}}};
            },
            setKey: async () => first,
            clearKey: async () => first,
            check: async () => first,
            events: {},
        };
        return {remote: remote as unknown as WebSettingsRemote, statusCalls: () => calls};
    }

    it("写入结果未知：交回 unknown-outcome，并重取状态（输出 6）", async () => {
        const {remote, statusCalls} = remoteWith({ok: false, code: "unknown-outcome"});
        const store = createSearchStore(remote);
        stores.push(store);
        await store.start();
        expect(await store.setKey("deepseek", KEY)).toMatchObject({ok: false, failure: {code: "unknown-outcome"}});
        await waitUntil("the status was fetched again", () => statusCalls() >= 2 || undefined);
    });

    it("unavailable 让页面只读；检测的远程失败记为没检成（输出 7、8）", async () => {
        const {remote} = remoteWith({ok: false, code: "unavailable"});
        const store = createSearchStore(remote);
        stores.push(store);
        await store.start();
        await store.check("deepseek");
        expect(store.checks.get("deepseek")).toMatchObject({status: "error", failure: {code: "unavailable"}});
        expect(store.available.value).toBe(false);
    });
});
