/**
 * 场景 4：远程服务、项目实例、插件状态与命令（`counter` 的服务端入口与项目入口，窗口里的面板直接用合同）。
 *
 * 要说明的事：
 * - 窗口里的插件直接用合同调用服务端：结果是结构化的，`orThrow` 只取值；订阅收到每次变化；提供方看得到调用方是谁；
 *   订阅归发起它的入口，入口停止时内核替它结束。
 * - 项目入口每个项目实例一份，第一次有调用到达时才激活；窗口省略 `.at()` 到达它绑定的项目。
 * - 按领域降级：面板用 `context.remote.lookup` 在调用前得知项目实例有没有装 counter，没装就不显示项目计数，查询本身
 *   不激活提供方；`instances()` 列出此刻在线的实例。
 * - 服务端的计数由 `defineStore` 持久化进 `nbook.storage`，服务端重启后还在；公开键 `example.counter/nonzero` 随计数
 *   变化，引用它的命令 `example.counter.reset` 随之可用与不可用。
 *
 * 阅读顺序：`plugins/counter/shared/contracts.ts` → `plugins/counter/backend/plugin.ts` → 这里。
 *
 * 行为合同：docs/specs/runtime/plugin-channel.md（输出第 1、4、5、7、8、11 条）、docs/specs/runtime/projects.md、
 * docs/specs/state/store.md、docs/specs/state/public-state.md、docs/specs/workbench/commands.md。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {PluginRemoteAccess} from "@notnotype/nb-runtime/plugins";
import {orThrow, RemoteCallError} from "@notnotype/nb-runtime/remote";
import type {RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {commandServiceKey} from "nbook/plugins/commands/shared/contracts";

import {counterBackendPlugin} from "../plugins/counter/backend/plugin";
import {counterContract, projectCounterContract, RESET_COMMAND} from "../plugins/counter/shared/contracts";
import {remoteProbe, serviceProbe} from "../testing/probes";
import {Stage} from "../testing/stage";

let tmp = "";
let cases = 0;
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 4：远程服务");
});

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function newStage(): Stage {
    cases += 1;
    const stage = new Stage(join(tmp, `case-${String(cases)}`));
    stages.push(stage);
    return stage;
}

/** 起一个窗口，装一个面板插件（探针），交出面板的远程访问。`project` 是窗口绑定的项目名，不给时不绑定。 */
async function panelIn(stage: Stage, router: RemoteRouter, id: string, project?: string): Promise<PluginRemoteAccess> {
    const panel = remoteProbe("example.panel", "browser");
    await stage.window(router, id, {plugins: [panel.definition], project});
    return panel.remote();
}

/**
 * 面板显示“项目计数”的做法：项目里装了 counter 才显示，否则这一块不出现。先用 `lookup` 问，不直接调用：查询不激活
 * 提供方、不建立订阅（docs/specs/runtime/plugin-channel.md 输出第 11 条）；直接调用没装的合同同样得到确定失败
 * `not-provided`，但装了时会把提供方激活。查到 `provided` 之后的调用照样可能失败（提供方此刻停止了），照常处理失败码。
 */
async function projectBadge(remote: PluginRemoteAccess): Promise<string> {
    const found = await remote.lookup(projectCounterContract);
    if (!found.ok) return `暂时查不到：${found.code}`;
    if (found.value.status !== "provided") return "不显示";
    const count = await remote.use(projectCounterContract).current({});
    return count.ok ? `项目计数 ${String(count.value)}` : `暂时不可用：${count.code}`;
}

describe("场景 4：远程服务", () => {
    it("窗口直接用合同调用服务端：orThrow 只取值；订阅收到每次变化；提供方看到的调用方是面板；不合合同的输入被拒", async () => {
        const stage = newStage();
        const {router} = await stage.server({plugins: [counterBackendPlugin]});
        // 提供方位置是 server，省略 `.at()` 即到服务端。
        const counter = (await panelIn(stage, router, "window-1")).use(counterContract);

        const seen: number[] = [];
        expect(await counter.events.changed.subscribe({}, (value) => seen.push(value))).toMatchObject({ok: true});
        expect(await counter.increment({by: 2})).toEqual({ok: true, value: 2});
        // 只想要值时用 orThrow：成功给值，失败抛 RemoteCallError，失败结果原样放在它的 failure 里。
        expect(orThrow(await counter.increment({by: 3}))).toBe(5);
        expect(await counter.current({})).toEqual({ok: true, value: 5});
        // 事件与结果走同一条链路、按发送顺序到达：拿到结果时，之前的事件已经送达。
        expect(seen).toEqual([2, 5]);
        expect(await counter.caller({})).toEqual({ok: true, value: {plugin: "example.panel", instance: "window-1"}});

        const rejected = await counter.increment({by: 0});
        expect(rejected).toMatchObject({ok: false, code: "invalid-input"});
        expect(() => orThrow(rejected)).toThrow(RemoteCallError);
    });

    it("订阅归发起它的入口：面板插件停止后它的订阅随之结束，之后的变化不再送到它；别的插件照常收到", async () => {
        const stage = newStage();
        const {router} = await stage.server({plugins: [counterBackendPlugin]});
        const writer = remoteProbe("example.writer", "browser");
        const window = await stage.window(router, "window-1", {plugins: [writer.definition]});
        const counter = writer.remote().use(counterContract);
        // 面板装在窗口的一个子作用域里，`stop()` 停止它（产品里对应停用插件）。
        const panel = remoteProbe("example.panel", "browser");
        const attached = await stage.attach(window, panel.definition, "browser");
        const panelSeen: number[] = [];
        const writerSeen: number[] = [];
        expect(await panel.remote().use(counterContract).events.changed.subscribe({}, (value) => panelSeen.push(value))).toMatchObject({ok: true});
        expect(await counter.events.changed.subscribe({}, (value) => writerSeen.push(value))).toMatchObject({ok: true});
        await counter.increment({by: 1});

        expect((await attached.stop()).status).toBe("closed");
        await counter.increment({by: 1});
        // 面板不用自己记着释放订阅：订阅登记在它这一代入口上，入口停止时内核替它结束。
        expect(panelSeen).toEqual([1]);
        expect(writerSeen).toEqual([1, 2]);
    });

    it("项目入口每个项目实例一份，第一次调用时才激活；窗口省略 .at() 到达它绑定的项目；没绑定项目的窗口得到 target-gone", async () => {
        const stage = newStage();
        const {router} = await stage.server({plugins: []});
        const alpha = await stage.project(router, "alpha", {plugins: [counterBackendPlugin]});
        await stage.project(router, "beta", {plugins: [counterBackendPlugin]});
        const inAlpha = (await panelIn(stage, router, "window-a", "alpha")).use(projectCounterContract);
        const inBeta = (await panelIn(stage, router, "window-b", "beta")).use(projectCounterContract);
        const unbound = (await panelIn(stage, router, "window-c")).use(projectCounterContract);
        const entry = {plugin: "example.counter", entry: "project"};
        expect(alpha.plugins.entryState(entry)?.status).toBe("registered");

        expect(await inAlpha.increment({by: 1})).toEqual({ok: true, value: 1});
        expect(await inBeta.increment({by: 5})).toEqual({ok: true, value: 5});
        expect(await inAlpha.current({})).toEqual({ok: true, value: 1});
        expect(alpha.plugins.entryState(entry)?.status).toBe("available");
        expect(await unbound.current({})).toMatchObject({ok: false, code: "target-gone"});
    });

    it("lookup 在调用前回答项目里有没有装 counter：没装为 not-provided，面板就不显示；装了为 provided，查询本身不激活提供方", async () => {
        const stage = newStage();
        const {router} = await stage.server({plugins: []});
        await stage.project(router, "plain", {plugins: []});
        const withCounter = await stage.project(router, "counted", {plugins: [counterBackendPlugin]});
        const plain = await panelIn(stage, router, "window-plain", "plain");
        const counted = await panelIn(stage, router, "window-counted", "counted");
        const entry = {plugin: "example.counter", entry: "project"};

        expect(await plain.lookup(projectCounterContract)).toEqual({ok: true, value: {status: "not-provided"}});
        expect(await projectBadge(plain)).toBe("不显示");
        // 不查直接调用，得到的也是确定失败 not-provided：这项功能在那个项目里不存在，重试没有意义。
        expect(await plain.use(projectCounterContract).current({})).toMatchObject({ok: false, code: "not-provided"});

        expect(await counted.lookup(projectCounterContract)).toEqual({ok: true, value: {status: "provided", state: "registered"}});
        expect(withCounter.plugins.entryState(entry)?.status).toBe("registered");
        expect(await projectBadge(counted)).toBe("项目计数 0");
        expect(withCounter.plugins.entryState(entry)?.status).toBe("available");
    });

    it("instances() 列出此刻在线的实例：服务端、项目与窗口", async () => {
        const stage = newStage();
        const {router} = await stage.server({plugins: []});
        await stage.project(router, "alpha", {plugins: []});
        const panel = await panelIn(stage, router, "window-1", "alpha");

        const listed = orThrow(await panel.instances());
        expect(listed.map((instance) => ({id: instance.id, kind: instance.kind})).sort((left, right) => left.id.localeCompare(right.id))).toEqual([
            {id: "hub", kind: "server"},
            {id: "project:alpha#1", kind: "project"},
            {id: "window-1", kind: "browser"},
        ]);
    });

    it("计数存在 nbook.storage 里，服务端重启后还在；公开键随计数变化，命令 example.counter.reset 随之可用与不可用", async () => {
        const stage = newStage();
        // 探针站在“执行命令的内置插件”（例如命令面板）的位置上：命令服务的同步查询只给内置插件用。
        const shell = serviceProbe("example.shell", "server", [commandServiceKey]);
        const {router} = await stage.server({plugins: [counterBackendPlugin, shell.definition]});
        const counter = (await panelIn(stage, router, "window-1")).use(counterContract);
        expect(shell.get(commandServiceKey).isEnabled(RESET_COMMAND)).toEqual({ok: false, code: "unavailable", reason: "计数已经是 0"});
        expect(await counter.increment({by: 3})).toEqual({ok: true, value: 3});
        expect(shell.get(commandServiceKey).isEnabled(RESET_COMMAND)).toEqual({ok: true, value: true});
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});

        // 同一个状态根，起新的服务端实例。counter 的入口等计数读出来才完成激活，所以实例一启动完，公开键就是存着的值。
        const restartedShell = serviceProbe("example.shell", "server", [commandServiceKey]);
        const restarted = await stage.server({plugins: [counterBackendPlugin, restartedShell.definition]});
        const commands = restartedShell.get(commandServiceKey);
        expect(commands.isEnabled(RESET_COMMAND)).toEqual({ok: true, value: true});
        const again = (await panelIn(stage, restarted.router, "window-1")).use(counterContract);
        expect(await again.current({})).toEqual({ok: true, value: 3});

        expect(await commands.execute(RESET_COMMAND, {})).toEqual({ok: true, value: null});
        expect(await again.current({})).toEqual({ok: true, value: 0});
        expect(commands.isEnabled(RESET_COMMAND)).toMatchObject({ok: false, code: "unavailable"});
    });
});
