/**
 * `nbook.bots`（docs/specs/bots/bots.md、main-conversation.md）：真实服务端内核、真实 `nbook.agent` 与插件存储、经 JSON 编解码的远程链路，
 * 模型是本机的假端点（这里不发模型请求）。测试名里的编号是 bots.md（“bot”）与 main-conversation.md（“主对话”）的输出条目与验收场景。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {Database} from "bun:sqlite";
import {cp, mkdir, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {HostCapability} from "nbook/plugins/settings/testing/world";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createJsonlStore, defineProfile} from "@notnotype/nb-harness/kernel";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {fakeEndpoint, localModelSettings} from "nbook/plugins/agent/testing/endpoint";
import type {FakeEndpoint} from "nbook/plugins/agent/testing/endpoint";
import {agentWorld} from "nbook/plugins/agent/testing/world";
import type {AgentWorld} from "nbook/plugins/agent/testing/world";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {agentProfile} from "nbook/plugins/agent/shared/points";
import {createPluginPackages, pluginPackagesKey} from "nbook/plugin-platform/backend/packages";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

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
/** `extra`：另装的插件；`capabilities`：另给的宿主能力（例如插件包查询）。 */
async function open(path: string, locate: () => string | null = () => BUILTIN, extra: {readonly plugins?: PluginDefinition[]; readonly capabilities?: HostCapability[]} = {}): Promise<{readonly w: AgentWorld; readonly client: BotsClient; readonly bots: string}> {
    const w = await agentWorld(path, {plugins: [storageBackendPlugin, definitionAt("server", descriptor, createBotsBackendPlugin(locate)), ...(extra.plugins ?? [])], userSettings: localModelSettings(endpoint.baseUrl), ...(extra.capabilities === undefined ? {} : {capabilities: extra.capabilities})});
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
        expect(ok(await first.client.list({}))).toEqual([{id: "lyra", name: "星璃", main: {state: "none"}, unread: null, latestSeq: 0, seenSeq: 0}]);
        expect((await readdir(join(first.bots, "lyra"))).sort()).toEqual([".created.json", "avatar.webp", "persona.md"]);
        expect(events(first.w, "bots.main-opened")).toEqual([]);
        // 建 bot 不需要模型；记录只有这五个字段（模型、推理档、审批模式不另存）。
        expect(endpoint.requests).toEqual([]);
        const database = new Database(join(path, "state", "storage", "user.sqlite"), {readonly: true});
        const row = database.query("SELECT version, value FROM records WHERE owner = 'nbook.bots' AND key = 'bots'").get() as {version: number; value: string};
        database.close();
        expect(row.version).toBe(1);
        expect(JSON.parse(row.value)).toEqual({bots: [{id: "lyra", name: "星璃", preset: DEFAULT_PRESET, profile: COMPANION_PROFILE, createdAt: expect.any(Number)}]});

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
        // 后台任务开始时岗位 Profile 已能解析：重新持有的主对话不是只读。
        expect((await second.w.service.session("bot-lyra").snapshot()).readOnly).toBeNull();
    });

    test("主对话输出 1、4：主对话的 Profile 取自 bot 记录；之后那个 Profile 解析不到时，后台照样持有，会话以只读打开", async () => {
        const PROFILE = "test.botprofile.writer";
        const declared = agentProfile(PROFILE, {name: "写手", description: "测试用", tools: {required: [], optional: []}});
        const profiles: PluginDefinition = {id: "test.botprofile", entries: [defineEntry({id: "server", location: "server", activationEvents: [declared.activationEvent], contributions: [declared.contribution], activate: () => ({contributions: {"agent.profiles": {[PROFILE]: defineProfile({id: PROFILE, version: "1", name: "写手", description: "测试用", system: "你是写手。"})}}})})]};
        const path = fresh();
        const first = await open(path, () => BUILTIN, {plugins: [profiles]});
        await waitUntil("建出 lyra", async () => ok(await first.client.list({})).length === 1);
        await close(first.w);
        const database = new Database(join(path, "state", "storage", "user.sqlite"));
        const row = database.query("SELECT value FROM records WHERE owner = 'nbook.bots' AND key = 'bots'").get() as {value: string};
        database.query("UPDATE records SET value = ?1 WHERE owner = 'nbook.bots' AND key = 'bots'").run(row.value.replace(`"profile":"${COMPANION_PROFILE}"`, `"profile":"${PROFILE}"`));
        database.close();

        const second = await open(path, () => BUILTIN, {plugins: [profiles]});
        await waitUntil("读到记录", async () => ok(await second.client.list({})).length === 1);
        ok(await second.client.ensureMain({botId: "lyra"}));
        expect(await second.w.service.header("bot-lyra")).toMatchObject({ok: true, value: {profile: PROFILE}});
        await close(second.w);

        const third = await open(path);
        await waitUntil("照样持有", async () => ok(await third.client.list({}))[0]?.main.state === "held");
        expect((await third.w.service.session("bot-lyra").snapshot()).readOnly).toEqual({code: "unknown-profile"});
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

    test("bot 输出 5：bot 目录在、记录不在、又没有读得懂且对得上的凭据：不登记、不覆盖、写 bots.directory-unknown", async () => {
        const path = fresh();
        const bots = join(path, "state", "user", "bots");
        await mkdir(join(bots, "lyra"), {recursive: true});
        await writeFile(join(bots, "lyra", "persona.md"), "别人的东西");
        // 凭据读不懂、凭据里的 bot id 对不上目录名：同样不登记。
        await mkdir(join(bots, "nova"));
        await writeFile(join(bots, "nova", ".created.json"), "{不是 JSON");
        await mkdir(join(bots, "vega"));
        await writeFile(join(bots, "vega", ".created.json"), JSON.stringify({format: 1, botId: "other", record: {id: "other", name: "别的", preset: DEFAULT_PRESET, profile: COMPANION_PROFILE, createdAt: 1}}));
        const {w, client} = await open(path);
        await waitUntil("有诊断", () => events(w, "bots.directory-unknown").length === 3);
        expect(events(w, "bots.directory-unknown").map((record) => (record.data as {bot: string}).bot).sort()).toEqual(["lyra", "nova", "vega"]);
        await waitUntil("建 bot 也不覆盖", () => events(w, "bots.create-failed").length === 1);
        expect(ok(await client.list({}))).toEqual([]);
        expect(await readFile(join(bots, "lyra", "persona.md"), "utf8")).toBe("别人的东西");
    });

    test("bot 输出 5：预设带记忆种子时，建出的 bot 目录里 memory/ 是种子的副本", async () => {
        const seeded = await builtinCopy(async (directory) => {
            await mkdir(join(directory, "seed", "notes"), {recursive: true});
            await writeFile(join(directory, "seed", "notes", "first.md"), "第一条记忆");
        });
        const bots = join(fresh(), "bots");
        let added: unknown = null;
        const store = {add: async (bot: unknown) => {
            added = bot;
            return {ok: true, bots: [bot]};
        }} as unknown as BotStore;
        const preset = {id: "test.seed", plugin: "test", declaration: {name: "种子", avatar: "lyra/avatar.webp", profile: COMPANION_PROFILE, persona: "lyra/persona.md", memorySeed: "seed"}, persona: join(seeded, "lyra", "persona.md"), avatar: join(seeded, "lyra", "avatar.webp"), memorySeed: join(seeded, "seed")};
        expect(await createBot({root: bots, store, report: () => undefined}, preset, "seed-bot", 3)).toMatchObject({ok: true});
        expect(await readFile(join(bots, "seed-bot", "memory", "notes", "first.md"), "utf8")).toBe("第一条记忆");
        expect(added).toEqual({id: "seed-bot", name: "种子", preset: "test.seed", profile: COMPANION_PROFILE, createdAt: 3});
    });

    test("bot 输出 1、验收 2：第三方插件的预设经插件包查询找文件：合法的可用，人设是越出插件包的链接的不可用、写诊断，缺省 bot 照常建", async () => {
        const root = join(fresh(), "example.botpack", "1.0.0");
        await mkdir(join(root, "presets"), {recursive: true});
        await cp(join(BUILTIN!, "lyra", "avatar.webp"), join(root, "presets", "avatar.webp"));
        await writeFile(join(root, "presets", "persona.md"), "第三方的人设");
        await writeFile(join(root, "..", "outside.md"), "包外的文件");
        await symlink(join(root, "..", "outside.md"), join(root, "presets", "escape.md"));
        const packages = createPluginPackages([{id: "example.botpack", version: "1.0.0", root, digest: "test", manifest: {}}], NEUROBOOK_PROFILE.format);
        const third: PluginDefinition = {id: "example.botpack", entries: [], contributions: [
            {capability: "bots.presets", id: "example.botpack.good", declaration: {name: "合法", avatar: "presets/avatar.webp", profile: COMPANION_PROFILE, persona: "presets/persona.md"}},
            {capability: "bots.presets", id: "example.botpack.escape", declaration: {name: "越界", avatar: "presets/avatar.webp", profile: COMPANION_PROFILE, persona: "presets/escape.md"}},
        ]};
        const {w, client} = await open(fresh(), () => BUILTIN, {plugins: [third], capabilities: [{id: "host.plugin-packages", key: pluginPackagesKey, create: () => packages}]});
        await waitUntil("建出 lyra", async () => ok(await client.list({})).length === 1);
        await waitUntil("越界的有诊断", () => events(w, "bots.preset-invalid").length === 1);
        expect(events(w, "bots.preset-invalid")[0]?.data).toMatchObject({plugin: "example.botpack", preset: "example.botpack.escape"});
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

    test("bot 输出 5、6：记录里的 bot id 不合规则（合法的 JSON）：整份按读不懂处理，不登记、不建主对话，原数据不改写", async () => {
        const path = fresh();
        const first = await open(path);
        await waitUntil("建出 lyra", async () => ok(await first.client.list({})).length === 1);
        await close(first.w);
        const file = join(path, "state", "storage", "user.sqlite");
        const database = new Database(file);
        const row = database.query("SELECT value FROM records WHERE owner = 'nbook.bots' AND key = 'bots'").get() as {value: string};
        const changed = row.value.replace('"id":"lyra"', '"id":"LYRA"');
        expect(changed).not.toBe(row.value);
        database.query("UPDATE records SET value = ?1 WHERE owner = 'nbook.bots' AND key = 'bots'").run(changed);
        database.close();
        const {w, client} = await open(path);
        await waitUntil("有诊断", () => events(w, "bots.record-unreadable").length === 1);
        expect(ok(await client.list({}))).toEqual([]);
        expect(await client.ensureMain({botId: "LYRA"})).toMatchObject({ok: false, code: "unknown-bot"});
        expect(await w.service.header("bot-LYRA")).toMatchObject({ok: false, code: "session-not-found"});
        await close(w);
        const after = new Database(file);
        expect((after.query("SELECT value FROM records WHERE owner = 'nbook.bots' AND key = 'bots'").get() as {value: string}).value).toBe(changed);
        after.close();
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

    test("bot 输出 3：岗位 Profile 有主创的工具、Agent 模式与可派的子代理：在主对话里真调 switch_mode 与 agent_spawn 都得合法结果；提示词不把没有主项目的对话引向 project://", async () => {
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
        const system = endpoint.requests.at(-1)?.system ?? "";
        expect(system).toContain("projects://<短名>/");
        // 人设不进岗位 Profile 的提示词（人设怎样进提示词归 t09）。
        expect(system).not.toContain("忆星书庭");
        expect(system).not.toContain("书的文件在 project://");

        endpoint.scriptFor("先读一遍", "读完了");
        endpoint.script({tool: "agent_spawn", args: {profile: "nbook.agent.adhoc", prompt: "先读一遍", initial: {role: "设定核对员"}}}, "好");
        const spawning = await main.send({commandId: "m-2", input: {text: "派一个去读"}});
        if (!spawning.ok || spawning.value.runId === null) throw new Error(JSON.stringify(spawning));
        await main.waitRun(spawning.value.runId);
        const spawned = (await main.path()).filter((event) => event.type === "toolResult").map((event) => event.data as {tool: string; code?: string; status: string}).filter((data) => data.tool === "nbook.agent.spawn");
        expect(spawned).toEqual([expect.objectContaining({status: "ok"})]);
        expect(spawned[0]?.code).toBeUndefined();
    });

    test("主对话的未读：持有后数出计数消息，调工具的中间回复不算；markSeen 截到最新、只进不退；重启后照样数出来", async () => {
        const path = fresh();
        const first = await open(path);
        await waitUntil("建出 lyra", async () => ok(await first.client.list({})).length === 1);
        ok(await first.client.ensureMain({botId: "lyra"}));
        const item = async (w = first) => ok(await w.client.list({}))[0];
        await waitUntil("数完", async () => (await item())?.unread === 0);
        const main = first.w.service.session("bot-lyra");
        const say = async (text: string): Promise<void> => {
            const sent = await main.send({commandId: crypto.randomUUID(), input: {text}});
            if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
            await main.waitRun(sent.value.runId);
        };
        endpoint.script({tool: "switch_mode", args: {mode: "normal"}}, "第一句回复");
        await say("你好");
        await waitUntil("一条未读", async () => (await item())?.unread === 1);
        endpoint.script("第二句回复");
        await say("再说一句");
        await waitUntil("两条未读", async () => (await item())?.unread === 2);
        const before = (await item())!;
        expect(before.latestSeq).toBeGreaterThan(before.seenSeq);

        // 交得比最新还大：截到最新的计数消息；交小的不退回去。
        expect(ok(await first.client.markSeen({botId: "lyra", through: 1_000_000}))).toEqual({seenSeq: before.latestSeq});
        expect(await item()).toMatchObject({unread: 0, seenSeq: before.latestSeq, latestSeq: before.latestSeq});
        expect(ok(await first.client.markSeen({botId: "lyra", through: 0}))).toEqual({seenSeq: before.latestSeq});
        endpoint.script("第三句回复");
        await say("还有");
        await waitUntil("新的一条未读", async () => (await item())?.unread === 1);
        expect(await first.client.markSeen({botId: "nope", through: 1})).toMatchObject({ok: false, code: "unknown-bot"});

        await close(first.w);
        const second = await open(path);
        await waitUntil("重启后数出来", async () => (await item(second))?.unread === 1);
        expect((await item(second))?.seenSeq).toBe(before.latestSeq);
    });

    test("bot 输出 7：botsChanged 推出持有状态的变化", async () => {
        const {client} = await open(fresh());
        await waitUntil("建出 lyra", async () => ok(await client.list({})).length === 1);
        const pushed: unknown[] = [];
        const subscribed = await client.events.botsChanged.subscribe({}, (payload) => pushed.push(payload));
        if (!subscribed.ok) throw new Error(subscribed.code);
        ok(await client.ensureMain({botId: "lyra"}));
        await waitUntil("推到 held", () => pushed.some((payload) => JSON.stringify(payload).includes("\"held\"")));
        expect(pushed.at(-1)).toEqual([expect.objectContaining({id: "lyra", name: "星璃", main: {state: "held"}})]);
        subscribed.value.release();
    });
});
