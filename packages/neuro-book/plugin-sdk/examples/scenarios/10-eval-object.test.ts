/**
 * 场景 10：给 Agent 的 eval 代码一个全局对象（`word-stats`）。
 *
 * 要说明的事：
 * - 插件在描述里登记对象 `stats`（顶层贡献 `agent.evalObjects`），在服务端入口把方法 `stats.count` 贡献成一个带 `global` 的工具。
 * - 绑定了这个方法的会话里，eval 的说明列出 `stats`（一行摘要加文档地址），代码里 `await stats.count({text})` 拿到声明了 `returns`
 *   的对象；`docs://eval/stats.md` 里有按参数与 `returns` 生成的签名。方法本身不进模型的工具清单。
 * - 没绑定这个方法的会话里看不到 `stats`：对象跟着方法走，Profile 决定会话里有什么。会话中途换了 Profile，eval 的说明跟着变，
 *   模型在下一次请求前收到“工具变了”的提醒，不会拿着旧说明去调已经没有的对象。
 * - 对象名是全服务端共用的：另一个插件也登记 `stats` 时，两个都不用（谁先装上都不算数），并记一条诊断。
 *
 * 阅读顺序：`plugins/word-stats/shared/contracts.ts` → `plugin.ts` → `backend/plugin.ts` → 这里。
 *
 * 行为合同：docs/specs/agent/eval.md（输出 6、7、16、17）、docs/specs/agent/contributions.md（输出 24、25）、
 * docs/specs/agent/resources.md（输出 16）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {LogEvent, SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {definePlugin} from "@notnotype/nb-plugin-sdk";
import {evalObject} from "@notnotype/nb-plugin-sdk/agent";

import {definitionAt} from "nbook/manifest";
import {agentProfile} from "nbook/plugins/agent/shared/points";
import {fakeEndpoint, localModelSettings} from "nbook/plugins/agent/testing/endpoint";
import type {FakeEndpoint} from "nbook/plugins/agent/testing/endpoint";
import {agentWorld} from "nbook/plugins/agent/testing/world";
import type {AgentWorld} from "nbook/plugins/agent/testing/world";

import {wordStatsBackendPlugin} from "../plugins/word-stats/backend/plugin";
import {descriptor as wordStatsDescriptor} from "../plugins/word-stats/plugin";
import {COUNT_TOOL} from "../plugins/word-stats/shared/contracts";

let tmp = "";
let endpoint: FakeEndpoint;
let world: AgentWorld | null = null;
let commands = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 10：eval 的全局对象");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    await world?.close();
    world = null;
});
afterAll(async () => {
    endpoint.stop();
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/**
 * 两个测试用的 Profile：都绑了 eval 与 `read`，只差 `stats.count`。这样换 Profile 时模型能看到的变化只有 eval 的说明（`stats.count`
 * 只走代码，不进给模型的工具清单）。审批模式放行，场景只看全局对象。
 */
const WITH_STATS = "test.scene10.with";
const WITHOUT = "test.scene10.without";
function profiles(): PluginDefinition {
    const tools = {[WITH_STATS]: ["nbook.agent.eval", "nbook.agent.read", COUNT_TOOL], [WITHOUT]: ["nbook.agent.eval", "nbook.agent.read"]};
    const declared = Object.entries(tools).map(([key, required]) => agentProfile(key, {name: key, description: "场景 10", tools: {required, optional: []}}));
    return {id: "test.scene10", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", ...declared.map((item) => item.activationEvent)],
        contributions: declared.map((item) => item.contribution),
        activate: () => ({contributions: {"agent.profiles": Object.fromEntries(Object.entries(tools).map(([key, required]) => [key, defineProfile({id: key, version: "1", name: key, description: "场景 10", system: "测试。", tools: {required}})]))}}),
    })]};
}

/** 另一个插件也在插件描述里登记了叫 `stats` 的对象（只有登记，没有方法）。 */
function clash(): PluginDefinition {
    const other = definePlugin({id: "test.scene10.clash", version: "0.1.0", locations: ["server"]});
    return definitionAt("server", other.descriptor([evalObject("test.scene10.clash.stats", {name: "stats", summary: "同名的另一个对象"})]), other.definition([]));
}

async function open(profile: string, extra: readonly PluginDefinition[] = []): Promise<SessionApi> {
    world = await agentWorld(join(tmp, `w${String((commands += 1))}`), {
        // 示例插件按产品宿主的装法装：插件描述里的顶层贡献（这里是全局对象）与服务端入口的定义合在一起。
        plugins: [definitionAt("server", wordStatsDescriptor, wordStatsBackendPlugin), profiles(), ...extra],
        userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[WITH_STATS]: {approvalMode: "yolo"}, [WITHOUT]: {approvalMode: "yolo"}}},
    });
    const created = await world.service.create({profile});
    if (!created.ok) throw new Error(created.code);
    return created.value;
}

/** 告诉模型的工具集里 eval 的版本（`toolsAnnounced`）。 */
function evalVersion(path: readonly LogEvent[]): string | undefined {
    const announced = path.filter((event) => event.type === "toolsAnnounced").at(-1)?.data as {tools: {id: string; version: string}[]} | undefined;
    return announced?.tools.find((tool) => tool.id === "nbook.agent.eval")?.version;
}

/** 模型调一次 eval，交回结果文字。 */
async function evalOnce(session: SessionApi, code: string): Promise<string> {
    endpoint.script({tool: "eval", args: {code}}, "好");
    const sent = await session.send({commandId: `s10-${String((commands += 1))}`, input: {text: "算一下"}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
    await session.waitRun(sent.value.runId);
    const result = (await session.path()).filter((event) => event.type === "toolResult").at(-1);
    return (result?.data as {text: string}).text;
}

describe("场景 10：eval 的全局对象", () => {
    it("绑定了方法的会话：代码里调到 stats.count 拿到对象；说明列出 stats；方法不进工具清单；文档里有生成的签名", async () => {
        const session = await open(WITH_STATS);
        expect(await evalOnce(session, "const r = await stats.count({text: '第一行\\n第二行'}); `${r.chars}/${r.lines}`")).toBe("6/2");

        // 模型看到的：工具清单里没有 stats.count 这个工具；eval 的说明按会话算，列出了对象，所以它的版本带着那一节的哈希
        //（说明的内容见 backend/eval/objects.test.ts）。
        expect(endpoint.requests.at(-1)?.tools).not.toContain("example__word-stats__count");
        expect(evalVersion(await session.path())).toMatch(/^1\+[0-9a-f]{8}$/u);

        // 文档按方法的参数与 returns 生成签名；用 eval 里的 tool.read 读（与模型直接调 read 读到的是同一份）。
        const doc = await evalOnce(session, "await tool.read({path: 'docs://eval/stats.md'})");
        expect(doc).toContain("count(args: {text: string}): Promise<{chars: number; lines: number}>");
        expect(doc).toContain("统计中文正文时按字符数");

        // `docs://` 的根列出 eval，`docs://eval` 列出登记了的对象；没登记的读不到（resources.md 输出 16）。
        const listed = await evalOnce(session, [
            "const root = await tool.read({path: 'docs://'});",
            "const objects = await tool.read({path: 'docs://eval'});",
            "const codes = [];",
            "try { await tool.read({path: 'docs://eval/none.md'}) } catch (e) { codes.push(e.code) }",
            "[root.entries.includes('docs://eval'), objects.entries.map((entry) => entry.split('/').at(-1)).join('+'), ...codes].join()",
        ].join("\n"));
        expect(listed).toBe("true,stats.md,not-found");
    });

    it("另一个插件也登记了 stats：两个都不用，stats.count 跟着移出工具表，各记一条诊断", async () => {
        const session = await open(WITH_STATS, [clash()]);
        // 这个 Profile 把 stats.count 列为必需的工具：它没了，运行起不来（要它可有可无，就写进 optional）。
        endpoint.script({tool: "eval", args: {code: "typeof stats"}}, "好");
        const sent = await session.send({commandId: `s10-${String((commands += 1))}`, input: {text: "算一下"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        expect(await session.waitRun(sent.value.runId)).toMatchObject({reason: "error", error: {code: "tools-missing"}});
        const events = world!.settings.diagnostics("hub").query({}).records.map((record) => record.event);
        expect(events).toContain("agent.eval-object-conflict");
        expect(events).toContain("agent.eval-object-missing");
    });

    it("没绑定方法的会话：看不到 stats", async () => {
        const session = await open(WITHOUT);
        expect(await evalOnce(session, "typeof stats")).toBe("undefined");
        expect(evalVersion(await session.path())).toBe("1");
    });

    it("会话中途换成没绑定方法的 Profile：下一次请求前模型收到“工具变了”的提醒，只说 eval 更新了；内核重新开始，代码里没有 stats", async () => {
        const session = await open(WITH_STATS);
        expect(await evalOnce(session, "typeof stats")).toBe("object");

        const changed = await session.changeProfile({commandId: `s10-${String((commands += 1))}`, profile: WITHOUT});
        expect(changed.ok).toBe(true);
        // 换了 Profile，eval 的内核也重新开始，之前的变量没了，结果第一行写明原因（eval.md 输出 11、12）。
        const after = await evalOnce(session, "typeof stats");
        expect(after.split("\n")).toEqual(["内核已重置（换了 Profile），之前的变量没了。", "undefined"]);

        // 内核比对前后两次告诉模型的工具集（id 加版本），eval 的版本带着对象列表的哈希，所以对象没了 eval 就算“更新了”。
        // 提醒在下一次请求之前写进对话（docs/specs/agent/eval.md 输出 16）。
        const notices = (await session.path()).filter((event) => event.type === "notice" && (event.data as {code: string}).code === "tools-changed");
        expect(notices).toHaveLength(1);
        expect((notices[0]!.data as {text: string}).text).toContain("(updated: nbook.agent.eval)");
    });
});
