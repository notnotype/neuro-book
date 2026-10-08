/**
 * 命令表的合同（workbench.commands 场景 1–8）：登记与冲突、别名、`when`、参数严格校验、Agent 暴露、
 * 只读联动、确认快照与单次审计。经贡献点登记的冲突语义另见 `plugin.test.ts`。
 */

import {describe, expect, it} from "bun:test";
import {Type} from "typebox";
import type {TSchema} from "typebox";

import {contextTable} from "./context-keys";
import type {ContextValues} from "./context-keys";
import type {AgentMode, CommandDeclaration, CommandExecutionEvent, CommandResult} from "./contracts";
import {createCommandRegistry} from "./registry";
import type {CommandConfirmationRequest, CommandDefinition, CommandRegistryOptions} from "./registry";

const CONTEXT_KEYS = {"editor-active": "需要活动编辑器", "editor-writable": "当前编辑器不可写"};
const NO_ARGS = Type.Object({}, {additionalProperties: false});
const TEXT_ARGS = Type.Object({text: Type.String()}, {additionalProperties: false});
const agent = {source: "agent", callerId: "lab"} as const;

function value<T>(result: CommandResult<T>): T {
    if (!result.ok) throw new Error(`${result.code}：${result.reason}`);
    return result.value;
}

function harness(options: {confirm?: CommandRegistryOptions["confirm"]} = {}) {
    let context: ContextValues = {};
    let mode: AgentMode = "normal";
    const reported: string[] = [];
    const events: CommandExecutionEvent[] = [];
    const registry = createCommandRegistry({
        contextKeys: contextTable(CONTEXT_KEYS, () => context),
        agentMode: () => mode,
        confirm: options.confirm,
        report: (error) => reported.push(error.message),
    });
    registry.onDidExecute((event) => events.push(event));
    return {
        registry,
        reported,
        events,
        setContext: (values: ContextValues) => {
            context = values;
        },
        setMode: (next: AgentMode) => {
            mode = next;
        },
    };
}

function command(id: string, overrides: Partial<CommandDeclaration> & {source?: string; run?: CommandDefinition["run"]} = {}): CommandDefinition {
    const {source = "nbook.test", run = () => ({ok: true, value: null}), ...declaration} = overrides;
    return {
        id,
        source,
        declaration: {title: {"zh-CN": "测试", "en-US": "Test"}, description: "test command", args: NO_ARGS, effect: "read", ...declaration},
        run,
    };
}

/** 记录调用的处理函数：断言处理函数是否运行，以及收到的参数。 */
function recorder(result: CommandResult<unknown> = {ok: true, value: null}) {
    const calls: unknown[] = [];
    return {calls, run: (args: unknown) => {
        calls.push(args);
        return result;
    }};
}

describe("登记、释放与冲突", () => {
    it("登记后可枚举与执行，释放后同 id 不再是命令", async () => {
        const {registry, events} = harness();
        const release = value(registry.register(command("nbook.edit.undo", {effect: "write", run: () => ({ok: true, value: "ran"})})));

        expect(value(registry.get("nbook.edit.undo"))).toMatchObject({id: "nbook.edit.undo", source: "nbook.test", effect: "write"});
        expect(registry.list().map((metadata) => metadata.id)).toEqual(["nbook.edit.undo"]);
        expect(await registry.execute("nbook.edit.undo")).toEqual({ok: true, value: "ran"});
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({requestedId: "nbook.edit.undo", id: "nbook.edit.undo", args: {}, invocation: {source: "user"}});
        expect(typeof events[0]?.durationMs).toBe("number");

        release();
        expect(await registry.execute("nbook.edit.undo")).toMatchObject({ok: false, code: "unknown-command"});
        expect(registry.list()).toEqual([]);
    });

    it("同一个定义对象重复登记幂等：同一个释放函数，只登记一次", () => {
        const {registry} = harness();
        const definition = command("nbook.edit.undo");
        const first = value(registry.register(definition));
        expect(value(registry.register(definition))).toBe(first);
        expect(registry.list()).toHaveLength(1);
    });

    it("不同对象登记同一 id：拒绝后来者、保留首个，只报告一次", async () => {
        const {registry, reported} = harness();
        value(registry.register(command("nbook.edit.undo", {description: "first", run: () => ({ok: true, value: "first"})})));
        const second = command("nbook.edit.undo", {description: "second", run: () => ({ok: true, value: "second"})});

        const rejected = registry.register(second);
        expect(rejected.ok ? "" : rejected.code).toBe("invalid-args");
        expect(rejected.ok ? "" : rejected.reason).toContain("nbook.edit.undo");
        registry.register(second);
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain("nbook.edit.undo");
        expect(value(registry.get("nbook.edit.undo")).description).toBe("first");
        expect(await registry.execute("nbook.edit.undo")).toEqual({ok: true, value: "first"});
    });

    it("旧的释放函数不能删掉重新登记的同 id 条目", async () => {
        const {registry} = harness();
        const oldRelease = value(registry.register(command("nbook.edit.undo", {run: () => ({ok: true, value: "first"})})));
        oldRelease();
        const newRelease = value(registry.register(command("nbook.edit.undo", {run: () => ({ok: true, value: "second"})})));
        oldRelease();

        expect(await registry.execute("nbook.edit.undo")).toEqual({ok: true, value: "second"});
        newRelease();
        expect(registry.list()).toEqual([]);
    });

    it("不合格的声明被拒绝、不登记，并报告原因", () => {
        const broken: Array<[CommandDefinition, string]> = [
            [command("nbook.edit"), "nbook.<domain>.<action>"],
            [command("nbook.local.undo"), "未登记的命令域：local"],
            [command("nbook.edit.undo", {description: " "}), "/description"],
            [command("nbook.edit.undo", {title: {"zh-CN": "撤销"} as CommandDeclaration["title"]}), "/title"],
            [command("nbook.edit.undo", {args: Type.Object({text: Type.String()})}), "/args"],
            [command("nbook.edit.undo", {args: Type.Array(Type.String()) as TSchema}), "/args"],
            [command("nbook.edit.undo", {effect: "write", expose: {hints: {readOnly: true}}}), "readOnly 标注与 effect=write 冲突"],
            [command("nbook.edit.undo", {when: {requires: ["offline"]}}), "未登记的 when 取值：offline"],
            [{...command("nbook.edit.undo"), run: undefined as unknown as CommandDefinition["run"]}, "必须提供 run"],
        ];
        for (const [definition, expected] of broken) {
            const {registry, reported} = harness();
            const result = registry.register(definition);
            expect(result.ok ? "" : result.code).toBe("invalid-args");
            expect(result.ok ? "" : result.reason).toContain(expected);
            expect(registry.list()).toEqual([]);
            expect(reported).toHaveLength(1);
        }
    });

    it("非内置插件的命令 id 必须以自己的插件 id 开头，不能占用 nbook 命名空间", () => {
        const {registry} = harness();
        expect(registry.register(command("example.tts.speak", {source: "example.tts"})).ok).toBe(true);
        expect(registry.register(command("nbook.edit.redo", {source: "example.tts"})).ok).toBe(false);
        expect(registry.register(command("example.other.speak", {source: "example.tts"})).ok).toBe(false);
        expect(registry.register(command("example.tts.read.aloud", {source: "example.tts"})).ok).toBe(false);
        expect(registry.list().map((metadata) => metadata.id)).toEqual(["example.tts.speak"]);
    });
});

describe("when 与可用性", () => {
    it("已登记但没满足的键：判定与执行都给出 unavailable 与可读原因，满足后放行", async () => {
        const {registry, setContext} = harness();
        value(registry.register(command("nbook.edit.undo", {when: {requires: ["editor-active", "editor-writable"]}})));

        expect(registry.isEnabled("nbook.edit.undo")).toEqual({ok: false, code: "unavailable", reason: "需要活动编辑器；当前编辑器不可写"});
        expect(await registry.execute("nbook.edit.undo")).toMatchObject({ok: false, code: "unavailable"});
        setContext({"editor-active": true, "editor-writable": true});
        expect(registry.isEnabled("nbook.edit.undo")).toEqual({ok: true, value: true});
        expect(await registry.execute("nbook.edit.undo")).toEqual({ok: true, value: null});
    });

    it("未登记的 id 与未知别名都是 unknown-command", async () => {
        const {registry} = harness();
        expect(registry.get("nbook.ghost.run").ok).toBe(false);
        expect(registry.get("file.quit").ok).toBe(false);
        expect(registry.isEnabled("nbook.ghost.run")).toMatchObject({ok: false, code: "unknown-command"});
        expect(await registry.execute("nbook.ghost.run")).toMatchObject({ok: false, code: "unknown-command"});
    });
});

describe("别名", () => {
    it("别名只解析到 canonical：枚举与审计 id 都不含别名", async () => {
        const {registry, events} = harness();
        const target = recorder({ok: true, value: "quit"});
        value(registry.register(command("nbook.app.quit", {run: target.run})));
        value(registry.registerAlias("file.quit", "nbook.app.quit"));

        expect(await registry.execute("file.quit")).toEqual({ok: true, value: "quit"});
        expect(target.calls).toHaveLength(1);
        expect(events[0]).toMatchObject({requestedId: "file.quit", id: "nbook.app.quit"});
        expect(registry.list().map((metadata) => metadata.id)).toEqual(["nbook.app.quit"]);
        expect(value(registry.get("file.quit")).id).toBe("nbook.app.quit");
        expect(value(registry.isEnabled("file.quit"))).toBe(true);
    });

    it("同一别名指向同一目标幂等；改指、与命令同名（两个登记方向）、目标不存在、格式不对都被拒绝", async () => {
        const {registry} = harness();
        value(registry.register(command("nbook.app.quit", {run: () => ({ok: true, value: "quit"})})));
        value(registry.register(command("nbook.app.reload")));

        const first = value(registry.registerAlias("nbook.app.exit", "nbook.app.quit"));
        expect(value(registry.registerAlias("nbook.app.exit", "nbook.app.quit"))).toBe(first);
        expect(registry.registerAlias("nbook.app.exit", "nbook.app.reload").ok).toBe(false);
        expect(registry.registerAlias("nbook.app.quit", "nbook.app.reload").ok).toBe(false);
        expect(registry.register(command("nbook.app.exit", {run: () => ({ok: true, value: "newcomer"})})).ok).toBe(false);
        expect(registry.registerAlias("nbook.app.exit", "nbook.app.missing").ok).toBe(false);
        expect(registry.registerAlias("file quit", "nbook.app.quit").ok).toBe(false);
        expect(registry.registerAlias("file", "nbook.app.quit").ok).toBe(false);
        // 被拒绝的登记不改变别名原本解析到的命令。
        expect(await registry.execute("nbook.app.exit")).toEqual({ok: true, value: "quit"});
        expect(registry.list().map((metadata) => metadata.id)).toEqual(["nbook.app.quit", "nbook.app.reload"]);
    });

    it("目标释放时一并清除别名；旧的别名释放函数不影响后来的登记", async () => {
        const {registry} = harness();
        const releaseTarget = value(registry.register(command("nbook.app.quit", {run: () => ({ok: true, value: "first"})})));
        const staleAlias = value(registry.registerAlias("file.quit", "nbook.app.quit"));
        releaseTarget();
        expect(await registry.execute("file.quit")).toMatchObject({ok: false, code: "unknown-command"});

        value(registry.register(command("nbook.app.quit", {run: () => ({ok: true, value: "second"})})));
        value(registry.registerAlias("file.quit", "nbook.app.quit"));
        staleAlias();
        expect(await registry.execute("file.quit")).toEqual({ok: true, value: "second"});
    });
});

describe("参数严格校验与执行错误", () => {
    it("缺必填、额外字段、null、非对象都是 invalid-args，处理函数不运行", async () => {
        const {registry} = harness();
        const target = recorder();
        value(registry.register(command("nbook.edit.replace", {effect: "write", args: TEXT_ARGS, run: target.run})));

        for (const args of [{}, {text: "x", extra: true}, null, 42, "text", []]) {
            expect(await registry.execute("nbook.edit.replace", args)).toMatchObject({ok: false, code: "invalid-args"});
        }
        expect(target.calls).toEqual([]);
        expect(await registry.execute("nbook.edit.replace", {text: "ok"})).toEqual({ok: true, value: null});
        expect(target.calls).toEqual([{text: "ok"}]);
    });

    it("省略参数归一为 {}，显式 null 不归一", async () => {
        const {registry} = harness();
        value(registry.register(command("nbook.editor.focus", {run: (args) => ({ok: true, value: args})})));
        expect(await registry.execute("nbook.editor.focus")).toEqual({ok: true, value: {}});
        expect(await registry.execute("nbook.editor.focus", null)).toMatchObject({ok: false, code: "invalid-args"});
    });

    it("处理函数同步抛出、异步失败、没返回结构化结果都是 execution-error，且各有一条审计", async () => {
        const {registry, events} = harness();
        value(registry.register(command("nbook.editor.focus", {run: () => {
            throw new Error("同步失败");
        }})));
        value(registry.register(command("nbook.edit.undo", {run: async () => {
            throw new Error("异步失败");
        }})));
        value(registry.register(command("nbook.edit.redo", {run: () => "done" as unknown as CommandResult<unknown>})));

        expect(await registry.execute("nbook.editor.focus")).toEqual({ok: false, code: "execution-error", reason: "同步失败"});
        expect(await registry.execute("nbook.edit.undo")).toEqual({ok: false, code: "execution-error", reason: "异步失败"});
        const unstructured = await registry.execute("nbook.edit.redo");
        expect(unstructured.ok ? "" : unstructured.code).toBe("execution-error");
        expect(unstructured.ok ? "" : unstructured.reason).toContain("nbook.edit.redo");
        expect(events.map((event) => event.result.ok)).toEqual([false, false, false]);
    });

    it("成功但没给值归一为 null；处理函数给出的失败码不在合同内时改为 execution-error", async () => {
        const {registry} = harness();
        value(registry.register(command("nbook.editor.focus", {run: () => ({ok: true, value: undefined})})));
        value(registry.register(command("nbook.edit.undo", {run: () => ({ok: false, code: "boom", reason: "自定义"}) as unknown as CommandResult<unknown>})));
        value(registry.register(command("nbook.edit.redo", {run: () => ({ok: false, code: "stale-target", reason: "文档已换代"})})));

        expect(await registry.execute("nbook.editor.focus")).toEqual({ok: true, value: null});
        expect(await registry.execute("nbook.edit.undo")).toEqual({ok: false, code: "execution-error", reason: "自定义"});
        expect(await registry.execute("nbook.edit.redo")).toEqual({ok: false, code: "stale-target", reason: "文档已换代"});
    });

    it("审计监听器抛错不影响执行结果，其它监听器照常收到", async () => {
        const {registry, reported} = harness();
        const seen: CommandExecutionEvent[] = [];
        value(registry.register(command("nbook.editor.focus", {run: () => ({ok: true, value: "ok"})})));
        registry.onDidExecute(() => {
            throw new Error("监听器失败");
        });
        registry.onDidExecute((event) => seen.push(event));

        expect(await registry.execute("nbook.editor.focus")).toEqual({ok: true, value: "ok"});
        expect(seen).toHaveLength(1);
        expect(reported).toEqual(["监听器失败"]);
    });
});

describe("Agent 暴露、只读与确认", () => {
    it("缺省不开放：Agent 调用得到 not-exposed，处理函数不运行", async () => {
        const {registry, events} = harness();
        const target = recorder();
        value(registry.register(command("nbook.edit.undo", {effect: "write", run: target.run})));

        expect(await registry.execute("nbook.edit.undo", {}, agent)).toMatchObject({ok: false, code: "not-exposed"});
        expect(target.calls).toEqual([]);
        expect(events[0]).toMatchObject({invocation: {source: "agent", callerId: "lab"}});
    });

    it("confirm：拒绝时不运行；批准后只运行一次", async () => {
        const denying = harness({confirm: async () => false});
        const target = recorder();
        value(denying.registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "confirm"}, run: target.run})));
        expect(await denying.registry.execute("nbook.edit.undo", {}, agent)).toMatchObject({ok: false, code: "denied"});
        expect(target.calls).toEqual([]);

        const approving = harness({confirm: async () => true});
        value(approving.registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "confirm"}, run: target.run})));
        expect(await approving.registry.execute("nbook.edit.undo", {}, agent)).toEqual({ok: true, value: null});
        expect(target.calls).toHaveLength(1);
    });

    it("没有确认通道得到 confirmation-required；确认通道抛错得到 execution-error", async () => {
        const {registry} = harness();
        value(registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "confirm"}})));
        expect(await registry.execute("nbook.edit.undo", {}, agent)).toMatchObject({ok: false, code: "confirmation-required"});

        const broken = harness({confirm: async () => {
            throw new Error("确认通道失败");
        }});
        value(broken.registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "confirm"}})));
        expect(await broken.registry.execute("nbook.edit.undo", {}, agent)).toEqual({ok: false, code: "execution-error", reason: "确认通道失败"});
    });

    it("destructive 的 auto 实际按 confirm 处理；never 不因标注被提升", async () => {
        const requests: CommandConfirmationRequest[] = [];
        const {registry} = harness({confirm: async (request) => {
            requests.push(request);
            return true;
        }});
        value(registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "auto", hints: {destructive: true}}})));
        value(registry.register(command("nbook.edit.redo", {effect: "write", expose: {agent: "never", hints: {destructive: true}}})));

        expect(await registry.execute("nbook.edit.undo", {}, agent)).toEqual({ok: true, value: null});
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({callerId: "lab", command: {id: "nbook.edit.undo"}});
        expect(await registry.execute("nbook.edit.redo", {}, agent)).toMatchObject({ok: false, code: "not-exposed"});
        expect(requests).toHaveLength(1);
    });

    it("discuss 与 plan 拒绝 Agent 的写入与 destructive 调用，用户调用不受影响", async () => {
        const {registry, setMode} = harness({confirm: async () => true});
        const target = recorder();
        value(registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "auto"}, run: target.run})));
        value(registry.register(command("nbook.edit.redo", {effect: "read", expose: {agent: "auto", hints: {destructive: true}}, run: target.run})));

        for (const mode of ["discuss", "plan"] as const) {
            setMode(mode);
            expect(await registry.execute("nbook.edit.undo", {}, agent)).toMatchObject({ok: false, code: "read-only"});
            expect(await registry.execute("nbook.edit.redo", {}, agent)).toMatchObject({ok: false, code: "read-only"});
            expect(await registry.execute("nbook.edit.undo")).toEqual({ok: true, value: null});
        }
        expect(target.calls).toHaveLength(2);
    });

    it("等待确认期间命令被替换：批准后得到 stale-target，新旧处理函数都不运行", async () => {
        let approve: (approved: boolean) => void = () => undefined;
        const {registry} = harness({confirm: () => new Promise<boolean>((resolve) => {
            approve = resolve;
        })});
        const oldTarget = recorder({ok: true, value: "old"});
        const newTarget = recorder({ok: true, value: "new"});
        const release = value(registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "confirm"}, run: oldTarget.run})));

        const pending = registry.execute("nbook.edit.undo", {}, agent);
        release();
        value(registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "confirm"}, run: newTarget.run})));
        approve(true);

        expect(await pending).toMatchObject({ok: false, code: "stale-target"});
        expect(oldTarget.calls).toEqual([]);
        expect(newTarget.calls).toEqual([]);
    });

    it("等待确认期间切到 plan：批准后也不运行", async () => {
        let approve: (approved: boolean) => void = () => undefined;
        const {registry, setMode} = harness({confirm: () => new Promise<boolean>((resolve) => {
            approve = resolve;
        })});
        const target = recorder();
        value(registry.register(command("nbook.edit.undo", {effect: "write", expose: {agent: "confirm"}, run: target.run})));

        const pending = registry.execute("nbook.edit.undo", {}, agent);
        setMode("plan");
        approve(true);

        expect(await pending).toMatchObject({ok: false, code: "read-only"});
        expect(target.calls).toEqual([]);
    });

    it("等待期间调用方与确认界面各自改参数：处理函数拿到的仍是确认时的内容", async () => {
        let approve: (approved: boolean) => void = () => undefined;
        const {registry} = harness({confirm: (request) => {
            (request.args as {text: string}).text = "确认界面改的";
            return new Promise<boolean>((resolve) => {
                approve = resolve;
            });
        }});
        const target = recorder();
        value(registry.register(command("nbook.edit.replace", {effect: "write", args: TEXT_ARGS, expose: {agent: "confirm"}, run: target.run})));

        const args = {text: "原文"};
        const pending = registry.execute("nbook.edit.replace", args, agent);
        args.text = "调用方改的";
        approve(true);

        expect(await pending).toEqual({ok: true, value: null});
        expect(target.calls).toEqual([{text: "原文"}]);
    });
});

describe("审计与变更通知", () => {
    it("释放监听器后不再收到事件；登记与释放各通知一次变更", async () => {
        const {registry} = harness();
        const seen: CommandExecutionEvent[] = [];
        let changes = 0;
        const releaseChange = registry.onDidChange(() => {
            changes += 1;
        });
        const release = value(registry.register(command("nbook.editor.focus")));
        const releaseAudit = registry.onDidExecute((event) => seen.push(event));
        releaseAudit();
        releaseAudit();

        await registry.execute("nbook.editor.focus");
        expect(seen).toEqual([]);
        release();
        releaseChange();
        value(registry.register(command("nbook.editor.focus")));
        expect(changes).toBe(2);
    });
});
