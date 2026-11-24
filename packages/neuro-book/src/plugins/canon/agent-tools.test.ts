/**
 * canon 给 Agent 的工具（docs/specs/canon/agent-tools.md）：项目跑在真实子进程里，世界服务是真实的；工具的实现是产品代码，测试插件在
 * 服务端拿到项目登记与远程节点后直接调用它们（同 `agent/builtin-tools-project.test.ts`），审批与工具表由 agent 插件自己的测试管。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {ToolContext, ToolImplementation, ToolResult, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";
import {replaceLocked} from "@notnotype/nb-file-lock";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {projectsKey} from "nbook/shared/projects";
import type {ProjectsService} from "nbook/shared/projects";

import {AGENT_TOOL_IDS, CANON_AGENT_TOOL_CONTRIBUTIONS, canonAgentTools} from "./backend/agent-tools";
import {serverPlugins, until, windowOf} from "./testing/harness";

let tmp = "";
const harnesses: ProjectHarness[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "agent-tools");
});
afterEach(async () => {
    try {
        for (const harness of harnesses.splice(0)) await harness.parent.stop();
    } finally {
        killSpawnedProjects();
    }
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

let invocation = 0;

/** 一个跑着 `book` 的服务端与项目子进程，加一个拿项目登记与远程节点的测试插件；`run` 以会话 `s1` 的身份调一个工具。 */
async function scene(project: string | null = "book") {
    const held: {projects: ProjectsService | null; remote: ActivationContext["remote"] | null} = {projects: null, remote: null};
    const consumer: PluginDefinition = {id: "test.consumer", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        dependencies: [{key: projectsKey}],
        activate: (context) => {
            held.projects = context.services.require(projectsKey);
            held.remote = context.remote;
            return {};
        },
    })]};
    const h = await projectHarness(tmp, {plugins: [...serverPlugins(), consumer]});
    harnesses.push(h);
    const keep = leaseOf(await h.manager.acquire("book", "test"));
    await h.ready(1);
    const author = await windowOf(h, "browser-1", "profile-1");
    await mkdir(join(h.project.path, "manuscripts.binder"), {recursive: true});
    const binder = await replaceLocked(join(h.project.path, "manuscripts.binder", "binder.xml"), {lockPath: join(h.project.path, ".nbook", "locks", "binder.lock"), decide: () => ({write: `<binder><chapter id="1"/><chapter id="2"/></binder>`}), report: () => undefined});
    expect(binder.ok).toBe(true);
    await until(async () => {
        const read = await author.canon.call("chapters", {});
        return read.ok && read.value.items.length === 2;
    });
    const tools = canonAgentTools({projects: held.projects, remote: held.remote!});
    const session = {sessionId: "s1", profile: "p", ...(project === null ? {} : {project})} as ToolSessionContext;
    const built = new Map<string, ToolImplementation>();
    const run = async (tool: string, args: Readonly<Record<string, unknown>>, at: {readonly invocation?: string; readonly callId?: string} = {}): Promise<ToolResult> => {
        let implementation = built.get(tool);
        if (implementation === undefined) {
            implementation = await tools[tool]!.create(session, {} as never);
            built.set(tool, implementation);
        }
        const call = {signal: new AbortController().signal, callId: at.callId ?? "call-1", invocation: at.invocation ?? `inv-${String(++invocation)}`, sessionId: "s1", initial: undefined, read: () => undefined} as unknown as ToolContext;
        return await implementation.execute(args, call) as ToolResult;
    };
    return {h, author, run, close: async () => {
        await author.close();
        keep.release();
    }};
}

/** 读取结果第一行里的版本串。 */
const versionIn = (result: ToolResult): string => /版本：(\S+)/u.exec(result.text)?.[1] ?? "";

describe("canon 的 Agent 工具（canon/agent-tools.md）", () => {
    it("声明：四个工具都给所有会话，查、读、看树是读，写是写；名字加 canon_ 前缀", () => {
        expect(CANON_AGENT_TOOL_CONTRIBUTIONS.map((item) => [item.id, item.declaration.providerName, item.declaration.effect, item.declaration.defaultForAll])).toEqual([
            [AGENT_TOOL_IDS.lookup, "canon_lookup", "read", true],
            [AGENT_TOOL_IDS.tree, "canon_tree", "read", true],
            [AGENT_TOOL_IDS.read, "canon_read", "read", true],
            [AGENT_TOOL_IDS.write, "canon_write", "write", true],
        ]);
    });

    it("建条目、按名字查、读字段、带版本改；写入者是这个会话的 Agent，作者在改动记录里看得到", async () => {
        const {author, run, close} = await scene();
        // 只建新条目时不用版本；同一批里的代号当上级。
        const created = await run(AGENT_TOOL_IDS.write, {title: "建人物", edits: [
            {op: "create", key: "group", name: "学院", kind: "组织"},
            {op: "create", key: "xia", name: "星瑕", kind: "人物", parent: "$group", aliases: ["小瑕"], components: ["人物"], fields: {"人物.性格": "银白长发"}},
        ]});
        expect(created.status).not.toBe("error");
        expect(created.text).toContain("已写入");
        const ids = (created.details as {ids: Record<string, string>}).ids;
        const xia = ids["tmp:xia"]!;

        const found = await run(AGENT_TOOL_IDS.lookup, {names: ["小瑕", "雾崎"]});
        expect(found.text).toContain(`${xia} 人物「星瑕」`);
        expect(found.text).toContain("“雾崎”：没有这个名字的条目");

        const read = await run(AGENT_TOOL_IDS.read, {entry: "星瑕"});
        expect(read.text).toContain("性格 = 银白长发");
        const version = versionIn(read);
        expect(version).toMatch(/^\d+·[0-9a-f]{12}$/u);

        const written = await run(AGENT_TOOL_IDS.write, {title: "改外观", version, edits: [{op: "set", entry: "星瑕", field: "人物.性格", value: "黑色短发"}, {op: "aliases", entry: "星瑕", add: ["夜王"]}]});
        expect(written.status).not.toBe("error");
        const reread = await run(AGENT_TOOL_IDS.read, {entry: xia});
        expect(reread.text).toContain("性格 = 黑色短发");
        expect(reread.text).toContain("夜王");

        const revisions = await author.canon.call("revisions", {filter: {entry: xia}});
        expect(revisions.ok && revisions.value.items[0]).toMatchObject({by: {kind: "agent", session: "s1"}, title: "改外观", what: "creative"});
        await close();
    }, 60_000);

    it("主文字的块由模型自己分：create 的 text 是一块；addBlock 的 after 写块 id 是放在它后面，写 null 是放在最前，不写是放在最后", async () => {
        const {author, run, close} = await scene();
        const created = await run(AGENT_TOOL_IDS.write, {title: "建条目", edits: [{op: "create", key: "school", name: "学院", kind: "组织", text: "第一段。\n\n第二段，和第一段在同一块里。"}]});
        expect(created.status).not.toBe("error");
        const school = (created.details as {ids: Record<string, string>}).ids["tmp:school"]!;
        const version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: school}));
        const added = await run(AGENT_TOOL_IDS.write, {title: "加三块", version, edits: [
            {op: "addBlock", entry: school, text: "放在最前", after: null},
            {op: "addBlock", entry: school, text: "跟在第一块后面", after: "b1"},
            {op: "addBlock", entry: school, text: "放在最后"},
        ]});
        expect(added.status).not.toBe("error");
        const blocks = await author.canon.call("textBlocks", {id: school});
        expect(blocks.ok && blocks.value?.blocks.map((block) => block.source)).toEqual(["放在最前", "第一段。\n\n第二段，和第一段在同一块里。", "跟在第一块后面", "放在最后"]);
        await close();
    }, 60_000);

    it("读过之后作者改了：带旧版本的写入被拒，回话写明之间的修订，请它重读", async () => {
        const {author, run, close} = await scene();
        await run(AGENT_TOOL_IDS.write, {title: "建人物", edits: [{op: "create", name: "星瑕", kind: "人物", components: ["人物"]}]});
        const version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: "星瑕"}));
        const found = await author.canon.call("findEntries", {query: "星瑕"});
        const xia = found.ok ? found.value.items[0]!.id : "";
        const status = await author.canon.call("status", {});
        const authorEdit = await author.canon.call("editEntries", {input: {requestId: "author-1", by: {kind: "author"}, what: "edit", baseVersion: status.ok ? status.value.version : 0, title: "作者改简介", ops: [{op: "set", at: {entry: xia, path: "entry.summary"}, value: "学生"}]}});
        expect(authorEdit.ok).toBe(true);
        const stale = await run(AGENT_TOOL_IDS.write, {title: "改外观", version, edits: [{op: "set", entry: "星瑕", field: "人物.性格", value: "黑色"}]});
        expect(stale.status).toBe("error");
        expect(stale.code).toBe("stale-read");
        expect(stale.text).toContain("作者改简介");
        expect(stale.text).toContain("canon_read");
        await close();
    }, 60_000);

    it("写错参数时回话给出能照着改的信息：选项、没有的名字、没有的设定组、累出来的数", async () => {
        const {run, close} = await scene();
        await run(AGENT_TOOL_IDS.write, {title: "建", edits: [{op: "create", name: "星瑕", kind: "人物", components: ["人物"]}, {op: "create", name: "星瑾", kind: "人物"}]});
        const version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: "星瑕"}));
        const noSuch = await run(AGENT_TOOL_IDS.write, {title: "x", version, edits: [{op: "set", entry: "雾崎", field: "人物.性格", value: "x"}]});
        expect(noSuch.text).toContain("没有叫“雾崎”的条目");
        const noGroup = await run(AGENT_TOOL_IDS.write, {title: "x", version, edits: [{op: "set", entry: "星瑾", field: "人物.性格", value: "x"}]});
        expect(noGroup.text).toContain("先 addComponent");
        const noField = await run(AGENT_TOOL_IDS.write, {title: "x", version, edits: [{op: "set", entry: "星瑕", field: "人物.发色", value: "x"}]});
        expect(noField.text).toContain("没有字段“发色”");
        const storyOnly = await run(AGENT_TOOL_IDS.write, {title: "x", version, edits: [{op: "add", entry: "星瑕", field: "人物.性格", delta: 1}]});
        expect(storyOnly.status).toBe("error");
        expect(storyOnly.text).toContain("story");
        // 同一批两个新条目用同一个代号、同一个设定组列两次：整批拒收，一个也不建。
        const sameKey = await run(AGENT_TOOL_IDS.write, {title: "x", edits: [{op: "create", key: "k", name: "雾崎", kind: "人物"}, {op: "create", key: "k", name: "雾岛", kind: "人物"}]});
        expect(sameKey).toMatchObject({status: "error", code: "bad-edit"});
        expect(sameKey.text).toContain("代号“k”在这一批里前面已经用过");
        const twice = await run(AGENT_TOOL_IDS.write, {title: "x", edits: [{op: "create", name: "雾崎", kind: "人物", components: ["人物", "character"], fields: {"人物.性格": "金发"}}]});
        expect(twice).toMatchObject({status: "error", code: "bad-edit"});
        expect(twice.text).toContain("列了两次");
        expect((await run(AGENT_TOOL_IDS.lookup, {names: ["雾崎", "雾岛"]})).text).toContain("“雾崎”：没有这个名字的条目");
        await close();
    }, 60_000);

    it("请求 id 按这次调用：两条回复用同一个 callId 各写各的；同一次调用重发不多写", async () => {
        const {author, run, close} = await scene();
        const first = await run(AGENT_TOOL_IDS.write, {title: "建甲", edits: [{op: "create", name: "甲", kind: "物品"}]}, {callId: "1", invocation: "inv-a"});
        const second = await run(AGENT_TOOL_IDS.write, {title: "建乙", edits: [{op: "create", name: "乙", kind: "物品"}]}, {callId: "1", invocation: "inv-b"});
        expect((first.details as {revision: string}).revision).not.toBe((second.details as {revision: string}).revision);
        const again = await run(AGENT_TOOL_IDS.write, {title: "建甲", edits: [{op: "create", name: "甲", kind: "物品"}]}, {callId: "1", invocation: "inv-a"});
        expect((again.details as {revision: string}).revision).toBe((first.details as {revision: string}).revision);
        expect(again.text).toContain("同一次调用重发");
        const tree = await author.canon.call("tree", {parent: null});
        expect(tree.ok && tree.value.items.map((item) => item.name).sort()).toEqual(["乙", "甲"]);
        // 第一次把“甲”改了名：重发的参数里的“甲”照现在的世界找不到了，仍要拿回第一次的结果，不报“没有叫甲的条目”。
        const version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: "甲"}));
        const renamed = await run(AGENT_TOOL_IDS.write, {title: "改名", version, edits: [{op: "set", entry: "甲", field: "名字", value: "丙"}]}, {invocation: "inv-rename"});
        expect(renamed.status).not.toBe("error");
        const replayed = await run(AGENT_TOOL_IDS.write, {title: "改名", version, edits: [{op: "set", entry: "甲", field: "名字", value: "丙"}]}, {invocation: "inv-rename"});
        expect(replayed.status).not.toBe("error");
        expect(replayed.text).toContain("同一次调用重发");
        expect((replayed.details as {revision: string}).revision).toBe((renamed.details as {revision: string}).revision);
        await close();
    }, 60_000);

    it("看树、还原；会话不属于作品时回一句话", async () => {
        const {run, close} = await scene();
        const created = await run(AGENT_TOOL_IDS.write, {title: "建", edits: [{op: "create", key: "g", name: "学院", kind: "组织"}, {op: "create", name: "星瑕", kind: "人物", parent: "$g"}]});
        const top = await run(AGENT_TOOL_IDS.tree, {});
        expect(top.text).toContain("学院 [组织] 有子条目");
        const below = await run(AGENT_TOOL_IDS.tree, {parent: "学院"});
        expect(below.text).toContain("星瑕 [人物]");
        const reverted = await run(AGENT_TOOL_IDS.write, {title: "撤回", revert: {revision: (created.details as {revision: string}).revision}});
        expect(reverted.text).toContain("已还原");
        expect((await run(AGENT_TOOL_IDS.tree, {})).text).toContain("这一层没有条目");
        await close();
        const lonely = await scene(null);
        const result = await lonely.run(AGENT_TOOL_IDS.lookup, {names: ["星瑕"]});
        expect(result).toMatchObject({status: "error", code: "no-project"});
        await lonely.close();
    }, 90_000);
});
