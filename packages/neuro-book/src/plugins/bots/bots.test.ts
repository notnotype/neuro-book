/**
 * `nbook.bots`（docs/specs/bots/bots.md、main-conversation.md）：真实服务端内核、真实 `nbook.agent` 与插件存储、经 JSON 编解码的远程链路，
 * 模型是本机的假端点（这里不发模型请求）。测试名里的编号是 bots.md（“bot”）与 main-conversation.md（“主对话”）的输出条目与验收场景。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {Database} from "bun:sqlite";
import {cp, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createJsonlStore} from "@notnotype/nb-harness/kernel";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {fakeEndpoint, localModelSettings} from "nbook/plugins/agent/testing/endpoint";
import type {FakeEndpoint} from "nbook/plugins/agent/testing/endpoint";
import {agentWorld} from "nbook/plugins/agent/testing/world";
import type {AgentWorld} from "nbook/plugins/agent/testing/world";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";

import {createBot} from "./backend/create";
import {locateBuiltinBots} from "./backend/builtin-root";
import {BUSY_RETRY_MS} from "./backend/main";
import {createBotsBackendPlugin} from "./backend/plugin";
import type {BotStore} from "./backend/store";
import {descriptor} from "./plugin";
import {botsContract, COMPANION_PROFILE, DEFAULT_PRESET} from "./shared/contracts";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-bots", "bots");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const BUILTIN = locateBuiltinBots();
if (BUILTIN === null) throw new Error("the builtin bots directory is missing from the source tree");

const useBots = (context: ActivationContext) => context.remote.use(botsContract);
type BotsClient = ReturnType<typeof useBots>;

/** 起一个世界，交回它与一个窗口里的 `nbook.bots/bots` 客户端。`path` 相同就是同一个状态根（重启）。 */
async function open(path: string, locate: () => string | null = () => BUILTIN): Promise<{readonly w: AgentWorld; readonly client: BotsClient; readonly bots: string}> {
    const w = await agentWorld(path, {plugins: [storageBackendPlugin, definitionAt("server", descriptor, createBotsBackendPlugin(locate))], userSettings: localModelSettings(endpoint.baseUrl)});
    worlds.push(w);
    let captured: ActivationContext | null = null;
    counter += 1;
    const page: PluginDefinition = {id: `test.bots-page-${String(counter)}`, entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
        captured = context;
        return {};
    }})]};
    await w.settings.window(`bots-${String(counter)}`, [page], {bound: false});
    if (captured === null) throw new Error("the test page did not activate");
    return {w, client: useBots(captured as ActivationContext), bots: join(w.stateRoot, "user", "bots")};
}

/** 关掉世界（从 afterEach 的名单里拿掉）。 */
async function close(w: AgentWorld): Promise<void> {
    worlds.splice(worlds.indexOf(w), 1);
    await w.close();
}

const fresh = (): string => join(root, `w${String((counter += 1))}`);
const events = (w: AgentWorld, event: string) => w.settings.diagnostics("hub").query({}).records.filter((record) => record.event === event);

function ok<T>(result: {readonly ok: boolean; readonly value?: T; readonly code?: string}): T {
    if (!result.ok) throw new Error(`remote call failed: ${JSON.stringify(result)}`);
    return result.value as T;
}

async function locked(w: AgentWorld, id: string): Promise<boolean> {
    const store = createJsonlStore({root: join(w.stateRoot, "agent", "sessions")});
    const opened = await store.open(id);
    if (!opened.ok) return opened.code === "session-busy";
    await store.close(opened.value);
    return false;
}

/** 一份内置资源的副本：测试在上面改文件（换一版人设、拿掉头像），不动源码里的。 */
async function builtinCopy(change?: (directory: string) => Promise<void>): Promise<string> {
    const directory = join(fresh(), "builtin");
    await cp(BUILTIN!, directory, {recursive: true});
    await change?.(directory);
    return directory;
}

describe("bot 与主对话", () => {
    test("bot 验收 1、主对话验收 1：全新的状态根建出 lyra，主对话 none；ensureMain 建出有归属的 bot-lyra 并持有，并发同一个 id、不进会话列表；重启不再建、不覆盖人设，后台重新持有并记打开耗时", async () => {
        const path = fresh();
        const first = await open(path);
        await waitUntil("建出 lyra", async () => ok(await first.client.list({})).length === 1);
        expect(ok(await first.client.list({}))).toEqual([{id: "lyra", name: "星璃", main: {state: "none"}}]);
        expect((await readdir(join(first.bots, "lyra"))).sort()).toEqual([".created.json", "avatar.webp", "persona.md"]);
        expect(events(first.w, "bots.main-opened")).toEqual([]);

        const [a, b] = await Promise.all([first.client.ensureMain({botId: "lyra"}), first.client.ensureMain({botId: "lyra"})]);
        expect([ok(a), ok(b)]).toEqual([{sessionId: "bot-lyra"}, {sessionId: "bot-lyra"}]);
        expect(ok(await first.client.list({}))[0]?.main).toEqual({state: "held"});
        expect(await first.w.service.header("bot-lyra")).toMatchObject({ok: true, value: {owner: {plugin: "nbook.bots", id: "lyra"}, profile: COMPANION_PROFILE}});
        const listed = await first.w.service.list({archived: undefined, background: undefined});
        expect(listed.ok && listed.value.map((entry) => entry.id)).not.toContain("bot-lyra");
        // 刚建出来的会话本来就开着：不记打开耗时。
        expect(events(first.w, "bots.main-opened")).toEqual([]);
        // 持有期间不空闲关闭；有归属的会话不改写历史（主对话验收 3 的后一半）。
        first.w.settings.clock.advance(60_000);
        expect(await locked(first.w, "bot-lyra")).toBe(true);
        const {client: sessions} = await first.w.window("s");
        expect(await sessions.rewind({sessionId: "bot-lyra", commandId: "r-1", to: null})).toMatchObject({ok: false, code: "owned-session"});
        expect(await first.client.ensureMain({botId: "nope"})).toMatchObject({ok: false, code: "unknown-bot"});

        await writeFile(join(first.bots, "lyra", "persona.md"), "用户改过的人设");
        await close(first.w);
        const second = await open(path);
        await waitUntil("后台重新持有", async () => ok(await second.client.list({}))[0]?.main.state === "held");
        expect(ok(await second.client.list({})).map((bot) => bot.id)).toEqual(["lyra"]);
        expect(await readFile(join(second.bots, "lyra", "persona.md"), "utf8")).toBe("用户改过的人设");
        const opened = events(second.w, "bots.main-opened");
        expect(opened).toHaveLength(1);
        expect(opened[0]?.data).toMatchObject({bot: "lyra", session: "bot-lyra", events: expect.any(Number), ms: expect.any(Number)});
        expect(await locked(second.w, "bot-lyra")).toBe(true);
    });

    test("bot 输出 5：改名之后、写记录之前退出的现场补写记录、不再复制；暂存目录有凭据或空的删掉，别的不动", async () => {
        const path = fresh();
        const bots = join(path, "state", "user", "bots");
        await mkdir(bots, {recursive: true});
        // 用真实的建 bot 步骤留下现场：记录写不下（进程在这一步之前退出）。
        const versionOne = await builtinCopy(async (directory) => writeFile(join(directory, "lyra", "persona.md"), "第一版人设"));
        const crashing = {add: () => Promise.reject(new Error("进程退出"))} as unknown as BotStore;
        const preset = {id: DEFAULT_PRESET, plugin: "nbook.bots", declaration: {name: "星璃", avatar: "lyra/avatar.webp", profile: COMPANION_PROFILE, persona: "lyra/persona.md"}, persona: join(versionOne, "lyra", "persona.md"), avatar: join(versionOne, "lyra", "avatar.webp"), memorySeed: null};
        await expect(createBot({root: bots, store: crashing, report: () => undefined}, preset, "lyra", 1)).rejects.toThrow("进程退出");
        expect(await readdir(bots)).toEqual(["lyra"]);
        await mkdir(join(bots, ".staging-receipt"));
        await writeFile(join(bots, ".staging-receipt", ".created.json"), "{}");
        await mkdir(join(bots, ".staging-empty"));
        await mkdir(join(bots, ".staging-other"));
        await writeFile(join(bots, ".staging-other", "notes.txt"), "不是我们的");

        const {w, client} = await open(path, () => BUILTIN);
        await waitUntil("补写记录", async () => ok(await client.list({})).length === 1);
        expect(ok(await client.list({})).map((bot) => [bot.id, bot.name])).toEqual([["lyra", "星璃"]]);
        expect(await readFile(join(bots, "lyra", "persona.md"), "utf8")).toBe("第一版人设");
        expect((await readdir(bots)).sort()).toEqual([".staging-other", "lyra"]);
        expect(events(w, "bots.directory-unknown")).toEqual([]);
    });

    test("bot 输出 5：bot 目录在、记录不在、又没有凭据：不登记、不覆盖、写 bots.directory-unknown", async () => {
        const path = fresh();
        const bots = join(path, "state", "user", "bots");
        await mkdir(join(bots, "lyra"), {recursive: true});
        await writeFile(join(bots, "lyra", "persona.md"), "别人的东西");
        const {w, client} = await open(path);
        await waitUntil("有诊断", () => events(w, "bots.directory-unknown").length === 1);
        await waitUntil("建 bot 也不覆盖", () => events(w, "bots.create-failed").length === 1);
        expect(ok(await client.list({}))).toEqual([]);
        expect(await readFile(join(bots, "lyra", "persona.md"), "utf8")).toBe("别人的东西");
    });

    test("bot 输出 6：记录读不懂（版本不认识）时不当成没有 bot：不建新的、写 bots.record-unreadable", async () => {
        const path = fresh();
        const first = await open(path);
        await waitUntil("建出 lyra", async () => ok(await first.client.list({})).length === 1);
        await close(first.w);
        const database = new Database(join(path, "state", "storage", "user.sqlite"));
        database.query("UPDATE records SET version = 2 WHERE owner = 'nbook.bots' AND key = 'bots'").run();
        database.close();
        const {w, client} = await open(path);
        await waitUntil("有诊断", () => events(w, "bots.record-unreadable").length === 1);
        expect(ok(await client.list({}))).toEqual([]);
        expect(await client.ensureMain({botId: "lyra"})).toMatchObject({ok: false, code: "unknown-bot"});
        expect(await readdir(join(path, "state", "user", "bots"))).toEqual(["lyra"]);
    });

    test("bot 输出 4、验收 1：缺省预设的头像不在了：已有的 bot 照常持有主对话；没有 bot 时不建、写 bots.default-preset-missing", async () => {
        const path = fresh();
        const first = await open(path);
        await waitUntil("建出 lyra", async () => ok(await first.client.list({})).length === 1);
        ok(await first.client.ensureMain({botId: "lyra"}));
        await close(first.w);
        const broken = await builtinCopy(async (directory) => rm(join(directory, "lyra", "avatar.webp")));
        const second = await open(path, () => broken);
        await waitUntil("照常持有", async () => ok(await second.client.list({}))[0]?.main.state === "held");
        expect(events(second.w, "bots.preset-invalid").map((record) => record.data)).toEqual([expect.objectContaining({plugin: "nbook.bots", preset: DEFAULT_PRESET})]);

        const empty = await open(fresh(), () => broken);
        await waitUntil("没有建", () => events(empty.w, "bots.default-preset-missing").length === 1);
        expect(ok(await empty.client.list({}))).toEqual([]);
        // 安装里没有内置资源目录时同样不建。
        const missing = await open(fresh(), () => null);
        await waitUntil("没有建", () => events(missing.w, "bots.default-preset-missing").length === 1);
    });

    test("主对话验收 2：会话库里已有 id 为 bot-lyra、不归它的会话（带没收口的运行）：后台任务与 ensureMain 都得 owner-mismatch，那个会话的日志字节不变", async () => {
        const path = fresh();
        const first = await open(path);
        await waitUntil("建出 lyra", async () => ok(await first.client.list({})).length === 1);
        const created = await first.w.service.create({profile: COMPANION_PROFILE, id: "bot-lyra"});
        if (!created.ok) throw new Error(created.code);
        const hold = endpoint.hold();
        const sent = await created.value.send({commandId: "c-1", input: {text: "在吗"}});
        if (!sent.ok) throw new Error(sent.code);
        await hold.arrived;
        const log = join(path, "state", "agent", "sessions", "bot-lyra", "session.jsonl");
        const crashed = await readFile(log);
        hold.release();
        await close(first.w);
        await writeFile(log, crashed);

        const second = await open(path);
        await waitUntil("后台任务得 owner-mismatch", async () => ok(await second.client.list({}))[0]?.main.state === "failed");
        expect(ok(await second.client.list({}))[0]?.main).toEqual({state: "failed", code: "owner-mismatch"});
        expect(await second.client.ensureMain({botId: "lyra"})).toMatchObject({ok: false, code: "owner-mismatch"});
        expect(await readFile(log)).toEqual(crashed);
        expect(await locked(second.w, "bot-lyra")).toBe(false);
    });

    test("主对话输出 2：主对话被别处持有时记 failed{session-busy}，每 5 秒重试，放开之后持有", async () => {
        const path = fresh();
        const first = await open(path);
        await waitUntil("建出 lyra", async () => ok(await first.client.list({})).length === 1);
        ok(await first.client.ensureMain({botId: "lyra"}));
        await close(first.w);
        const other = createJsonlStore({root: join(path, "state", "agent", "sessions")});
        const held = await other.open("bot-lyra");
        if (!held.ok) throw new Error(held.code);
        const second = await open(path);
        await waitUntil("记 session-busy", async () => ok(await second.client.list({}))[0]?.main.state === "failed");
        expect(ok(await second.client.list({}))[0]?.main).toEqual({state: "failed", code: "session-busy"});
        await other.close(held.value);
        second.w.settings.clock.advance(BUSY_RETRY_MS - 1);
        expect(ok(await second.client.list({}))[0]?.main.state).toBe("failed");
        second.w.settings.clock.advance(1);
        await waitUntil("重试后持有", async () => ok(await second.client.list({}))[0]?.main.state === "held");
    });

    test("bot 输出 3：岗位 Profile 有主创的工具与 Agent 模式：在主对话里真调 switch_mode 得合法结果", async () => {
        const {w, client} = await open(fresh());
        await waitUntil("建出 lyra", async () => ok(await client.list({})).length === 1);
        ok(await client.ensureMain({botId: "lyra"}));
        const main = w.service.session("bot-lyra");
        endpoint.script({tool: "switch_mode", args: {mode: "normal"}}, "好");
        const sent = await main.send({commandId: "m-1", input: {text: "现在什么模式"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await main.waitRun(sent.value.runId);
        const results = (await main.path()).filter((event) => event.type === "toolResult").map((event) => event.data as {text: string; code?: string});
        expect(results).toEqual([expect.objectContaining({text: "已经是 normal 模式。"})]);
        expect(w.service.profiles().find((profile) => profile.key === COMPANION_PROFILE)).toMatchObject({status: "ok", hidden: true});
    });

    test("bot 输出 7：botsChanged 推出持有状态的变化", async () => {
        const {client} = await open(fresh());
        await waitUntil("建出 lyra", async () => ok(await client.list({})).length === 1);
        const pushed: unknown[] = [];
        const subscribed = await client.events.botsChanged.subscribe({}, (payload) => pushed.push(payload));
        if (!subscribed.ok) throw new Error(subscribed.code);
        ok(await client.ensureMain({botId: "lyra"}));
        await waitUntil("推到 held", () => pushed.some((payload) => JSON.stringify(payload).includes("\"held\"")));
        expect(pushed.at(-1)).toEqual([{id: "lyra", name: "星璃", main: {state: "held"}}]);
        subscribed.value.release();
    });
});
