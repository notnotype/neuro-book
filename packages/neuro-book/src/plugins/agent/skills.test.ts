/**
 * Skill 经真实应用（docs/specs/agent/skills.md）：目录经窗口远程（输出 1、5）；`$` 带上 Skill 经真实内核与本机假端点，看模型
 * 收到的请求（输出 9–12，场景 2、3、8）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MAIN_PROFILE} from "./shared/contracts";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import {createSkillInit} from "./web/skill-init";
import {createSkillsClient} from "./web/skills";
import type {AgentWorld} from "./testing/world";

let tmp = "";
let counter = 0;
const worlds: AgentWorld[] = [];
let endpoint: FakeEndpoint;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "skills");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

let commands = 0;
const cid = () => `s-${String((commands += 1))}`;

/** 在状态根的 `user/skills/` 里放 Skill，再起场地。 */
async function world(skills: Readonly<Record<string, string>>, settings: Readonly<Record<string, unknown>> = {}): Promise<AgentWorld> {
    counter += 1;
    const base = join(tmp, `w${String(counter)}`);
    for (const [name, body] of Object.entries(skills)) {
        const directory = join(base, "state", "user", "skills", name);
        await mkdir(directory, {recursive: true});
        await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 的说明\n---\n\n${body}\n`);
    }
    const w = await agentWorld(base, {userSettings: {...localModelSettings(endpoint.baseUrl), ...settings}});
    worlds.push(w);
    return w;
}

const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => (typeof part === "object" && part !== null && "text" in part ? String(part.text) : "")).join("") : "");

/** 发一句话，交回模型收到的最后一条用户消息的文字。 */
async function ask(session: SessionApi, text: string): Promise<string> {
    const sent = endpoint.requests.length;
    endpoint.script("好");
    const result = await session.send({commandId: cid(), input: {text}});
    if (!result.ok || result.value.runId === null) throw new Error(`send failed: ${JSON.stringify(result)}`);
    await session.waitRun(result.value.runId);
    const users = endpoint.requests[sent]!.messages.filter((message) => message.role === "user");
    return textOf(users.at(-1)?.content);
}

const missingOf = async (session: SessionApi) => (await session.log({afterSeq: 0})).events.filter((event) => event.type.endsWith("skillMissing")).map((event) => event.data);

describe("这一轮带上 Skill", () => {
    test("场景 2、8：主创 $ 一个 Skill，正文在用户的话前面、带文件地址的说明；没改过再 $ 只带见前文；改了之后带新的", async () => {
        const w = await world({"style-guide": "第一版：人称用第一人称。"});
        const created = await w.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;

        const first = await ask(session, "用 $style-guide 改写第六章");
        const skill = first.indexOf('<skill id="user.style-guide" name="style-guide" location="skills://user.style-guide/SKILL.md">');
        expect(skill).toBeGreaterThanOrEqual(0);
        expect(first.indexOf("第一版：人称用第一人称。")).toBeGreaterThan(skill);
        expect(first.indexOf("用 $style-guide 改写第六章")).toBeGreaterThan(first.indexOf("</skill>"));
        expect(first).toContain("skills://user.style-guide/");

        const second = await ask(session, "再用 $style-guide 改第七章");
        expect(second).toContain("Skill「style-guide」见前文。");
        expect(second).not.toContain("第一版");

        await writeFile(join(w.stateRoot, "user", "skills", "style-guide", "SKILL.md"), "---\nname: style-guide\ndescription: 说明\n---\n\n第二版：人称用第三人称。\n");
        const third = await ask(session, "$style-guide 第八章");
        expect(third).toContain("第二版：人称用第三人称。");
        expect(await missingOf(session)).toEqual([]);
    }, 30_000);

    test("场景 3、7：不存在的、用户在 Profile 设置里去掉的都不带正文；模型在用户的话前面看到 system-reminder 写明原因；行内代码里的 $HOME 不算标签", async () => {
        const w = await world({"style-guide": "正文甲。"}, {"nbook.agent/profileSettings": {[MAIN_PROFILE]: {skills: {added: [], removed: ["user.style-guide"]}}}});
        const created = await w.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const text = await ask(session, "用 $nothing 和 $style-guide，跑 `echo $HOME`");
        expect(text).not.toContain("<skill");
        expect(text).not.toContain("正文甲");
        expect(await missingOf(session)).toEqual([{token: "nothing", reason: "not-found"}, {token: "style-guide", reason: "not-allowed"}]);
        const words = text.indexOf("用 $nothing 和 $style-guide");
        const notFound = text.indexOf("用户写的 $nothing 没有作为 Skill 带上：没有这个 Skill。");
        const notAllowed = text.indexOf("用户写的 $style-guide 没有作为 Skill 带上：它不在当前 Profile 能用的 Skill 里。");
        expect(notFound).toBeGreaterThanOrEqual(0);
        expect(notAllowed).toBeGreaterThan(notFound);
        expect(words).toBeGreaterThan(notAllowed);
        expect(text).not.toContain("$HOME 没有作为 Skill 带上");
    }, 30_000);
});

describe("远程", () => {
    test("输出 18、19：窗口经远程取初始化计划、初始化；装完状态变成可用；不能初始化的得 not-initializable", async () => {
        const w = await world({"plain": "正文"});
        const dep = join(w.stateRoot, "..", "local-dep");
        await mkdir(dep, {recursive: true});
        await writeFile(join(dep, "package.json"), JSON.stringify({name: "local-dep", version: "1.0.0", main: "index.js"}));
        await writeFile(join(dep, "index.js"), "module.exports = 1;\n");
        const directory = join(w.stateRoot, "user", "skills", "epub-export");
        await mkdir(directory, {recursive: true});
        await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"local-dep": `file:${dep}`}}));
        await writeFile(join(directory, "SKILL.md"), "---\nname: epub-export\ndescription: 导出\n---\n\n正文\n");
        const {client} = await w.window("init");
        const status = async () => {
            const listed = await client.skills({});
            return listed.ok ? listed.value.find((entry) => entry.id === "user.epub-export")?.status : undefined;
        };
        await waitUntil("新放进来的 Skill 是未初始化", async () => {
            w.settings.clock.advance(1_000);
            return (await status()) === "needs-init" || undefined;
        }, {timeoutMs: 10_000});
        expect(await client.skillInitPlan({id: "user.epub-export"})).toMatchObject({ok: true, value: {lock: false, dependencies: ["local-dep"]}});
        expect(await client.initSkill({id: "user.epub-export"})).toMatchObject({ok: false, code: "lock-missing"});
        expect(await client.initSkill({id: "user.epub-export", resolve: true})).toMatchObject({ok: true});
        expect(await status()).toBe("ready");
        expect(await client.initSkill({id: "user.plain"})).toMatchObject({ok: false, code: "not-initializable"});
    }, 60_000);

    test("输出 1、5：启动时已有的 Skill 取得到；放进新的 Skill 后收到 skillsChanged，再取就有它", async () => {
        counter += 1;
        const base = join(tmp, `w${String(counter)}`);
        const write = async (name: string) => {
            const directory = join(base, "state", "user", "skills", name);
            await mkdir(directory, {recursive: true});
            await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 的说明\n---\n\n正文\n`);
        };
        await write("style-guide");
        const w = await agentWorld(base);
        worlds.push(w);
        const {client} = await w.window("skills");
        let events = 0;
        const subscription = await client.events.skillsChanged.subscribe({}, () => {
            events += 1;
        });
        if (!subscription.ok) throw new Error(subscription.code);
        const ids = async () => {
            const listed = await client.skills({});
            if (!listed.ok) throw new Error(listed.code);
            return listed.value.map((entry) => `${entry.id}:${entry.status}`);
        };
        expect(await ids()).toEqual(["user.style-guide:ready"]);

        await write("lore-check");
        // 目录的重扫按宿主时钟防抖，场地的时钟是手动的：等文件事件到的同时推时钟。
        await waitUntil("收到 skillsChanged", () => {
            w.settings.clock.advance(1_000);
            return events > 0 || undefined;
        }, {timeoutMs: 10_000});
        expect(await ids()).toEqual(["user.lore-check:ready", "user.style-guide:ready"]);
    }, 20_000);
});

describe("窗口：目录与确认框（输出 5、27）", () => {
    test("窗口的目录跟着 skillsChanged 更新；确认框取计划、确认后装好并关上，目录里变成可用；装不上时停在失败、带安装输出，能重试", async () => {
        const w = await world({});
        const dep = join(w.stateRoot, "..", "local-dep");
        await mkdir(dep, {recursive: true});
        await writeFile(join(dep, "package.json"), JSON.stringify({name: "local-dep", version: "1.0.0", main: "index.js"}));
        await writeFile(join(dep, "index.js"), "module.exports = 1;\n");
        const directory = join(w.stateRoot, "user", "skills", "epub-export");
        await mkdir(directory, {recursive: true});
        await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"not-here": "file:./missing-dir"}}));
        await writeFile(join(directory, "SKILL.md"), "---\nname: epub-export\ndescription: 导出\n---\n\n正文\n");
        const {client} = await w.window("dialog");
        const controller = new AbortController();
        const fail = (message: string) => {
            throw new Error(message);
        };
        const skills = createSkillsClient(client, controller.signal, fail);
        skills.ensure();
        const entry = () => skills.entries.value?.find((item) => item.id === "user.epub-export");
        const found = await waitUntil("窗口的目录里有它、未初始化", () => {
            w.settings.clock.advance(1_000);
            return entry()?.status === "needs-init" ? entry() : undefined;
        }, {timeoutMs: 10_000});

        const init = createSkillInit(client, fail);
        await init.ask(found);
        expect(init.state.value).toMatchObject({open: true, name: "epub-export", phase: "confirm", plan: {lock: false, dependencies: ["not-here"]}});
        await init.confirm();
        expect(init.state.value).toMatchObject({open: true, phase: "failed", failure: {code: "install-failed"}});
        expect(init.state.value.failure?.output).toContain("missing-dir");

        await writeFile(join(directory, "package.json"), JSON.stringify({name: "epub-export", private: true, dependencies: {"local-dep": `file:${dep}`}}));
        await init.confirm();
        expect(init.state.value.open).toBe(false);
        await waitUntil("窗口的目录变成可用", () => {
            w.settings.clock.advance(1_000);
            return entry()?.status === "ready" || undefined;
        }, {timeoutMs: 10_000});
        controller.abort();
    }, 60_000);
});
