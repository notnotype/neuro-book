/**
 * 跨实例列出与执行窗口里的命令（docs/specs/workbench/commands.md 的“跨实例列出与执行”“跨实例调用失败”、场景 14）：
 * 真实服务端与两个窗口实例，经进程内链路连上路由（帧经 JSON 编解码）。服务端问的是那个窗口此刻的状态。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {ref} from "@vue/reactivity";
import type {Ref} from "@vue/reactivity";
import {Type} from "typebox";

import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld, WorldWindow} from "nbook/plugins/storage/testing/world";

import {COMMANDS_POINT, commandsRemoteContract} from "./contracts";
import type {CommandDeclaration} from "./contracts";
import {commandsPlugin} from "./plugin";

const REASON = {"zh-CN": "这个窗口没有准备好", "en-US": "This window is not ready"};

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-commands", "remote-commands");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function declaration(overrides: Partial<CommandDeclaration> = {}): CommandDeclaration {
    return {title: {"zh-CN": "动手", "en-US": "Go"}, description: "do the thing", args: Type.Object({}, {additionalProperties: false}), effect: "write", expose: {agent: "auto"}, ...overrides};
}

/**
 * 窗口里的工具插件：声明公开键 `example.tools/armed` 并绑到 `armed`，贡献三条命令：`go` 要求 armed，`hidden` 不对
 * Agent 开放，`leave` 执行时关掉本窗口的链路（结果回不去）。
 */
function tools(armed: Ref<boolean>, onLeave: () => void): PluginDefinition {
    return {
        id: "example.tools",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [
                {capability: PUBLIC_STATE_POINT, id: "example.tools/armed", declaration: {type: "boolean", unready: false, reason: REASON}},
                {capability: COMMANDS_POINT, id: "example.tools.go", declaration: declaration({when: {requires: ["example.tools/armed"]}})},
                {capability: COMMANDS_POINT, id: "example.tools.hidden", declaration: declaration({expose: {agent: "never"}})},
                {capability: COMMANDS_POINT, id: "example.tools.leave", declaration: declaration()},
            ],
            activate: () => ({contributions: {
                [PUBLIC_STATE_POINT]: {"example.tools/armed": {kind: "bound", read: () => armed.value}},
                [COMMANDS_POINT]: {
                    "example.tools.go": {run: () => ({ok: true, value: "done"})},
                    "example.tools.hidden": {run: () => ({ok: true, value: "hidden"})},
                    "example.tools.leave": {run: () => {
                        onLeave();
                        return {ok: true, value: "left"};
                    }},
                },
            }}),
        }],
    };
}

/** 在某个位置上拿到远程访问的插件。 */
function caller(id: string, location: string): {readonly plugin: PluginDefinition; remote(): ActivationContext["remote"]} {
    let remote: ActivationContext["remote"] | null = null;
    return {
        plugin: {id, entries: [{id: location, location, activationEvents: ["onStartup"], activate: (context) => {
            remote = context.remote;
            return {};
        }}]},
        remote: () => {
            if (remote === null) throw new Error(`${id} 还没激活`);
            return remote;
        },
    };
}

async function setup(): Promise<{readonly agent: ReturnType<typeof caller>; readonly windows: ReadonlyArray<{readonly id: string; readonly armed: Ref<boolean>; readonly window: WorldWindow}>; readonly peer: ReturnType<typeof caller>}> {
    counter += 1;
    const agent = caller("example.agent", "server");
    const world = await storageWorld(join(tmp, `case-${String(counter)}`), [agent.plugin]);
    worlds.push(world);
    const peer = caller("example.peer", "browser");
    const windows = [];
    for (const id of ["browser-a", "browser-b"]) {
        const armed = ref(false);
        let opened: WorldWindow | null = null;
        const plugins = [statePlugin, commandsPlugin, tools(armed, () => opened?.disconnect())];
        if (id === "browser-a") plugins.push(peer.plugin);
        opened = await world.window(id, "profile-1", plugins, {bound: false});
        windows.push({id, armed, window: opened});
    }
    return {agent, windows, peer};
}

describe("Spec workbench.commands 场景 14：两个窗口的状态不同", () => {
    it("服务端分别问两个窗口：列表只含对 Agent 开放的命令，可用性各按那个窗口此刻的公开状态；对不可用的窗口执行为 unavailable、不执行", async () => {
        const {agent, windows} = await setup();
        windows[0]!.armed.value = true;
        const atA = agent.remote().use(commandsRemoteContract).at({client: "browser-a"});
        const atB = agent.remote().use(commandsRemoteContract).at({client: "browser-b"});

        const listed = async (at: typeof atA) => {
            const result = await at.list({});
            if (!result.ok) throw new Error(`列出失败：${result.code}`);
            return result.value.map((command) => [command.id, command.available, command.reason]);
        };
        expect(await listed(atA)).toEqual([["example.tools.go", true, null], ["example.tools.leave", true, null]]);
        expect(await listed(atB)).toEqual([["example.tools.go", false, "这个窗口没有准备好"], ["example.tools.leave", true, null]]);

        expect(await atA.execute({id: "example.tools.go"})).toEqual({ok: true, value: {ok: true, value: "done"}});
        expect(await atB.execute({id: "example.tools.go"})).toEqual({ok: true, value: {ok: false, code: "unavailable", reason: "这个窗口没有准备好"}});
        expect(await atA.execute({id: "example.tools.hidden"})).toMatchObject({ok: true, value: {ok: false, code: "not-exposed"}});

        windows[1]!.armed.value = true;
        expect(await atB.execute({id: "example.tools.go"})).toEqual({ok: true, value: {ok: true, value: "done"}});
    });
});

describe("Spec workbench.commands“跨实例调用失败”", () => {
    it("窗口不在为 target-gone；执行派发后窗口断线为 unknown-outcome；浏览器实例调用为 denied", async () => {
        const {agent, peer} = await setup();
        expect(await agent.remote().use(commandsRemoteContract).at({client: "nobody"}).list({})).toMatchObject({ok: false, code: "target-gone"});
        expect(await agent.remote().use(commandsRemoteContract).at({client: "browser-b"}).execute({id: "example.tools.leave"})).toMatchObject({ok: false, code: "unknown-outcome"});
        expect(await peer.remote().use(commandsRemoteContract).at({client: "browser-a"}).list({})).toMatchObject({ok: false, code: "denied"});
    });
});
