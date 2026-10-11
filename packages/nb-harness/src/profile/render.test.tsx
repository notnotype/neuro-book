import {describe, expect, test} from "bun:test";
import type {Message} from "@oh-my-pi/pi-ai";
import {Type} from "typebox";
import {createMemorySessionStore, createSession} from "../session/session";
import {Appending, Assistant, createProfileHost, defineProfile, Developer, History, Image, Input, nodeComponent, Prompt, Reminder, System, Tag, User} from "./profile";
import type {NodeTypeDefinition, PreparedProfile, Profile, ProfileHost, ProfileState, PromptContext} from "./profile";

const baseContext: PromptContext = {session: {id: "s", title: "第三章", createdAt: "2026-10-10T00:00:00.000Z"}, turn: 1, now: new Date(1_000), fields: {}};
const SkillCatalog = nodeComponent("plugin.x/skill-catalog");
const catalog: NodeTypeDefinition = {id: "plugin.x/skill-catalog", category: "content", props: Type.Object({}), parents: ["*message"], children: "none", render: () => "改写、润色"};

/** 示例 Profile 用到 harness/tools：harness/ 下的字段没注册是错误（输出 3），测试的主机先登记它。 */
function newHost(): ProfileHost {
    const host = createProfileHost();
    host.registerField({id: "harness/tools", schema: Type.Array(Type.String())});
    return host;
}

/** Spec“定义 Profile”一节的示例 Profile。 */
const example = (): Profile =>
    defineProfile({
        id: "writer", name: "写作助手", description: "修改小说章节", version: 1,
        fields: {"harness/tools": ["read", "edit"]},
        prompt: (ctx) => (
            <Prompt>
                <System>你是写作助手。</System>
                <History>
                    <User once>本会话的任务：{ctx.session.title ?? "未命名"}</User>
                    <User><SkillCatalog /></User>
                </History>
                <User><Tag name="workspace">当前工作区：/w</Tag></User>
                <Appending>
                    <Input />
                    <Reminder id="style" every={5}>保持第三人称。</Reminder>
                </Appending>
            </Prompt>
        ),
    });

async function prepared(host: ProfileHost, profile: Profile, context: PromptContext = baseContext): Promise<PreparedProfile> {
    const result = await host.prepare(profile, {context});
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    return result.value;
}

const text = (message: Message): string => (typeof message.content === "string" ? message.content : message.content.map((block) => ("text" in block ? block.text : "[image]")).join("|"));

describe("渲染：种子、追加、系统提示词（输出 6、8、9、10）", () => {
    test("场景 1：示例 Profile——两条种子、after-compaction 只剩技能目录；第 1 轮有输入与提醒、第 2–5 轮只有输入、第 6 轮又有提醒；请求为历史加带 <workspace> 的请求消息", async () => {
        const host = newHost();
        host.registerNodeType(catalog);
        const profile = example();
        const first = await prepared(host, profile);

        const seeds = host.renderSeeds(first, "new-session");
        expect(seeds.messages.map(({message, once}) => `${once}:${text(message)}`)).toEqual(["true:本会话的任务：第三章", "false:改写、润色"]);
        expect(host.renderSeeds(first, "after-compaction").messages.map(({message}) => text(message))).toEqual(["改写、润色"]);
        expect(host.renderSystem(first).systemPrompt).toEqual(["你是写作助手。"]);

        let state: ProfileState = {};
        const kindsByTurn: string[][] = [];
        for (let turn = 1; turn <= 6; turn += 1) {
            const current = await prepared(host, profile, {...baseContext, turn});
            const out = host.renderAppending(current, {input: {content: `第 ${turn} 轮输入`}, state});
            state = out.state;
            kindsByTurn.push(out.messages.map((m) => m.kind));
            if (turn === 1) {
                expect(out.messages[0]!.message).toEqual({role: "user", content: "第 1 轮输入", timestamp: 1_000});
                expect(text(out.messages[1]!.message)).toBe("<system-reminder>\n保持第三人称。\n</system-reminder>");
            }
        }
        expect(kindsByTurn).toEqual([["input", "reminder"], ["input"], ["input"], ["input"], ["input"], ["input", "reminder"]]);
        expect(state).toEqual({style: {lastTurn: 6}});

        const history: Message[] = [{role: "user", content: "改第三章", timestamp: 1}, {role: "assistant", content: [{type: "text", text: "好的"}], api: "a", provider: "p", model: "m", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}, stopReason: "stop", timestamp: 2}];
        const request = host.renderRequest(first, {history, invocationStart: 2});
        expect(request.systemPrompt).toEqual(["你是写作助手。"]);
        expect(request.messages.map(text)).toEqual(["改第三章", "好的", "<workspace>\n当前工作区：/w\n</workspace>"]);
        expect(request.diagnostics).toEqual([]);
    });

    test("场景 11：种子的角色取节点的角色；没有带子节点的 History 时种子为空", async () => {
        const host = newHost();
        const seeded = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><History><Developer>规则</Developer><User>任务</User></History></Prompt>}));
        expect(host.renderSeeds(seeded, "new-session").messages.map(({message}) => `${message.role}:${text(message)}`)).toEqual(["developer:规则", "user:任务"]);
        const bare = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><History /></Prompt>}));
        expect(host.renderSeeds(bare, "new-session")).toEqual({messages: [], diagnostics: []});
    });

    test("输出 9：Appending 里没有 Input 时输入放最后；没有 Appending 时只追加输入；注册的有状态节点直接在 Appending 下产生用户消息，内容为空则不产生", async () => {
        const host = newHost();
        const Counter = nodeComponent<{id: string}>("plugin.s/counter");
        host.registerNodeType({
            id: "plugin.s/counter", category: "stateful", props: Type.Object({id: Type.String()}), parents: ["harness/appending", "*message"], children: "none",
            render: (_node, ctx) => {
                const count = (typeof ctx.state === "number" ? ctx.state : 0) + 1;
                return {content: count % 2 === 0 ? null : `第 ${count} 次`, state: count};
            },
        });
        const withoutInput = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><Appending><User>先说一句</User><Counter id="c" /></Appending></Prompt>}));
        const first = host.renderAppending(withoutInput, {input: {content: "输入"}, state: {other: {keep: true}}});
        expect(first.messages.map((m) => `${m.kind}:${text(m.message)}`)).toEqual(["message:先说一句", "message:第 1 次", "input:输入"]);
        expect(first.state).toEqual({other: {keep: true}, c: 1});
        const second = host.renderAppending(withoutInput, {input: {content: "输入"}, state: first.state});
        expect(second.messages.map((m) => m.kind)).toEqual(["message", "input"]);
        expect(second.state).toEqual({other: {keep: true}, c: 2});

        const noAppending = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><System>x</System></Prompt>}));
        expect(host.renderAppending(noAppending, {input: {content: [{type: "text", text: "看图"}, {type: "image", mimeType: "image/png", data: "AAAA"}]}, state: {}}).messages).toEqual([
            {kind: "input", message: {role: "user", content: [{type: "text", text: "看图"}, {type: "image", mimeType: "image/png", data: "AAAA"}], timestamp: 1_000}},
        ]);
    });

    test("输出 10：提醒的 when、watch、once 条件；多个条件同时成立才出现", async () => {
        const host = newHost();
        const profile = (when: boolean, watch: string) =>
            defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><Appending><Input /><Reminder id="w" when={when} watch={watch}>提醒</Reminder><Reminder id="o" once>只一次</Reminder></Appending></Prompt>});
        const ids = (out: {messages: {kind: string; message: Message}[]}): string[] => out.messages.filter((m) => m.kind === "reminder").map((m) => text(m.message).includes("只一次") ? "o" : "w");

        let state: ProfileState = {};
        const run = async (turn: number, when: boolean, watch: string): Promise<string[]> => {
            const out = host.renderAppending(await prepared(host, profile(when, watch), {...baseContext, turn}), {input: {content: "x"}, state});
            state = out.state;
            return ids(out);
        };
        expect(await run(1, true, "a")).toEqual(["w", "o"]);
        expect(await run(2, true, "a")).toEqual([]);
        expect(await run(3, true, "b")).toEqual(["w"]);
        expect(await run(4, false, "c")).toEqual([]);
        expect(await run(5, true, "c")).toEqual(["w"]);
        expect(state).toEqual({w: {lastTurn: 5, watch: "c"}, o: {lastTurn: 1}});
    });
});

describe("消息的形状（输出 9）", () => {
    test("Assistant 示例带占位元数据、content 是块数组；Appending 与种子渲染出的消息能原样写进 session", async () => {
        const host = newHost();
        const p = await prepared(host, defineProfile({
            id: "p", name: "n", description: "d", version: 1,
            prompt: () => (
                <Prompt>
                    <History><Developer>规则</Developer></History>
                    <Appending><User>问题</User><Assistant>示例回答</Assistant><Input /></Appending>
                </Prompt>
            ),
        }));
        const appending = host.renderAppending(p, {input: {content: "输入"}, state: {}});
        const assistant = appending.messages[1]!.message;
        expect(assistant).toMatchObject({role: "assistant", api: "profile", provider: "profile", model: "profile", stopReason: "stop", content: [{type: "text", text: "示例回答"}]});
        const session = await createSession(createMemorySessionStore(), {id: "p"});
        if (!session.ok) throw new Error(session.detail);
        const seeds = host.renderSeeds(p, "new-session");
        const written = await session.value.append([
            ...seeds.messages.map(({message, once}) => ({type: "custom_message" as const, customType: "harness/seed", content: message.content as string, display: true, details: {role: message.role as "user" | "developer", once}})),
            ...appending.messages.map(({message}) => ({type: "message" as const, message})),
        ]);
        expect(written.ok).toBe(true);
        expect(written.ok && written.value.length).toBe(4);
    });
});

describe("渲染期的校验（输出 6）", () => {
    test("内容节点 render 返回的 Image 在 User 里出现、在 System 里被丢弃并给 image-not-allowed；返回未注册节点给 unknown-node；返回不合父子规则的节点给 invalid-parent", async () => {
        const host = newHost();
        const Picture = nodeComponent("plugin.g/picture");
        const Stranger = nodeComponent("plugin.g/stranger");
        const Nested = nodeComponent("plugin.g/nested");
        host.registerNodeType({id: "plugin.g/picture", category: "content", props: Type.Object({}), parents: ["*message", "harness/system"], children: "none", render: () => Image({mimeType: "image/png", data: "QUJD"})});
        host.registerNodeType({id: "plugin.g/stranger", category: "content", props: Type.Object({}), parents: ["*message", "harness/system"], children: "none", render: () => nodeComponent("plugin.g/unregistered")({})});
        host.registerNodeType({id: "plugin.g/only-in-user", category: "content", props: Type.Object({}), parents: ["harness/user"], children: "none", render: () => "只能在 User"});
        host.registerNodeType({id: "plugin.g/nested", category: "content", props: Type.Object({}), parents: ["*message", "harness/system"], children: "none", render: () => nodeComponent("plugin.g/only-in-user")({})});
        const p = await prepared(host, defineProfile({
            id: "p", name: "n", description: "d", version: 1,
            prompt: () => (
                <Prompt>
                    <System>前<Picture />后<Stranger /><Nested /></System>
                    <User>图：<Picture /><Nested /></User>
                </Prompt>
            ),
        }));
        const system = host.renderSystem(p);
        expect(system.systemPrompt).toEqual(["前后"]);
        expect(system.diagnostics.map((d) => `${d.code}@${d.path}`)).toEqual([
            "image-not-allowed@Prompt>System[0]>plugin.g/picture>harness/image",
            "unknown-node@Prompt>System[0]>plugin.g/stranger>plugin.g/unregistered",
            "invalid-parent@Prompt>System[0]>plugin.g/nested>plugin.g/only-in-user",
        ]);
        const request = host.renderRequest(p, {history: [], invocationStart: 0});
        expect(request.messages[0]!.content).toEqual([{type: "text", text: "图："}, {type: "image", mimeType: "image/png", data: "QUJD"}]);
        expect(request.diagnostics.filter((d) => d.path.startsWith("Prompt>harness/user")).map((d) => d.code)).toEqual(["invalid-parent"]);
    });

    test("Fragment 是透明的：包住 System、History、Appending 与请求消息的布局与不包等价（场景 2 的补充）", async () => {
        const host = newHost();
        const plain = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><System>s</System><History><User once>种子</User></History><User>请求</User><Appending><Input /></Appending></Prompt>}));
        const wrapped = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><><System>s</System><><History><><User once>种子</User></></History></><User>请求</User><><Appending><><Input /></></Appending></></></Prompt>}));
        const history: Message[] = [{role: "user", content: "h", timestamp: 1}];
        expect(host.renderSystem(wrapped)).toEqual(host.renderSystem(plain));
        expect(host.renderSeeds(wrapped, "new-session")).toEqual(host.renderSeeds(plain, "new-session"));
        expect(host.renderAppending(wrapped, {input: {content: "i"}, state: {}})).toEqual(host.renderAppending(plain, {input: {content: "i"}, state: {}}));
        expect(host.renderRequest(wrapped, {history, invocationStart: 1})).toEqual(host.renderRequest(plain, {history, invocationStart: 1}));
        expect(host.renderRequest(wrapped, {history, invocationStart: 1}).messages.map(text)).toEqual(["h", "请求"]);
    });
});

describe("文本拼接（输出 5）", () => {
    test("场景 4：相邻字符串直接相连，块级节点前后空一行，首尾空白去掉，三个以上换行折叠为两个", async () => {
        const host = newHost();
        const Block = nodeComponent("plugin.b/block");
        const Inline = nodeComponent("plugin.b/inline");
        host.registerNodeType({id: "plugin.b/block", category: "content", layout: "block", props: Type.Object({}), parents: ["*message"], children: "content", render: (node) => node.children[0] ?? null});
        host.registerNodeType({id: "plugin.b/inline", category: "content", props: Type.Object({}), parents: ["*message"], children: "none", render: () => "行内"});
        const p = await prepared(host, defineProfile({
            id: "p", name: "n", description: "d", version: 1,
            prompt: () => (
                <Prompt>
                    <User>回答使用{"简体中文"}。<Tag name="rules">一</Tag>结尾</User>
                    <User>
                        {"\n\n"}开头<Inline />
                        <Block>块一</Block>
                        <Block>块二</Block>
                        {"\n\n\n\n"}结尾{"\n"}
                    </User>
                    <System>只有文字 <Tag name="t">块</Tag></System>
                </Prompt>
            ),
        }));
        const [first, second] = host.renderRequest(p, {history: [], invocationStart: 0}).messages;
        expect(text(first!)).toBe("回答使用简体中文。\n\n<rules>\n一\n</rules>\n\n结尾");
        expect(text(second!)).toBe("开头行内\n\n块一\n\n块二\n\n结尾");
        expect(host.renderSystem(p).systemPrompt).toEqual(["只有文字\n\n<t>\n块\n</t>"]);
    });

    test("图片让消息内容变成块数组，文字合并成一个文本块；空的 System 不列出", async () => {
        const host = newHost();
        const p = await prepared(host, defineProfile({id: "p", name: "n", description: "d", version: 1, prompt: () => <Prompt><System>{""}</System><User>看这张<Image mimeType="image/png" data="QUJD" />图，{"再"}看文字</User></Prompt>}));
        expect(host.renderSystem(p).systemPrompt).toEqual([]);
        expect(host.renderRequest(p, {history: [], invocationStart: 0}).messages[0]!.content).toEqual([
            {type: "text", text: "看这张"}, {type: "image", mimeType: "image/png", data: "QUJD"}, {type: "text", text: "图，再看文字"},
        ]);
    });

    test("输出 14：同样的输入得到同样的输出，渲染不修改输入", async () => {
        const host = newHost();
        host.registerNodeType(catalog);
        const p = await prepared(host, example());
        const history: Message[] = [{role: "user", content: "a", timestamp: 1}];
        const snapshot = structuredClone(history);
        const state: ProfileState = {style: {lastTurn: 1}};
        const a = host.renderRequest(p, {history, invocationStart: 1});
        const b = host.renderRequest(p, {history, invocationStart: 1});
        expect(a).toEqual(b);
        expect(host.renderAppending(p, {input: {content: "x"}, state})).toEqual(host.renderAppending(p, {input: {content: "x"}, state}));
        expect(history).toEqual(snapshot);
        expect(state).toEqual({style: {lastTurn: 1}});
    });
});
