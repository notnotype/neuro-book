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

import {definitionAt} from "nbook/manifest";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {projectsKey} from "nbook/shared/projects";
import type {ProjectsService} from "nbook/shared/projects";

import {AGENT_TOOL_IDS, CANON_AGENT_TOOL_CONTRIBUTIONS, canonAgentTools, canonServerPlugin} from "./backend/agent-tools";
import {descriptor} from "./plugin";
import {BUILTIN_ENTRY_KINDS} from "./shared/components";
import {CANON_ENTRY_KINDS_POINT, mergeEntryKinds} from "./shared/entry-kinds";
import type {EntryKindDeclaration} from "./shared/entry-kinds";
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
    // 服务端实例里种类的登记就是插件描述里的内置四条（这个场地的服务端没装 canon 的服务端入口，直接给同一份）。
    const tools = canonAgentTools({projects: held.projects, remote: held.remote!, entryKinds: () => mergeEntryKinds(BUILTIN_ENTRY_KINDS)});
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
    it("服务端实例：canon 的服务端入口定义了种类的贡献点，读得到内置的四条（Agent 新建时的默认靠它，上面的场地直接给了同一份）", async () => {
        const root = await createTestTmpRoot("neuro-book-canon", "agent-kinds");
        const held: {list: () => readonly unknown[]} = {list: () => []};
        const probe: PluginDefinition = {id: "test.kinds", entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], activate: (context) => {
            held.list = () => mergeEntryKinds(context.declarations.list<EntryKindDeclaration>(CANON_ENTRY_KINDS_POINT));
            return {};
        }})]};
        const world = await settingsWorld(root, [definitionAt("server", descriptor, canonServerPlugin), probe]);
        try {
            expect(held.list()).toEqual(mergeEntryKinds(BUILTIN_ENTRY_KINDS));
        } finally {
            await world.close();
            await rm(root, {recursive: true, force: true});
        }
    });

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

        // 没写 components：人物默认带人物与形象，fields 写到的数值并上（输出 7）；组织没有登记默认的设定组。
        await run(AGENT_TOOL_IDS.write, {title: "建星瑾", edits: [{op: "create", name: "星瑾", kind: "人物", declare: {数值: [{label: "战绩"}]}, fields: {"数值.战绩": "三胜"}}]});
        const jin = (await run(AGENT_TOOL_IDS.read, {entry: "星瑾"})).text;
        expect([...jin.matchAll(/^【(.+?)】/gmu)].map((match) => match[1])).toEqual(["人物", "形象", "数值"]);
        expect(jin).toContain("战绩 = 三胜");
        expect((await run(AGENT_TOOL_IDS.read, {entry: "学院"})).text).not.toContain("【");
        await close();
    }, 60_000);

    it("在条目上加自己的字段、改名、去掉、恢复；新建与加设定组时带声明；拒收时回话写得出原因（输出 6、7）", async () => {
        const {run, close} = await scene();
        // 新建时就在数值上声明三个字段，给其中一个初值（Agent 写数要带依据，这里给文字的那个）；人物有建议值的字段在读出来时写明“也可以写别的”。
        const created = await run(AGENT_TOOL_IDS.write, {title: "建人物", edits: [
            {op: "create", key: "xia", name: "星瑕", kind: "人物", components: ["人物"], declare: {数值: [{label: "战绩"}, {label: "魔力上限", kind: "number"}, {label: "魔力", kind: "number", max: "魔力上限"}]}, fields: {"数值.战绩": "三胜"}},
        ]});
        expect(created.text).toContain("已写入");
        const read = await run(AGENT_TOOL_IDS.read, {entry: "星瑕"});
        expect(read.text).toContain("【人物】（设定组 character，可以加字段）");
        // 写了 components 就照写的：不再套人物的默认（形象）。
        expect(read.text).not.toContain("【形象】");
        expect(read.text).toContain("常见的写法：男、女、不明（也可以写别的）");
        expect(read.text).toContain("战绩 = 三胜");
        expect(read.text).toContain("- 魔力 = 未知｜数；最大 魔力上限");

        const added = await run(AGENT_TOOL_IDS.write, {title: "加种族", version: versionIn(read), edits: [{op: "addField", entry: "星瑕", component: "人物", label: "种族", value: "精灵"}]});
        expect(added.status).not.toBe("error");
        const renamed = await run(AGENT_TOOL_IDS.write, {title: "改名", version: versionIn(await run(AGENT_TOOL_IDS.read, {entry: "星瑕"})), edits: [{op: "renameField", entry: "星瑕", field: "人物.种族", label: "血统"}]});
        expect(renamed.status).not.toBe("error");
        expect((await run(AGENT_TOOL_IDS.read, {entry: "星瑕"})).text).toContain("血统（种族） = 精灵");

        const removed = await run(AGENT_TOOL_IDS.write, {title: "去掉", version: versionIn(await run(AGENT_TOOL_IDS.read, {entry: "星瑕"})), edits: [{op: "removeField", entry: "星瑕", field: "人物.血统"}]});
        expect(removed.status).not.toBe("error");
        const after = await run(AGENT_TOOL_IDS.read, {entry: "星瑕"});
        expect(after.text).not.toContain("血统");
        // 去掉过的字段按显示名或 id 都认得；恢复以后值还在。
        const restored = await run(AGENT_TOOL_IDS.write, {title: "恢复", version: versionIn(after), edits: [{op: "restoreField", entry: "星瑕", field: "人物.血统"}]});
        expect(restored.status).not.toBe("error");
        const back = await run(AGENT_TOOL_IDS.read, {entry: "星瑕"});
        expect(back.text).toContain("血统（种族） = 精灵");

        // 拒收的原因能照着改：固定的字段、同名、没有去掉过的字段。
        const fixed = await run(AGENT_TOOL_IDS.write, {title: "去掉性格", version: versionIn(back), edits: [{op: "removeField", entry: "星瑕", field: "人物.性格"}]});
        expect(fixed.status).toBe("error");
        expect(fixed.text).toContain("设定组固定的字段");
        const duplicate = await run(AGENT_TOOL_IDS.write, {title: "再加一个血统", version: versionIn(back), edits: [{op: "addField", entry: "星瑕", component: "人物", label: "血统"}]});
        expect(duplicate.status).toBe("error");
        expect(duplicate.text).toContain("已经有一个叫这个名字的字段");
        const missing = await run(AGENT_TOOL_IDS.write, {title: "恢复没有的", version: versionIn(back), edits: [{op: "restoreField", entry: "星瑕", field: "人物.身高"}]});
        expect(missing.status).toBe("error");
        expect(missing.text).toContain("没有去掉过的字段“身高”");
        await close();
    }, 60_000);

    it("字段操作的边界：数与引用不给初值也加得上；显示名带空格时同一项的初值认得到；写错形状、空的显示名、已有的设定组都回话说清，不悄悄照写；回话写出新条目带了哪几组", async () => {
        const {run, close} = await scene();
        const created = await run(AGENT_TOOL_IDS.write, {title: "建人物", edits: [
            {op: "create", key: "xia", name: "星瑕", kind: "人物", declare: {数值: [{label: "身高 (cm)"}]}, fields: {"数值.身高 (cm)": "一米七"}},
            {op: "create", key: "jin", name: "星瑾", kind: "人物", components: []},
        ]});
        expect(created.status).not.toBe("error");
        // 没写 components 套的是种类的默认，加上 declare 写到的数值；写了 [] 就是一组也不要。
        expect(created.text).toContain("xia → ");
        expect(created.text).toContain("（设定组：人物、形象、数值）");
        expect(created.text).toContain("（没有设定组）");
        const read = await run(AGENT_TOOL_IDS.read, {entry: "星瑕"});
        // 生成的 id 不等于显示名（括号里的），初值照样写进了这一项。
        expect(read.text).toContain("身高 (cm)（身高cm2） = 一米七");

        let version = versionIn(read);
        const write = (edits: readonly Record<string, unknown>[]) => run(AGENT_TOOL_IDS.write, {title: "改", version, edits});
        const numberAndRef = await write([{op: "addField", entry: "星瑕", component: "数值", label: "力量", kind: "number"}, {op: "addField", entry: "星瑕", component: "数值", label: "师父", kind: "ref", targets: ["人物"]}]);
        expect(numberAndRef.status).not.toBe("error");
        // 写过以后带旧版本先回 stale-read（输出 6）：下面要看的是各项自己的回话，带新版本。
        version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: "星瑕"}));
        const refused: Array<[readonly Record<string, unknown>[], string]> = [
            [[{op: "addField", entry: "星瑕", component: "数值", label: "魔力", kind: "数字"}], "kind 只能是"],
            [[{op: "addField", entry: "星瑕", component: "数值", label: "  "}], "不能是空的"],
            [[{op: "addField", entry: "星瑕", component: "数值", label: "魔力", default: 3}], "不认识“default”"],
            [[{op: "renameField", entry: "星瑕", field: "数值.身高 (cm)", label: ""}], "不能是空的"],
            [[{op: "addComponent", entry: "星瑕", component: "人物"}], "已经有设定组“人物”"],
            [[{op: "create", name: "星璃", kind: "人物", components: "人物"}], "components 是设定组名字的列表"],
            [[{op: "create", name: "星璃", kind: "人物", declare: [{label: "甲"}]}], "declare 写"],
            [[{op: "create", name: "星璃", kind: "人物", fields: null}], "fields 写"],
            [[{op: "create", name: "星璃", kind: "人物", fields: [["人物.性格", "冷"]]}], "fields 写"],
            [[{op: "create", name: "星璃", kind: "人物", declare: {数值: [{label: "战绩", value: "三胜"}]}}], "声明里不写初值"],
            [[{op: "create", name: "星璃", kind: "人物", declare: {数值: [{label: "甲"}], panel: [{label: "乙"}]}}], "写了两次"],
            [[{op: "create", key: "li", name: "星璃", kind: "人物"}, {op: "restoreField", entry: "$li", field: "人物.种族"}], "这一批新建的条目没有去掉过的字段"],
        ];
        for (const [edits, says] of refused) {
            const result = await write(edits);
            expect(result.status).toBe("error");
            expect(result.text).toContain(says);
        }
        await close();
    }, 60_000);

    it("fields 写到的设定组都并上；create 的 max 按显示名写的换成 id；addComponent 带 declare；不允许加字段的设定组回话说清（输出 6、7）", async () => {
        const {run, close} = await scene();
        const groups = (text: string) => [...text.matchAll(/^【(.+?)】/gmu)].map((match) => match[1]);
        // 两种情况下 fields 写到的设定组都并上：不写 components 时在默认之后，写了时在列出的之后；都不带 declare。
        // 星璃的上限按显示名写，它生成的 id 与显示名不同：工具不换成 id，内核找不到这个字段、拒收。
        const created = await run(AGENT_TOOL_IDS.write, {title: "建人物", edits: [
            {op: "create", name: "星瑕", kind: "人物", fields: {"知识点.规则": "只在夜里"}},
            {op: "create", name: "星瑾", kind: "人物", components: ["人物"], fields: {"形象.外貌": "银发"}},
            {op: "create", name: "星璃", kind: "人物", components: [], declare: {数值: [{label: "体力 (上限)", kind: "number"}, {label: "体力", kind: "number", max: "体力 (上限)"}]}},
        ]});
        expect(created.status).not.toBe("error");
        expect(groups((await run(AGENT_TOOL_IDS.read, {entry: "星瑕"})).text)).toEqual(["人物", "形象", "知识点"]);
        const jin = await run(AGENT_TOOL_IDS.read, {entry: "星瑾"});
        expect(groups(jin.text)).toEqual(["人物", "形象"]);
        expect(jin.text).toContain("外貌 = 银发");
        const li = (await run(AGENT_TOOL_IDS.read, {entry: "星璃"})).text;
        const capId = /- 体力 \(上限\)（(\S+?)） = 未知/u.exec(li)?.[1];
        expect(capId).toMatch(/^体力上限/u);
        expect(li).toContain(`- 体力 = 未知｜数；最大 ${capId!}`);

        const panel = await run(AGENT_TOOL_IDS.write, {title: "加数值", version: versionIn(jin), edits: [{op: "addComponent", entry: "星瑾", component: "数值", declare: [{label: "战绩"}]}]});
        expect(panel.status).not.toBe("error");
        const withPanel = await run(AGENT_TOOL_IDS.read, {entry: "星瑾"});
        expect(groups(withPanel.text)).toEqual(["人物", "形象", "数值"]);
        expect(withPanel.text).toContain("- 战绩 = 未知");

        // 知识点这一组不允许条目自己加字段。
        const refused = await run(AGENT_TOOL_IDS.write, {title: "加字段", version: versionIn(withPanel), edits: [{op: "addField", entry: "星瑕", component: "知识点", label: "代价"}]});
        expect(refused.status).toBe("error");
        expect(refused.text).toContain("不能在条目上加自己的字段");
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

    it("写主文字（agent-tools 输出 6）：读到带值写法；交回的整块去值再写，文字里改了的值不写进字段、回话提示改值用 set；去值以后没有改动就不发布", async () => {
        const {author, run, close} = await scene();
        const created = await run(AGENT_TOOL_IDS.write, {title: "建人物", edits: [{op: "create", key: "xia", name: "星瑕", kind: "人物", components: ["人物"], fields: {"人物.性格": "冷静"}, text: '性格 <V of="character.性格">"抄来的值"</V>。'}]});
        expect(created.status).not.toBe("error");
        const xia = (created.details as {ids: Record<string, string>}).ids["tmp:xia"]!;
        const sources = async () => {
            const blocks = await author.canon.call("textBlocks", {id: xia});
            return blocks.ok ? blocks.value?.blocks.map((block) => block.source) : null;
        };
        expect(await sources()).toEqual(['性格 <V of="character.性格" />。']);

        const read = await run(AGENT_TOOL_IDS.read, {entry: xia, show: ["text"]});
        expect(read.text).toContain('[b1] 性格 <V of="character.性格">"冷静"</V>。');

        const set = await run(AGENT_TOOL_IDS.write, {title: "改文字", version: versionIn(read), edits: [{op: "set", entry: xia, field: "text[b1]", value: '她的性格 <V of="character.性格">"热情"</V>。'}]});
        expect(set.status).not.toBe("error");
        expect(set.text).toContain('文字里的值不写入：character.性格 现在是 "冷静"，改值用 set。');
        expect(await sources()).toEqual(['她的性格 <V of="character.性格" />。']);
        const fields = await run(AGENT_TOOL_IDS.read, {entry: xia, field: "人物.性格"});
        expect(fields.text).toContain("冷静");

        const again = await run(AGENT_TOOL_IDS.read, {entry: xia, show: ["text"]});
        const unchanged = await run(AGENT_TOOL_IDS.write, {title: "原样交回", version: versionIn(again), edits: [{op: "set", entry: xia, field: "text[b1]", value: '她的性格 <V of="character.性格">"冷静"</V>。'}]});
        expect([unchanged.status, unchanged.text]).toEqual([undefined, "主文字没有改动：去掉读到的值以后与现在相同，没有写入。"]);
        expect(versionIn(await run(AGENT_TOOL_IDS.read, {entry: xia, show: ["text"]}))).toBe(versionIn(again));
        await close();
    }, 60_000);

    it("写主文字：replace 在这一块按实际模式的带值写法里找（整个带值的 V、半个标签都行），整块去值再写；找不到而 find 带着值时请它重读", async () => {
        const {author, run, close} = await scene();
        const created = await run(AGENT_TOOL_IDS.write, {title: "建人物", edits: [{op: "create", key: "xia", name: "星瑕", kind: "人物", components: ["人物"], fields: {"人物.性格": "冷静"}, text: '性格 <V of="character.性格" />，住在学院。'}]});
        const xia = (created.details as {ids: Record<string, string>}).ids["tmp:xia"]!;
        const sources = async () => {
            const blocks = await author.canon.call("textBlocks", {id: xia});
            return blocks.ok ? blocks.value?.blocks.map((block) => block.source) : null;
        };
        let version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: xia, show: ["text"]}));
        const whole = await run(AGENT_TOOL_IDS.write, {title: "换值的位置", version, edits: [{op: "replace", entry: xia, field: "text[b1]", find: '性格 <V of="character.性格">"冷静"</V>，', with: '<V of="character.性格">"冷静"</V>的性子，'}]});
        expect(whole.status).not.toBe("error");
        expect(await sources()).toEqual(['<V of="character.性格" />的性子，住在学院。']);

        version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: xia, show: ["text"]}));
        const half = await run(AGENT_TOOL_IDS.write, {title: "改半句", version, edits: [{op: "replace", entry: xia, field: "text[b1]", find: '"</V>的性子', with: '"</V>的脾气'}]});
        expect(half.status).not.toBe("error");
        expect(await sources()).toEqual(['<V of="character.性格" />的脾气，住在学院。']);

        version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: xia, show: ["text"]}));
        const stale = await run(AGENT_TOOL_IDS.write, {title: "抄错了值", version, edits: [{op: "replace", entry: xia, field: "text[b1]", find: '<V of="character.性格">"热情"</V>', with: "热情"}]});
        expect([stale.status, stale.text]).toEqual(["error", '第 1 项（replace）：这一块里找不到 find：find 里带着读到的值，值可能变了或是按计划模式读的。按实际模式重读这一块再抄。']);
        const missing = await run(AGENT_TOOL_IDS.write, {title: "找不到", version, edits: [{op: "replace", entry: xia, field: "text[b1]", find: "宿舍", with: "家"}]});
        expect(missing.text).toBe("第 1 项（replace）：这一块里找不到 find，原样抄读到的文字。");
        // 把“存下时去掉值”读成 find 里也去掉（真实模型评测里出现过）：回话说 find 要照读到的抄，或只找标签以外的文字。
        const stripped = await run(AGENT_TOOL_IDS.write, {title: "去了值找", version, edits: [{op: "replace", entry: xia, field: "text[b1]", find: '<V of="character.性格" />的脾气', with: "的性情"}]});
        expect([stripped.status, stripped.text]).toEqual(["error", '第 1 项（replace）：这一块里找不到 find：find 是在读到的带值写法里找的，里面的标签要连同属性与中间的值照读到的抄（例如 <V of="panel.魔力">1200</V>），或者只找标签以外的文字。']);
        // 写入成功的回话不给新的读取戳，请它重读。
        expect(half.text).toContain("接着改要先用 canon_read 重读，拿新的版本。");
        await close();
    }, 60_000);

    it("写主文字的几种组合（输出 6）：原样交回的块混在别的改动里也不写（剧情意图下不把这块钉在那一章），后面的项被拒时项号照交来的数；读后被改的 replace 先回 stale-read；算出来的值改了提示改依赖的字段", async () => {
        const {author, run, close} = await scene();
        const created = await run(AGENT_TOOL_IDS.write, {title: "建人物", edits: [{op: "create", key: "xia", name: "星瑕", kind: "人物", components: ["人物", "面板"], declare: {面板: [{id: "魔力", label: "魔力", kind: "number"}]}, fields: {"人物.性格": "冷静"}, text: '性格 <V of="character.性格" />，魔力翻倍是 <V expr="panel.魔力 * 2" />，住在学院。'}]});
        expect(created.status).not.toBe("error");
        const xia = (created.details as {ids: Record<string, string>}).ids["tmp:xia"]!;
        // 数的初值 Agent 给不了（要写依据），由作者填。
        const status = await author.canon.call("status", {});
        const filled = await author.canon.call("editEntries", {input: {requestId: "author-mana", by: {kind: "author"}, what: "edit", baseVersion: status.ok ? status.value.version : 0, title: "作者填魔力", ops: [{op: "set", at: {entry: xia, path: "panel.魔力"}, value: 3}]}});
        expect(filled.ok).toBe(true);
        const readAt = (at: unknown) => run(AGENT_TOOL_IDS.read, {entry: xia, show: ["text"], at});
        const textOf = (read: ToolResult) => /\[b1\] (.*)/u.exec(read.text)?.[1] ?? "";

        // 剧情意图、第 1 章：改性格，同时原样交回 b1。b1 不写，第 1 章以后的 b1 照样跟着最初的文字走。
        let read = await readAt({chapter: 1});
        const mixed = await run(AGENT_TOOL_IDS.write, {title: "第 1 章变热情", version: versionIn(read), intent: "story", at: {chapter: 1}, edits: [{op: "set", entry: xia, field: "人物.性格", value: "热情"}, {op: "set", entry: xia, field: "text[b1]", value: textOf(read)}]});
        expect(mixed.status).not.toBe("error");
        read = await readAt("initial");
        const initial = await run(AGENT_TOOL_IDS.write, {title: "最初改住处", version: versionIn(read), at: "initial", edits: [{op: "replace", entry: xia, field: "text[b1]", find: "学院", with: "宿舍"}]});
        expect(initial.status).not.toBe("error");
        expect(textOf(await readAt({chapter: 2}))).toBe('性格 <V of="character.性格">"热情"</V>，魔力翻倍是 <V expr="panel.魔力 * 2">6</V>，住在宿舍。');

        // 原样交回的块在前、后面一项被内核拒收：回话里的项号是交来的第几项，不是写进去的第几个操作（三种带序号的失败：
        // 路径 ops[N]、问题里的 op、失败本身的 op）。
        read = await readAt("initial");
        const numbered = await run(AGENT_TOOL_IDS.write, {title: "记一笔", version: versionIn(read), at: "initial", edits: [{op: "set", entry: xia, field: "text[b1]", value: textOf(read)}, {op: "add", entry: xia, field: "面板.魔力", delta: 1}]});
        expect([numbered.status, numbered.text]).toEqual(["error", expect.stringContaining("第 2 项")]);
        const located = await run(AGENT_TOOL_IDS.write, {title: "加插件标签", version: versionIn(read), at: "initial", edits: [{op: "set", entry: xia, field: "text[b1]", value: textOf(read)}, {op: "addBlock", entry: xia, text: '<Plot id="x" />'}]});
        expect([located.status, located.text]).toEqual(["error", expect.stringMatching(/^validation-failed：第 2 项 unknown-tag/u)]);

        // 算出来的值在文字里改了：不写，提示改它依赖的字段。
        const computed = await run(AGENT_TOOL_IDS.write, {title: "改算出来的值", version: versionIn(read), at: "initial", edits: [{op: "set", entry: xia, field: "text[b1]", value: textOf(read).replace(">6<", ">60<").replace("宿舍", "家")}]});
        expect(computed.text).toContain("panel.魔力 * 2 是算出来的，现在是 6：改它依赖的字段");

        // 读过之后这一块被改了：带旧版本做 replace，find 在现在的文字里已经没有了；回话是 stale-read，不是“抄错了”。
        const late = await run(AGENT_TOOL_IDS.write, {title: "换回学院", version: versionIn(read), at: "initial", edits: [{op: "replace", entry: xia, field: "text[b1]", find: "宿舍", with: "学院"}]});
        expect([late.code, late.text]).toEqual(["stale-read", expect.stringContaining("改算出来的值")]);
        // 作者手写在块里的 `$` 写法原样留着：Agent 改这一块照常，同一批碰巧 create 了同名的代号也不改绑。
        const latest = await author.canon.call("status", {});
        expect((await author.canon.call("editEntries", {input: {requestId: "author-dollar", by: {kind: "author"}, what: "edit", baseVersion: latest.ok ? latest.value.version : 0, title: "作者手写", ops: [{op: "addBlock", entry: xia, source: '作者写的 <Ref id="$foo" /> 在学院。'}]}})).ok).toBe(true);
        read = await readAt("initial");
        const kept = await run(AGENT_TOOL_IDS.write, {title: "改作者那块", version: versionIn(read), at: "initial", edits: [{op: "create", key: "foo", name: "阿福", kind: "人物"}, {op: "replace", entry: xia, field: "text[b2]", find: "学院", with: "宿舍"}]});
        expect(kept.status).not.toBe("error");
        expect(/\[b2\] (.*)/u.exec((await readAt("initial")).text)?.[1]).toBe('作者写的 <Ref id="$foo" name="已删除的条目" /> 在宿舍。');

        // 失败本身带的序号：原样交回 b2 不写，给一个还没有值的数记一笔（incomplete-field，带操作序号）。
        read = await readAt("initial");
        expect((await run(AGENT_TOOL_IDS.write, {title: "加体力", version: versionIn(read), at: "initial", edits: [{op: "addField", entry: xia, component: "面板", label: "体力", kind: "number"}]})).status).not.toBe("error");
        read = await readAt({chapter: 1});
        const b2 = /\[b2\] (.*)/u.exec(read.text)?.[1] ?? "";
        const conflict = await run(AGENT_TOOL_IDS.write, {title: "记体力", version: versionIn(read), intent: "story", at: {chapter: 1}, edits: [{op: "set", entry: xia, field: "text[b2]", value: b2}, {op: "add", entry: xia, field: "面板.体力", delta: 1}]});
        expect([conflict.status, conflict.text]).toEqual(["error", expect.stringMatching(/^第 2 项：incomplete-field/u)]);
        await close();
    }, 60_000);

    it("主文字里的 $代号 指向同一批 create 的条目，写进去的是它的 id；没有的代号回话说清。addBlock 交回的带值写法去值；长块分页读，整段写回被拒、改局部用 replace（输出 6、7）", async () => {
        const {author, run, close} = await scene();
        const created = await run(AGENT_TOOL_IDS.write, {title: "建两个", edits: [
            {op: "create", key: "school", name: "学院", kind: "组织"},
            {op: "create", key: "xia", name: "星瑕", kind: "人物", components: ["人物"], fields: {"人物.性格": "冷静"}, text: '她在 <Ref id="$school" /> 读书，同学是 <Ref id="$xia" />。'},
        ]});
        expect(created.status).not.toBe("error");
        const ids = (created.details as {ids: Record<string, string>}).ids;
        const [school, xia] = [ids["tmp:school"]!, ids["tmp:xia"]!];
        const sources = async () => {
            const blocks = await author.canon.call("textBlocks", {id: xia});
            return blocks.ok ? blocks.value?.blocks.map((block) => block.source) : null;
        };
        expect(await sources()).toEqual([`她在 <Ref id="${school}" /> 读书，同学是 <Ref id="${xia}" />。`]);

        let version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: xia}));
        const unknown = await run(AGENT_TOOL_IDS.write, {title: "写错代号", version, edits: [{op: "addBlock", entry: xia, text: '<Ref id="$nobody" />'}]});
        expect([unknown.status, unknown.text]).toEqual(["error", expect.stringContaining("$nobody 不是这一批前面 create 的代号")]);
        const both = await run(AGENT_TOOL_IDS.write, {title: "加一块", version, edits: [{op: "create", key: "jin", name: "星瑾", kind: "人物"}, {op: "addBlock", entry: xia, text: '妹妹 <Ref id="$jin" name="抄来的名字" />，性格 <V of="character.性格">"抄来的"</V>。'}]});
        expect(both.status).not.toBe("error");
        const jin = (both.details as {ids: Record<string, string>}).ids["tmp:jin"]!;
        expect((await sources())?.[1]).toBe(`妹妹 <Ref id="${jin}" />，性格 <V of="character.性格" />。`);

        // 一块超过一页（8000 字）：field 写 text[块] 分页读；整段写回被拒，replace 照常。
        version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: xia}));
        const long = `${"长".repeat(9000)}结尾`;
        expect((await run(AGENT_TOOL_IDS.write, {title: "长块", version, edits: [{op: "addBlock", entry: xia, text: long}]})).status).not.toBe("error");
        const first = await run(AGENT_TOOL_IDS.read, {entry: xia, field: "text[b3]"});
        expect(first.text).toContain('cursor "8000" 续读');
        const second = await run(AGENT_TOOL_IDS.read, {entry: xia, field: "text[b3]", cursor: "8000"});
        expect(second.text).toContain("长结尾");
        expect(second.text).not.toContain("续读");
        const whole = await run(AGENT_TOOL_IDS.write, {title: "整段写回", version: versionIn(second), edits: [{op: "set", entry: xia, field: "text[b3]", value: "只剩一句"}]});
        expect([whole.status, whole.text]).toEqual(["error", expect.stringContaining("改局部用 replace")]);
        const part = await run(AGENT_TOOL_IDS.write, {title: "改结尾", version: versionIn(second), edits: [{op: "replace", entry: xia, field: "text[b3]", find: "结尾", with: "完"}]});
        expect(part.status).not.toBe("error");
        expect((await sources())?.[2]).toBe(`${"长".repeat(9000)}完`);
        // 整篇读时一块要么整块给、要么只写多长与怎么读，不在块中间截断：长块写的是真能用的读法。
        const wholeRead = (await run(AGENT_TOOL_IDS.read, {entry: xia, show: ["text"]})).text;
        expect(wholeRead).toContain('[b3] 这一块共 9001 字，这里放不下：用 field: "text[b3]" 读');
        expect(wholeRead).not.toContain("长长");

        // 不到一页、却放不下整篇读的块（审查里的 5088 字，与两块各 3000 字）：同样整块不给，Agent 照读到的整段写回不会丢掉后半块。
        const {run: run2, close: close2} = await scene();
        const made = await run2(AGENT_TOOL_IDS.write, {title: "两块", edits: [{op: "create", key: "s", name: "书", kind: "组织", text: `${"甲".repeat(5087)}尾`}]});
        const book = (made.details as {ids: Record<string, string>}).ids["tmp:s"]!;
        let read = await run2(AGENT_TOOL_IDS.read, {entry: book, show: ["text"]});
        expect(read.text).toContain('[b1] 这一块共 5088 字，这里放不下：用 field: "text[b1]" 读');
        expect((await run2(AGENT_TOOL_IDS.write, {title: "加一块", version: versionIn(read), edits: [{op: "removeBlock", entry: book, block: "b1"}, {op: "addBlock", entry: book, text: `${"乙".repeat(2999)}尾`}, {op: "addBlock", entry: book, text: `${"丙".repeat(2999)}尾`}]})).status).not.toBe("error");
        read = await run2(AGENT_TOOL_IDS.read, {entry: book, show: ["text"]});
        expect([read.text.includes(`${"乙".repeat(2999)}尾`), read.text.includes("丙丙"), read.text.includes('[b3] 这一块共 3000 字，这里放不下：用 field: "text[b3]" 读')]).toEqual([true, false, true]);
        await close2();

        // 交回的一块太长：去值后超过 5 万字、或交回的超过 10 万字（不去读它），都回“拆成几块”。
        version = versionIn(await run(AGENT_TOOL_IDS.read, {entry: xia}));
        for (const text of ["字".repeat(50_001), `<V of="character.性格">${"字".repeat(100_001)}</V>`]) {
            const big = await run(AGENT_TOOL_IDS.write, {title: "太长", version, edits: [{op: "addBlock", entry: xia, text}]});
            expect([big.status, big.text]).toEqual(["error", "第 1 项（addBlock）：一块主文字最多 50000 字，拆成几块（addBlock）。"]);
        }
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
        await run(AGENT_TOOL_IDS.write, {title: "建", edits: [{op: "create", name: "星瑕", kind: "人物", components: ["人物"]}, {op: "create", name: "星瑾", kind: "人物", components: []}]});
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
