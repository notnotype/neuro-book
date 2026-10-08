/**
 * `nbook.commands` 经真实内核装配（workbench.commands 场景 1、11、12）：插件经贡献点登记命令、经命令服务执行；
 * 贡献撤回后命令离开命令表；冲突与不合格的声明按内核的贡献规则拒绝；一份定义含两个运行位置的入口，每个实例
 * 各自一份命令表。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";

import {createApplication} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";

import {COMMANDS_POINT, commandServiceKey} from "./contracts";
import type {CommandDeclaration, CommandImplementation, CommandService} from "./contracts";
import {commandsPlugin} from "./plugin";

const silent = {error: () => undefined};
const NAME_ARGS = Type.Object({name: Type.String()}, {additionalProperties: false});

function declaration(overrides: Partial<CommandDeclaration> = {}): CommandDeclaration {
    return {title: {"zh-CN": "问候", "en-US": "Greet"}, description: "greet someone", args: Type.Object({}, {additionalProperties: false}), effect: "read", ...overrides};
}

type Contributed = Readonly<Record<string, {declaration: CommandDeclaration; implementation: CommandImplementation}>>;

/**
 * 贡献命令的测试插件。它依赖命令服务（借此拿到服务交给测试），依赖关系也让它先于 `nbook.commands` 关闭，
 * 停止时它的贡献在命令表还活着的时候被撤回。
 */
function provider(id: string, location: RuntimeLocation, commands: Contributed, onService: (service: CommandService) => void = () => undefined): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location,
            activationEvents: ["onStartup"],
            dependencies: [{key: commandServiceKey}],
            contributions: Object.entries(commands).map(([commandId, command]) => ({capability: COMMANDS_POINT, id: commandId, declaration: command.declaration})),
            activate: (context) => {
                onService(context.services.require(commandServiceKey));
                return {contributions: {[COMMANDS_POINT]: Object.fromEntries(Object.entries(commands).map(([commandId, command]) => [commandId, command.implementation]))}};
            },
        }],
    };
}

async function start(location: RuntimeLocation, plugins: ReadonlyArray<PluginDefinition>) {
    const identity = {location, instanceId: `commands-${location}`};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location, store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [diagnostics, commandsPlugin, ...plugins], requiredPlugins: [diagnostics.id, commandsPlugin.id], gates: []},
    );
    expect((await application.startup).status).toBe("available");
    return {application, store};
}

describe("nbook.commands 经内核装配", () => {
    for (const location of ["server", "browser"] as const) {
        it(`${location}：贡献的命令经命令服务执行；停止时贡献撤回，命令离开命令表`, async () => {
            let service: CommandService | null = null;
            const greeter = provider("example.greeter", location, {
                "example.greeter.greet": {
                    declaration: declaration({args: NAME_ARGS}),
                    implementation: {run: (args) => ({ok: true, value: `你好，${(args as {name: string}).name}`})},
                },
            }, (resolved) => {
                service = resolved;
            });
            const {application} = await start(location, [greeter]);
            const commands = service as CommandService | null;
            if (commands === null) throw new Error("测试插件没有拿到命令服务");

            expect(commands.list().map((metadata) => [metadata.id, metadata.source])).toEqual([["example.greeter.greet", "example.greeter"]]);
            expect(await commands.execute("example.greeter.greet", {name: "林"})).toEqual({ok: true, value: "你好，林"});
            expect(await commands.execute("example.greeter.greet", {})).toMatchObject({ok: false, code: "invalid-args"});

            expect((await application.stop()).status).toBe("closed");
            expect(commands.list()).toEqual([]);
            expect(await commands.execute("example.greeter.greet", {name: "林"})).toMatchObject({ok: false, code: "unknown-command"});
        });
    }

    it("同一份定义同时在服务端与浏览器两个实例里运行：各实例只激活本位置的入口，命令表互相隔离", async () => {
        const services = new Map<string, CommandService>();
        const run = {run: () => ({ok: true as const, value: null})};
        const started = await Promise.all((["server", "browser"] as const).map((location) =>
            start(location, [provider(`example.${location}`, location, {[`example.${location}.ping`]: {declaration: declaration(), implementation: run}}, (resolved) => {
                services.set(location, resolved);
            })]),
        ));
        expect(services.get("server")?.list().map((metadata) => metadata.id)).toEqual(["example.server.ping"]);
        expect(services.get("browser")?.list().map((metadata) => metadata.id)).toEqual(["example.browser.ping"]);
        const [server, browser] = started.map(({application}) => application);
        expect(server?.plugins.entryState({plugin: commandsPlugin.id, entry: "server"})).toMatchObject({status: "available"});
        expect(server?.plugins.entryState({plugin: commandsPlugin.id, entry: "browser"})).toMatchObject({status: "foreign-location"});
        expect(browser?.plugins.entryState({plugin: commandsPlugin.id, entry: "browser"})).toMatchObject({status: "available"});
        expect(browser?.plugins.entryState({plugin: commandsPlugin.id, entry: "server"})).toMatchObject({status: "foreign-location"});
        await Promise.all(started.map(({application}) => application.stop()));
    });

    it("两个内置插件贡献同一命令 id：两条一起被拒绝，与加载顺序无关", async () => {
        let service: CommandService | null = null;
        const run = {run: () => ({ok: true as const, value: null})};
        const first = provider("nbook.test-first", "server", {"nbook.edit.undo": {declaration: declaration({effect: "write"}), implementation: run}}, (resolved) => {
            service = resolved;
        });
        const second = provider("nbook.test-second", "server", {"nbook.edit.undo": {declaration: declaration({effect: "write"}), implementation: run}});
        const {application} = await start("server", [second, first]);

        const states = application.plugins.contribution(COMMANDS_POINT, "nbook.edit.undo");
        expect(states.map((state) => [state.plugin, state.validation.status, state.validation.status === "rejected" ? state.validation.reason : null])).toEqual([
            ["nbook.test-first", "rejected", "duplicate-contribution"],
            ["nbook.test-second", "rejected", "duplicate-contribution"],
        ]);
        expect((service as CommandService | null)?.list()).toEqual([]);
        await application.stop();
    });

    it("不合格的声明只拒绝这一条，原因可查；同一插件的其它命令照常登记", async () => {
        let service: CommandService | null = null;
        const run = {run: () => ({ok: true as const, value: null})};
        const greeter = provider("example.greeter", "browser", {
            "example.greeter.greet": {declaration: declaration(), implementation: run},
            "example.greeter.wait": {declaration: declaration({when: {requires: ["editor-active"]}}), implementation: run},
            "nbook.edit.undo": {declaration: declaration(), implementation: run},
        }, (resolved) => {
            service = resolved;
        });
        const {application} = await start("browser", [greeter]);

        const rejection = (id: string): string | null => {
            const validation = application.plugins.contribution(COMMANDS_POINT, id)[0]?.validation;
            return validation?.status === "rejected" ? validation.detail : null;
        };
        expect(rejection("example.greeter.wait")).toContain("未登记的 when 取值：editor-active");
        expect(rejection("nbook.edit.undo")).toContain("插件 example.greeter 的命令 id 必须是 example.greeter.<action>");
        expect((service as CommandService | null)?.list().map((metadata) => metadata.id)).toEqual(["example.greeter.greet"]);
        await application.stop();
    });

    it("命令执行时抛出异常：调用方得到 execution-error，异常按贡献方插件记入诊断", async () => {
        let service: CommandService | null = null;
        const greeter = provider("example.greeter", "server", {
            "example.greeter.fail": {declaration: declaration(), implementation: {run: () => {
                throw new Error("问候失败");
            }}},
        }, (resolved) => {
            service = resolved;
        });
        const {application, store} = await start("server", [greeter]);

        expect(await (service as CommandService | null)?.execute("example.greeter.fail")).toEqual({ok: false, code: "execution-error", reason: "问候失败"});
        const recorded = store.query({plugin: "example.greeter"}).records.filter((record) => record.event === "commands.run-failed");
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.level).toBe("error");
        expect(recorded[0]?.message).toContain("example.greeter.fail");
        expect(recorded[0]?.error).toMatchObject({message: "问候失败"});
        await application.stop();
    });
});
