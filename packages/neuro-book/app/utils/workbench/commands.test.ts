import {Type, type TSchema} from "typebox";
import {describe, expect, it, vi} from "vitest";
import {
    createCommandRegistry,
    type CommandConfirmationRequest,
    type CommandDescriptor,
    type CommandExecutionEvent,
    type CommandExposure,
    type CommandRegistry,
    type CommandRegistryOptions,
    type CommandResult,
} from "nbook/app/utils/workbench/commands";
import type {ContextValues, WhenPredicate} from "nbook/app/utils/workbench/context-keys";

function value<T>(result: CommandResult<T>): T {
    if (!result.ok) {
        throw new Error(`${result.code}：${result.reason}`);
    }
    return result.value;
}

function harness(options: {development?: boolean; confirm?: CommandRegistryOptions["confirm"]} = {}) {
    let context: ContextValues = {};
    let mode: "normal" | "discuss" | "plan" = "normal";
    const reported: Error[] = [];
    const events: CommandExecutionEvent[] = [];
    const registry = createCommandRegistry({
        context: () => context,
        agentMode: () => mode,
        development: options.development ?? false,
        report: (error) => reported.push(error),
        confirm: options.confirm,
    });
    registry.onDidExecuteCommand((event) => events.push(event));
    return {
        registry,
        reported,
        events,
        setContext: (values: ContextValues) => {
            context = values;
        },
        setMode: (next: "normal" | "discuss" | "plan") => {
            mode = next;
        },
    };
}

function makeCommand(overrides: {
    id: string;
    effect?: "read" | "write";
    when?: WhenPredicate;
    argsSchema?: TSchema;
    expose?: CommandExposure;
    titleKey?: string;
    description?: string;
    run?: (args: unknown) => CommandResult<unknown> | Promise<CommandResult<unknown>>;
}): CommandDescriptor<TSchema, unknown> {
    return {
        id: overrides.id,
        titleKey: overrides.titleKey ?? "workbenchCommands.test",
        description: overrides.description ?? "test command",
        argsSchema: overrides.argsSchema ?? Type.Object({}, {additionalProperties: false}),
        effect: overrides.effect ?? "read",
        when: overrides.when,
        expose: overrides.expose,
        run: overrides.run ?? (() => ({ok: true, value: null})),
    };
}

const TEXT_ARGS = Type.Object({text: Type.String()}, {additionalProperties: false});

describe("注册、释放与冲突", () => {
    it("注册→执行→释放：释放后同 id 不再是命令", async () => {
        const {registry, events} = harness();
        const release = value(registry.registerCommand(makeCommand({
            id: "nbook.edit.undo",
            effect: "write",
            run: () => ({ok: true, value: "ran"}),
        })));

        expect(value(registry.getCommand("nbook.edit.undo")).effect).toBe("write");
        expect(registry.getAllCommands().map((command) => command.id)).toEqual(["nbook.edit.undo"]);
        await expect(registry.executeCommand("nbook.edit.undo")).resolves.toEqual({ok: true, value: "ran"});
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            requestedId: "nbook.edit.undo",
            id: "nbook.edit.undo",
            args: {},
            invocation: {source: "user"},
        });
        expect(typeof events[0]!.durationMs).toBe("number");

        release();
        const executedAfterRelease = await registry.executeCommand("nbook.edit.undo");
        expect(executedAfterRelease.ok).toBe(false);
        expect(executedAfterRelease.ok ? "" : executedAfterRelease.code).toBe("unknown-command");
        expect(registry.getAllCommands()).toEqual([]);
    });

    it("同一 descriptor 对象重复注册幂等：同一释放闭包、只登记一次", () => {
        const {registry} = harness();
        const descriptor = makeCommand({id: "nbook.edit.undo"});
        const first = value(registry.registerCommand(descriptor));
        const second = value(registry.registerCommand(descriptor));

        expect(second).toBe(first);
        expect(registry.getAllCommands()).toHaveLength(1);
    });

    it("不同对象同 id 冲突：生产期保留首个并只报告一次", async () => {
        const {registry, reported} = harness();
        const first = makeCommand({id: "nbook.edit.undo", description: "first", run: () => ({ok: true, value: "first"})});
        const second = makeCommand({id: "nbook.edit.undo", description: "second", run: () => ({ok: true, value: "second"})});
        value(registry.registerCommand(first));

        const conflict = registry.registerCommand(second);
        registry.registerCommand(second);

        expect(conflict).toEqual({ok: false, code: "invalid-args", reason: "Command 'nbook.edit.undo' is already registered"});
        expect(reported).toHaveLength(1);
        expect(value(registry.getCommand("nbook.edit.undo")).description).toBe("first");
        await expect(registry.executeCommand("nbook.edit.undo")).resolves.toEqual({ok: true, value: "first"});
    });

    it("开发期重复注册抛错并指名冲突 id", () => {
        const {registry} = harness({development: true});
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo"})));

        expect(() => registry.registerCommand(makeCommand({id: "nbook.edit.undo"}))).toThrowError("Command 'nbook.edit.undo' is already registered");
    });

    it("旧释放闭包不能删除重新注册的同 id 条目", async () => {
        const {registry} = harness();
        const descriptor = makeCommand({id: "nbook.edit.undo", run: () => ({ok: true, value: "first"})});
        const oldRelease = value(registry.registerCommand(descriptor));
        oldRelease();

        const newRelease = value(registry.registerCommand(makeCommand({
            id: "nbook.edit.undo",
            run: () => ({ok: true, value: "second"}),
        })));
        oldRelease();

        await expect(registry.executeCommand("nbook.edit.undo")).resolves.toEqual({ok: true, value: "second"});
        newRelease();
        expect(registry.getAllCommands()).toEqual([]);
    });

    it("非法描述符在开发期报告并抛、生产期返回 invalid-args 且不登记", () => {
        const broken = [
            makeCommand({id: "nbook.edit", description: "两段 id"}),
            makeCommand({id: "nbook.local.undo"}),
            makeCommand({id: "nbook.edit.undo", description: ""}),
            makeCommand({id: "nbook.edit.undo", argsSchema: Type.Object({text: Type.String()})}),
            makeCommand({id: "nbook.edit.undo", argsSchema: Type.Array(Type.String())}),
            makeCommand({id: "nbook.edit.undo", effect: "write", expose: {hints: {readOnly: true}}}),
            makeCommand({id: "nbook.edit.undo", when: {requires: ["offline"]} as unknown as WhenPredicate}),
        ];

        for (const descriptor of broken) {
            const production = harness();
            const result = production.registry.registerCommand(descriptor);
            expect(result.ok).toBe(false);
            expect(result.ok ? "" : result.code).toBe("invalid-args");
            expect(production.registry.getAllCommands()).toEqual([]);

            const development = harness({development: true});
            expect(() => development.registry.registerCommand(descriptor)).toThrowError();
            expect(development.reported).toHaveLength(1);
        }
    });

    it("非 builtin source 的注册被拒绝并保留首个条目", () => {
        const {registry, reported} = harness();
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo"})));
        const rejected = registry.registerCommand({
            ...makeCommand({id: "nbook.edit.redo"}),
            source: "plugin",
        } as unknown as CommandDescriptor<TSchema, unknown>);

        expect(rejected.ok).toBe(false);
        expect(registry.getAllCommands().map((command) => command.id)).toEqual(["nbook.edit.undo"]);
        expect(reported).toHaveLength(1);
    });
});

describe("when 与可用性", () => {
    it("未登记 when 键拒绝注册；已登记但缺值不放行且原因可读", async () => {
        const {registry} = harness();
        const known = makeCommand({id: "nbook.edit.undo", when: {requires: ["editor-active", "editor-writable"]}});
        value(registry.registerCommand(known));

        const enabled = registry.isCommandEnabled("nbook.edit.undo");
        expect(enabled.ok).toBe(false);
        expect(enabled.ok ? "" : enabled.code).toBe("unavailable");

        const executed = await registry.executeCommand("nbook.edit.undo");
        expect(executed.ok).toBe(false);
        expect(executed.ok ? "" : executed.code).toBe("unavailable");
    });

    it("满足时返回 ok=true（不用 ok=true/value=false 表达不可用）", () => {
        const {registry, setContext} = harness();
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo", when: {requires: ["editor-active"]}})));

        expect(registry.isCommandEnabled("nbook.edit.undo")).toEqual({ok: false, code: "unavailable", reason: "需要活动编辑器"});
        setContext({"editor-active": true});
        expect(registry.isCommandEnabled("nbook.edit.undo")).toEqual({ok: true, value: true});
    });

    it("未登记 id 与未知别名返回 unknown-command", async () => {
        const {registry} = harness();
        expect(registry.getCommand("nbook.ghost.run").ok).toBe(false);
        expect(registry.getCommand("file.quit").ok).toBe(false);
        expect(registry.isCommandEnabled("nbook.ghost.run").ok).toBe(false);
        const executed = await registry.executeCommand("nbook.ghost.run");
        expect(executed.ok ? "" : executed.code).toBe("unknown-command");
    });
});

describe("别名", () => {
    it("别名只解析到 canonical：canonical 枚举与审计 id 都不含别名", async () => {
        const calls: unknown[] = [];
        const {registry, events} = harness();
        const release = value(registry.registerCommand(makeCommand({
            id: "nbook.app.quit",
            run: (args) => {
                calls.push(args);
                return {ok: true, value: "quit"};
            },
        })));
        value(registry.registerCommandAlias("file.quit", "nbook.app.quit"));

        await expect(registry.executeCommand("file.quit")).resolves.toEqual({ok: true, value: "quit"});

        expect(calls).toHaveLength(1);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({requestedId: "file.quit", id: "nbook.app.quit"});
        expect(registry.getAllCommands().map((command) => command.id)).toEqual(["nbook.app.quit"]);
        expect(value(registry.getCommand("file.quit")).id).toBe("nbook.app.quit");
        expect(value(registry.isCommandEnabled("file.quit"))).toBe(true);
        release();
    });

    it("相同 alias→同目标重复登记幂等；改名或覆盖命令被拒绝", () => {
        const {registry} = harness();
        value(registry.registerCommand(makeCommand({id: "nbook.app.quit"})));
        value(registry.registerCommand(makeCommand({id: "nbook.app.reload"})));

        const first = value(registry.registerCommandAlias("file.quit", "nbook.app.quit"));
        expect(value(registry.registerCommandAlias("file.quit", "nbook.app.quit"))).toBe(first);
        expect(registry.registerCommandAlias("file.quit", "nbook.app.reload").ok).toBe(false);
        expect(registry.registerCommandAlias("nbook.app.quit", "nbook.app.reload").ok).toBe(false);
        expect(registry.registerCommandAlias("file.quit", "nbook.app.missing").ok).toBe(false);
        expect(registry.registerCommandAlias("file quit", "nbook.app.quit").ok).toBe(false);
        expect(registry.registerCommandAlias("file", "nbook.app.quit").ok).toBe(false);
    });

    it("目标卸载级联清除别名，旧别名释放闭包不影响后来指向新目标的登记", async () => {
        const {registry} = harness();
        const firstRelease = value(registry.registerCommand(makeCommand({id: "nbook.app.quit", run: () => ({ok: true, value: "first"})})));
        const staleAliasRelease = value(registry.registerCommandAlias("file.quit", "nbook.app.quit"));
        firstRelease();

        const missing = await registry.executeCommand("file.quit");
        expect(missing.ok ? "" : missing.code).toBe("unknown-command");

        value(registry.registerCommand(makeCommand({id: "nbook.app.quit", run: () => ({ok: true, value: "second"})})));
        value(registry.registerCommandAlias("file.quit", "nbook.app.quit"));
        staleAliasRelease();

        await expect(registry.executeCommand("file.quit")).resolves.toEqual({ok: true, value: "second"});
    });
});

describe("参数严格校验与执行错误", () => {
    it("缺必填 / 额外字段 / null / 非对象都返回 invalid-args 且处理器不运行", async () => {
        const run = vi.fn(() => ({ok: true, value: null}) as CommandResult<unknown>);
        const {registry} = harness();
        value(registry.registerCommand(makeCommand({id: "nbook.edit.replace", effect: "write", argsSchema: TEXT_ARGS, run})));

        for (const args of [{}, {text: "x", extra: true}, null, 42, "text", []]) {
            const result = await registry.executeCommand("nbook.edit.replace", args);
            expect(result.ok).toBe(false);
            expect(result.ok ? "" : result.code).toBe("invalid-args");
        }
        expect(run).not.toHaveBeenCalled();

        await expect(registry.executeCommand("nbook.edit.replace", {text: "ok"})).resolves.toEqual({ok: true, value: null});
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("省略 args 归一为 {}，null 不归一", async () => {
        const run = vi.fn((args: unknown) => ({ok: true, value: args}) as CommandResult<unknown>);
        const {registry} = harness();
        value(registry.registerCommand(makeCommand({id: "nbook.editor.focus", run})));

        await expect(registry.executeCommand("nbook.editor.focus")).resolves.toEqual({ok: true, value: {}});
        await expect(registry.executeCommand("nbook.editor.focus", null)).resolves.toMatchObject({ok: false, code: "invalid-args"});
    });

    it("处理器 throw 与 reject 都返回 execution-error，且仍各发一条审计", async () => {
        const {registry, events} = harness();
        value(registry.registerCommand(makeCommand({id: "nbook.editor.focus", run: () => {
            throw new Error("同步炸");
        }})));
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo", run: async () => {
            throw new Error("异步炸");
        }})));

        await expect(registry.executeCommand("nbook.editor.focus")).resolves.toEqual({ok: false, code: "execution-error", reason: "同步炸"});
        await expect(registry.executeCommand("nbook.edit.undo")).resolves.toEqual({ok: false, code: "execution-error", reason: "异步炸"});
        expect(events).toHaveLength(2);
        expect(events.every((event) => event.result.ok === false)).toBe(true);
    });

    it("成功但未给出值归一为 value=null", async () => {
        const {registry} = harness();
        value(registry.registerCommand(makeCommand({
            id: "nbook.editor.focus",
            run: (() => ({ok: true, value: undefined})) as unknown as () => CommandResult<unknown>,
        })));

        await expect(registry.executeCommand("nbook.editor.focus")).resolves.toEqual({ok: true, value: null});
    });

    it("listener 抛错不影响执行结果，其它 listener 仍收到事件", async () => {
        const {registry, reported} = harness();
        const seen: CommandExecutionEvent[] = [];
        value(registry.registerCommand(makeCommand({id: "nbook.editor.focus", run: () => ({ok: true, value: "ok"})})));
        registry.onDidExecuteCommand(() => {
            throw new Error("listener 炸了");
        });
        registry.onDidExecuteCommand((event) => seen.push(event));

        await expect(registry.executeCommand("nbook.editor.focus")).resolves.toEqual({ok: true, value: "ok"});
        expect(seen).toHaveLength(1);
        expect(reported.map((error) => error.message)).toEqual(["listener 炸了"]);
    });
});

describe("agent 暴露、只读与确认", () => {
    const agent = {source: "agent", callerId: "lab"} as const;

    it("默认 never：agent 调用不运行处理器", async () => {
        const run = vi.fn(() => ({ok: true, value: null}) as CommandResult<unknown>);
        const {registry, events} = harness();
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo", effect: "write", run})));

        const result = await registry.executeCommand("nbook.edit.undo", {}, agent);
        expect(result.ok ? "" : result.code).toBe("not-exposed");
        expect(run).not.toHaveBeenCalled();
        expect(events[0]).toMatchObject({invocation: {source: "agent", callerId: "lab"}});
    });

    it("confirm：取消不运行，批准只执行一次", async () => {
        const run = vi.fn(() => ({ok: true, value: null}) as CommandResult<unknown>);
        const {registry} = harness({confirm: async () => false});
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo", effect: "write", expose: {agent: "confirm"}, run})));

        await expect(registry.executeCommand("nbook.edit.undo", {}, agent)).resolves.toMatchObject({ok: false, code: "denied"});
        expect(run).not.toHaveBeenCalled();

        const approving = harness({confirm: async () => true});
        value(approving.registry.registerCommand(makeCommand({id: "nbook.edit.undo", effect: "write", expose: {agent: "confirm"}, run})));
        await expect(approving.registry.executeCommand("nbook.edit.undo", {}, agent)).resolves.toEqual({ok: true, value: null});
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("缺确认通道返回 confirmation-required；确认回调抛错返回 execution-error", async () => {
        const {registry} = harness();
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo", effect: "write", expose: {agent: "confirm"}})));
        await expect(registry.executeCommand("nbook.edit.undo", {}, agent)).resolves.toMatchObject({ok: false, code: "confirmation-required"});

        const broken = harness({confirm: async () => {
            throw new Error("确认通道炸了");
        }});
        value(broken.registry.registerCommand(makeCommand({id: "nbook.edit.undo", effect: "write", expose: {agent: "confirm"}})));
        await expect(broken.registry.executeCommand("nbook.edit.undo", {}, agent)).resolves.toMatchObject({
            ok: false,
            code: "execution-error",
            reason: "确认通道炸了",
        });
    });

    it("destructive+auto 的实际投影是 confirm；never 不因标注提升", async () => {
        const confirmations: CommandConfirmationRequest[] = [];
        const {registry} = harness({confirm: async (request) => {
            confirmations.push(request);
            return true;
        }});
        value(registry.registerCommand(makeCommand({
            id: "nbook.edit.undo",
            effect: "write",
            expose: {agent: "auto", hints: {destructive: true}},
        })));
        value(registry.registerCommand(makeCommand({
            id: "nbook.edit.redo",
            effect: "write",
            expose: {agent: "never", hints: {destructive: true}},
        })));

        await expect(registry.executeCommand("nbook.edit.undo", {}, agent)).resolves.toEqual({ok: true, value: null});
        expect(confirmations).toHaveLength(1);
        expect(confirmations[0]).toMatchObject({callerId: "lab"});

        await expect(registry.executeCommand("nbook.edit.redo", {}, agent)).resolves.toMatchObject({ok: false, code: "not-exposed"});
        expect(confirmations).toHaveLength(1);
    });

    it("discuss/plan 拒绝 agent 的 write 与 destructive 调用，user 不受影响", async () => {
        const run = vi.fn(() => ({ok: true, value: null}) as CommandResult<unknown>);
        const {registry, setMode} = harness({confirm: async () => true});
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo", effect: "write", expose: {agent: "auto"}, run})));
        value(registry.registerCommand(makeCommand({
            id: "nbook.edit.redo",
            effect: "read",
            expose: {agent: "auto", hints: {destructive: true}},
            run,
        })));

        for (const mode of ["discuss", "plan"] as const) {
            setMode(mode);
            await expect(registry.executeCommand("nbook.edit.undo", {}, agent)).resolves.toMatchObject({ok: false, code: "read-only"});
            await expect(registry.executeCommand("nbook.edit.redo", {}, agent)).resolves.toMatchObject({ok: false, code: "read-only"});
            await expect(registry.executeCommand("nbook.edit.undo")).resolves.toEqual({ok: true, value: null});
        }
        expect(run).toHaveBeenCalledTimes(2);
    });

    it("等待确认期间注册对象被替换：批准后返回 stale-target 且不执行旧处理器", async () => {
        const oldRun = vi.fn(() => ({ok: true, value: "old"}) as CommandResult<unknown>);
        const newRun = vi.fn(() => ({ok: true, value: "new"}) as CommandResult<unknown>);
        let approve!: (approved: boolean) => void;
        const {registry} = harness({confirm: () => new Promise<boolean>((resolve) => {
            approve = resolve;
        })});
        const registration = value(registry.registerCommand(makeCommand({
            id: "nbook.edit.undo",
            effect: "write",
            expose: {agent: "confirm"},
            run: oldRun,
        })));

        const pending = registry.executeCommand("nbook.edit.undo", {}, agent);
        registration();
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo", effect: "write", expose: {agent: "confirm"}, run: newRun})));
        approve(true);

        await expect(pending).resolves.toMatchObject({ok: false, code: "stale-target"});
        expect(oldRun).not.toHaveBeenCalled();
        expect(newRun).not.toHaveBeenCalled();
    });

    it("等待确认期间改为 plan：批准后不再执行", async () => {
        const run = vi.fn(() => ({ok: true, value: null}) as CommandResult<unknown>);
        let approve!: (approved: boolean) => void;
        const {registry, setMode} = harness({confirm: () => new Promise<boolean>((resolve) => {
            approve = resolve;
        })});
        value(registry.registerCommand(makeCommand({id: "nbook.edit.undo", effect: "write", expose: {agent: "confirm"}, run})));

        const pending = registry.executeCommand("nbook.edit.undo", {}, agent);
        setMode("plan");
        approve(true);

        await expect(pending).resolves.toMatchObject({ok: false, code: "read-only"});
        expect(run).not.toHaveBeenCalled();
    });

    it("等待期间调用方与确认界面改参数：run 拿到的仍是确认时快照", async () => {
        const received: unknown[] = [];
        let approve!: (approved: boolean) => void;
        const {registry} = harness({confirm: (request) => {
            // 确认界面自己改副本也不能影响已批准的执行内容
            (request.args as {text: string}).text = "confirm-mutated";
            return new Promise<boolean>((resolve) => {
                approve = resolve;
            });
        }});
        value(registry.registerCommand(makeCommand({
            id: "nbook.edit.replace",
            effect: "write",
            argsSchema: TEXT_ARGS,
            expose: {agent: "confirm"},
            run: (args) => {
                received.push(args);
                return {ok: true, value: null};
            },
        })));

        const args = {text: "origin"};
        const pending = registry.executeCommand("nbook.edit.replace", args, agent);
        args.text = "caller-mutated";
        approve(true);

        await expect(pending).resolves.toEqual({ok: true, value: null});
        expect(received).toEqual([{text: "origin"}]);
    });
});

describe("审计通道", () => {
    it("释放执行 listener 后不再收到事件", async () => {
        const {registry} = harness();
        const seen: CommandExecutionEvent[] = [];
        value(registry.registerCommand(makeCommand({id: "nbook.editor.focus"})));
        const release = registry.onDidExecuteCommand((event) => seen.push(event));
        release();
        release();

        await registry.executeCommand("nbook.editor.focus");
        expect(seen).toEqual([]);
    });
});
