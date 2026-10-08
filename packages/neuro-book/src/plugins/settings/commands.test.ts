/**
 * 设置命令与按界面语言给出的文字（docs/specs/workbench/commands.md 的“命令目录（设置）”与“可用性求值”，
 * docs/specs/settings/configuration.md 输出 11）：真实的命令系统、公开状态与 `nbook.settings`，多实例场地。
 * 选择服务在这里由测试按请求作答（产品里是工作台的命令面板，面板本身由组件测试覆盖）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import type {QuickPick, QuickPickRequest, QuickPickResult} from "nbook/plugins/workbench/shared/contracts";
import {textOf} from "nbook/shared/localized-text";

import {RELOAD_DELAY_MS} from "./backend/layer-owner";
import {displayLocale, settingsKey} from "./shared/contracts";
import type {SettingsService} from "nbook/shared/settings";
import {settingsWorld} from "./testing/world";
import type {SettingsWorld} from "./testing/world";
import {SWITCH_LOCALE_COMMAND} from "./web/plugin";

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-settings", "settings-commands");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 按请求作答的选择服务：记下收到的请求，用给定的作答函数回答。 */
function picker(answer: (request: QuickPickRequest) => QuickPickResult): QuickPick & {readonly requests: QuickPickRequest[]} {
    const requests: QuickPickRequest[] = [];
    return {requests, pick: async (request) => {
        requests.push(request);
        return answer(request);
    }};
}

interface Reader {
    commands: CommandService | null;
    settings: SettingsService | null;
}

/** 读出命令服务与配置服务；另贡献一条 `when` 引用未声明公开键的命令，用来看不满足的原因。 */
function reader(target: Reader): PluginDefinition {
    return {
        id: "x.reader",
        entries: [defineEntry({
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: commandServiceKey}, {key: settingsKey}],
            contributions: [{capability: COMMANDS_POINT, id: "x.reader.guarded", declaration: {title: {"zh-CN": "受限", "en-US": "Guarded"}, description: "guarded", args: Type.Object({}, {additionalProperties: false}), effect: "read", when: {requires: ["x.reader/missing"]}}}],
            activate: (context) => {
                target.commands = context.services.require(commandServiceKey);
                target.settings = context.services.require(settingsKey);
                return {contributions: {[COMMANDS_POINT]: {"x.reader.guarded": {run: () => ({ok: true, value: null})}}}};
            },
        })],
    };
}

async function world(user?: string): Promise<SettingsWorld> {
    counter += 1;
    const root = join(tmp, `world-${String(counter)}`);
    if (user !== undefined) {
        await mkdir(join(root, "state"), {recursive: true});
        await writeFile(join(root, "state", "settings.json"), user);
    }
    const created = await settingsWorld(root, []);
    worlds.push(created);
    return created;
}

async function window(created: SettingsWorld, id: string, quickPick: QuickPick): Promise<Reader> {
    const target: Reader = {commands: null, settings: null};
    await created.window(id, [statePlugin, commandsPlugin, reader(target)], {bound: false, quickPick});
    return target;
}

describe("切换界面语言", () => {
    it("Agent 带参数：直接写用户层，不打开选择；所有窗口与命令的不满足原因换成英文；非法参数为 invalid-args 且不写", async () => {
        const created = await world();
        const pick = picker(() => ({kind: "cancelled"}));
        const a = await window(created, "w-a", pick);
        const b = await window(created, "w-b", picker(() => ({kind: "cancelled"})));
        expect(a.commands!.isEnabled("x.reader.guarded")).toEqual({ok: false, code: "unavailable", reason: "when 引用的 x.reader/missing 不是本运行位置声明的公开键"});

        const switched = await a.commands!.execute(SWITCH_LOCALE_COMMAND, {locale: "en-US"}, {source: "agent", callerId: "x.agent"});
        expect(switched).toEqual({ok: true, value: null});
        expect(pick.requests).toEqual([]);
        expect(displayLocale(a.settings!)).toBe("en-US");
        await waitUntil("另一个窗口换成英文", () => displayLocale(b.settings!) === "en-US");
        expect(b.commands!.isEnabled("x.reader.guarded")).toEqual({ok: false, code: "unavailable", reason: "x.reader/missing in when is not a public key declared at this location"});
        expect(JSON.parse(await readFile(created.userFile, "utf8"))).toEqual({"nbook.settings/locale": "en-US"});

        expect(await a.commands!.execute(SWITCH_LOCALE_COMMAND, {locale: "fr-FR"}, {source: "agent", callerId: "x.agent"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(JSON.parse(await readFile(created.userFile, "utf8"))).toEqual({"nbook.settings/locale": "en-US"});
    });

    it("不带参数：经选择列出两种语言并标出当前；选中即写，取消为成功且不写", async () => {
        const created = await world();
        const choose = picker((request) => (request.items.some((item) => item.id === "en-US") ? {kind: "item", id: "en-US"} : {kind: "cancelled"}));
        const a = await window(created, "w-a", choose);
        expect(await a.commands!.execute(SWITCH_LOCALE_COMMAND, {}, {source: "user"})).toEqual({ok: true, value: null});
        const request = choose.requests[0]!;
        expect(textOf(request.title, "zh-CN")).toBe("切换界面语言");
        expect(request.items.map((item) => [item.id, item.label, item.detail === undefined ? null : textOf(item.detail, "zh-CN")])).toEqual([["zh-CN", "简体中文", "当前"], ["en-US", "English", null]]);
        expect(displayLocale(a.settings!)).toBe("en-US");

        const cancelled = await world();
        const b = await window(cancelled, "w-b", picker(() => ({kind: "cancelled"})));
        expect(await b.commands!.execute(SWITCH_LOCALE_COMMAND, {}, {source: "user"})).toEqual({ok: true, value: null});
        await expect(readFile(cancelled.userFile, "utf8")).rejects.toThrow();
    });

    it("配置写入失败转换为命令失败：文件当前无效为 execution-error，原因带配置的失败码", async () => {
        const created = await world("{\"nbook.settings/locale\": ");
        const a = await window(created, "w-a", picker(() => ({kind: "cancelled"})));
        const result = await a.commands!.execute(SWITCH_LOCALE_COMMAND, {locale: "en-US"}, {source: "user"});
        expect(result).toMatchObject({ok: false, code: "execution-error"});
        expect(result.ok ? "" : result.reason).toContain("layer-invalid");
        await writeFile(created.userFile, "{}");
        await waitUntil("文件修好后可写", async () => {
            created.clock.advance(RELOAD_DELAY_MS);
            return (await a.commands!.execute(SWITCH_LOCALE_COMMAND, {locale: "en-US"}, {source: "user"})).ok;
        });
    });
});
