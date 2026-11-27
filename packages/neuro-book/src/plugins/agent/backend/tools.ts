/**
 * `agent.tools` 的接收者与会话的工具集（docs/specs/agent/contributions.md 输出 4–6）。
 *
 * 声明从已接受的清单声明读，提供方没激活也交给模型；实现要等提供方激活。内核按工具 id 缓存实现、声明不变就不释放，
 * 所以内核拿到的是这里的包装（每个会话每个工具一个）：包装第一次执行时激活提供方、建真正的实现，提供方撤回时作废这一代。
 * 撤回与释放是两件事：交给平台的撤回最迟 5 秒完成，真正的实现等它底层的执行都结束才释放。
 */

import type {ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {ToolContext, ToolDeclaration, ToolEffect, ToolImplementation, ToolResult, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";

import {providerToolName} from "@notnotype/nb-harness/kernel/contracts";
import type {Text} from "@notnotype/nb-ui/text";

import type {ToolCatalogEntry} from "../shared/contracts";
import type {EvalMethod} from "./eval/objects";
import type {CodeTool} from "./eval/tool";
import {profileToolIds} from "../shared/profile-tools";
import type {MethodsOf, ToolBinding, ToolRequirements} from "../shared/profile-tools";
import {onAgentTool, TOOLS_POINT} from "../shared/points";
import type {AgentToolDeclaration, AgentToolImplementation, ToolSubject} from "../shared/points";
import type {AgentToolServices} from "../shared/resources";
import type {ToolJobScope} from "./jobs/tool-jobs";

/** 撤回时等执行中的调用结算的上限（提案 P11 停止的第一步）。 */
export const REVOKE_GRACE_MS = 5_000;

type Handle = ContributionHandle<AgentToolDeclaration, AgentToolImplementation>;

export interface AgentToolsOptions {
    readonly declarations: ContributionDeclarations;
    readonly clock: RuntimeClock;
    /** 激活声明了 `onAgentTool:<id>` 的入口；有入口激活失败或受阻时交回 false。 */
    readonly activate: (event: string) => Promise<boolean>;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
    /**
     * 全局对象的方法（声明带 `global`）要它的对象有效、且是同一插件登记的（contributions.md 输出 24）；不然不进工具表。
     * 缺省都有效（没有全局对象的测试场地）。
     */
    readonly evalObjectOf?: (object: string) => {readonly plugin: string; readonly summary: string; readonly description?: Text} | undefined;
    /** 交给工具工厂的会话服务（资源视图与全文保存），按内核给的会话上下文构造。 */
    /** `toolId` 是要构造的工具，资源视图拿它作 `call(ctx)` 的分组缺省标题。 */
    /** `scope`：这一代工具实现的登记范围（贡献它的插件、正在执行的调用、撤回），工具登记任务用。 */
    readonly services: (context: ToolSessionContext, toolId: string, scope: ToolJobScope) => AgentToolServices;
    /** 工具的发布与撤回：工具目录的界面要重取。 */
    readonly catalogChanged: () => void;
}

const unavailable = (id: string): ToolResult => ({text: `Tool ${id} is not available right now; its plugin is not running.`, status: "error", code: "tool-unavailable"});

export class AgentTools {
    /** 工具 id → 提供方当前发布的这一代。 */
    readonly #published = new Map<string, Handle>();
    /** 工具 id → 用着它的包装（撤回时逐个作废）。 */
    readonly #wrappers = new Map<string, Set<ToolWrapper>>();
    /**
     * 会话关了、工具实现已释放，但这一代登记的任务还在跑：它们的撤回监听留在这里，这一代撤回时照样调（工具登记任务，jobs.md 输出 19）。
     */
    readonly #orphans = new Map<Handle, Set<() => void>>();
    /** 报过 `eval-object-missing` 的工具：每次取工具集都会重算，同一个只报一次。 */
    readonly #missing = new Set<string>();

    constructor(private readonly options: AgentToolsOptions) {}

    readonly receiver: ContributionReceiver<AgentToolDeclaration, AgentToolImplementation> = {
        published: (handle) => {
            this.#published.set(handle.id, handle);
            this.options.catalogChanged();
        },
        revoke: async (handle) => {
            if (this.#published.get(handle.id) !== handle) return;
            this.#published.delete(handle.id);
            this.options.catalogChanged();
            const orphans = this.#orphans.get(handle);
            this.#orphans.delete(handle);
            for (const listener of orphans ?? []) listener();
            await Promise.all([...(this.#wrappers.get(handle.id) ?? [])].map((wrapper) => wrapper.revoke(handle)));
        },
    };

    /** 已接受的全部工具声明，按 id；对象无效的全局对象方法不在里面。 */
    all(): ReadonlyMap<string, ToolDeclaration> {
        const tools = new Map<string, ToolDeclaration>();
        for (const descriptor of this.options.declarations.list<AgentToolDeclaration>(TOOLS_POINT)) {
            const global = descriptor.declaration.global;
            if (global !== undefined && this.options.evalObjectOf !== undefined && this.options.evalObjectOf(global.object)?.plugin !== descriptor.plugin) {
                if (!this.#missing.has(descriptor.id)) this.options.report("eval-object-missing", `${descriptor.id} is a method of ${global.object}, which ${descriptor.plugin} does not register as a valid eval object; the tool is left out`, {tool: descriptor.id, object: global.object});
                this.#missing.add(descriptor.id);
                continue;
            }
            tools.set(descriptor.id, this.#declaration(descriptor.id, descriptor.plugin, descriptor.declaration));
        }
        return tools;
    }

    /** 工具目录（contributions.md 输出 17）：来自清单声明，不激活提供方。全局对象的方法带上对象（Profile 页合成一行）。 */
    catalog(): readonly ToolCatalogEntry[] {
        return this.options.declarations.list<AgentToolDeclaration>(TOOLS_POINT).map((descriptor) => {
            const object = this.#objectOf(descriptor.plugin, descriptor.declaration);
            return {
                id: descriptor.id,
                description: descriptor.declaration.description,
                providerName: providerToolName({id: descriptor.id, ...(descriptor.declaration.providerName === undefined ? {} : {providerName: descriptor.declaration.providerName})}),
                effect: descriptor.declaration.effect,
                plugin: descriptor.plugin,
                ...(descriptor.declaration.defaultForAll === true ? {defaultForAll: true as const} : {}),
                ...(object === undefined ? {} : {object: {name: object.name, method: descriptor.declaration.global!.method, description: object.description ?? object.summary}}),
            };
        });
    }

    /** 全局对象此刻的方法，按对象名；只算对象有效的（同一插件登记的）。 */
    methodsOf(): MethodsOf {
        const methods = new Map<string, string[]>();
        for (const descriptor of this.options.declarations.list<AgentToolDeclaration>(TOOLS_POINT)) {
            const object = this.#objectOf(descriptor.plugin, descriptor.declaration);
            if (object === undefined) continue;
            const list = methods.get(object.name) ?? [];
            list.push(descriptor.id);
            methods.set(object.name, list);
        }
        return (object) => methods.get(object) ?? [];
    }

    /** 这个方法所属的有效全局对象；不是方法，或对象不是同一插件登记的有效对象时为 undefined。 */
    #objectOf(plugin: string, declaration: AgentToolDeclaration): {readonly name: string; readonly summary: string; readonly description?: Text} | undefined {
        const global = declaration.global;
        if (global === undefined || this.options.evalObjectOf === undefined) return undefined;
        const object = this.options.evalObjectOf(global.object);
        return object?.plugin === plugin ? {...object, name: global.object} : undefined;
    }

    /**
     * 一个会话的工具集（contributions.md 输出 4）：Profile 要的 + 装到所有 Profile 的 + 绑定加的 − 绑定去掉的，必需的去不掉；
     * 不存在的 id 忽略（必需工具缺失由内核判定）。没有人在窗口前的会话（`unattended`，由调用方按会话头与派发链判定）去掉
     * 声明了 `foreground` 的；这样去掉的必需工具同样由内核按 `tools-missing` 收口。内核的工具表、eval 的说明与代码里的全局对象
     * 都取这一份。
     */
    forSession(requirements: ToolRequirements, binding: ToolBinding | undefined, unattended: boolean): ToolDeclaration[] {
        const all = this.all();
        const declared = this.options.declarations.list<AgentToolDeclaration>(TOOLS_POINT);
        const defaultForAll = declared.flatMap((descriptor) => (descriptor.declaration.defaultForAll === true ? [descriptor.id] : []));
        const foreground = new Set(unattended ? declared.flatMap((descriptor) => (descriptor.declaration.foreground === true ? [descriptor.id] : [])) : []);
        return profileToolIds(requirements, defaultForAll, binding, this.methodsOf()).flatMap((id) => {
            const declaration = all.get(id);
            return declaration === undefined || foreground.has(id) ? [] : [declaration];
        });
    }

    /** 内核的 `tools.create`：交回包装，真正的实现到第一次执行时才建。 */
    create(id: string, context: ToolSessionContext): ToolImplementation {
        const wrapper = new ToolWrapper(id, context, this, this.options);
        let set = this.#wrappers.get(id);
        if (set === undefined) this.#wrappers.set(id, (set = new Set()));
        set.add(wrapper);
        return wrapper;
    }

    /** 包装用：激活提供方，交回当前发布的一代；没有就是 null。 */
    async current(id: string): Promise<Handle | null> {
        const known = this.#published.get(id);
        if (known !== undefined) return known;
        const activated = await this.options.activate(onAgentTool(id));
        return activated ? (this.#published.get(id) ?? null) : null;
    }

    /** 判定对象（permissions.md 输出 9）。`activate` 为真时提供方没激活就先激活；取不到交回 null，规则按算不出来处理。 */
    async subjectsOf(id: string, args: Readonly<Record<string, unknown>>, activate: boolean): Promise<readonly ToolSubject[] | null> {
        try {
            const handle = this.#published.get(id) ?? (activate ? await this.current(id) : null);
            if (handle === null) return activate ? null : [];
            return handle.implementation().subjects?.(args) ?? [];
        } catch (error) {
            this.options.report("tool-subjects-failed", `computing the subjects of ${id} threw`, {tool: id, message: error instanceof Error ? error.message : String(error)});
            return null;
        }
    }

    /** 全部有效的全局对象方法，生成 `docs://eval/` 的文档用（resources.md 输出 16）。 */
    evalMethods(): EvalMethod[] {
        const valid = this.all();
        return this.options.declarations.list<AgentToolDeclaration>(TOOLS_POINT).flatMap((descriptor) => {
            const global = descriptor.declaration.global;
            if (global === undefined || !valid.has(descriptor.id)) return [];
            const {description, parameters, returns, errors} = descriptor.declaration;
            return [{object: global.object, method: global.method, description, parameters, ...(returns === undefined ? {} : {returns}), ...(errors === undefined ? {} : {errors})}];
        });
    }

    /** 会话工具集在代码里的样子（eval.md 输出 6 到 8）：名字是交给服务商的名字；`returns` 与 `errors` 只在 `agent.tools` 的声明里，内核的声明没有。 */
    codeToolsOf(declarations: readonly ToolDeclaration[]): CodeTool[] {
        const declared = new Map(this.options.declarations.list<AgentToolDeclaration>(TOOLS_POINT).map((descriptor) => [descriptor.id, descriptor.declaration] as const));
        return declarations.map((declaration) => {
            const {returns, errors} = declared.get(declaration.id) ?? {};
            return {
                id: declaration.id,
                name: providerToolName(declaration),
                ...(returns === undefined ? {} : {returns}),
                ...(errors === undefined ? {} : {errors}),
                ...(declaration.global === undefined ? {} : {global: declaration.global}),
            };
        });
    }

    forget(id: string, wrapper: ToolWrapper): void {
        this.#wrappers.get(id)?.delete(wrapper);
    }

    /** 释放了的工具实现留下的撤回监听：这一代撤回时调。 */
    adopt(handle: Handle, listeners: ReadonlySet<() => void>): void {
        if (listeners.size === 0) return;
        let set = this.#orphans.get(handle);
        if (set === undefined) this.#orphans.set(handle, (set = new Set()));
        for (const listener of listeners) set.add(listener);
    }

    #declaration(id: string, plugin: string, declaration: AgentToolDeclaration): ToolDeclaration {
        const fixed = declaration.effect;
        // 按参数求等级：提供方已激活、实现给了 `effect` 时用它；否则用声明里的（作者写最保守的）。
        const effect = (args: Readonly<Record<string, unknown>>): ToolEffect => {
            const handle = this.#published.get(id);
            if (handle === undefined) return fixed;
            try {
                return handle.implementation().effect?.(args) ?? fixed;
            } catch (error) {
                this.options.report("tool-effect-failed", `computing the effect of ${id} threw; using the declared one`, {tool: id, message: error instanceof Error ? error.message : String(error)});
                return fixed;
            }
        };
        return {
            id,
            ...(declaration.providerName === undefined ? {} : {providerName: declaration.providerName}),
            description: declaration.description,
            parameters: declaration.parameters as ToolDeclaration["parameters"],
            provider: plugin,
            version: declaration.version,
            finish: declaration.finish ?? false,
            concurrency: declaration.concurrency ?? "exclusive",
            strict: declaration.strict ?? false,
            ...(declaration.customFormat === undefined ? {} : {customFormat: declaration.customFormat}),
            effect,
            // 代码调用的三个字段原样交给内核（harness/runtime.md 输出 90 到 93）；`returns` 与 `errors` 只有 eval 用，不进内核。
            ...(declaration.invokes === true ? {invokes: true as const} : {}),
            ...(declaration.codeCallable === false ? {codeCallable: false as const} : {}),
            ...(declaration.global === undefined ? {} : {global: declaration.global}),
        };
    }
}

/** 一代真正的实现与在它上面执行中的调用。 */
interface Built {
    readonly handle: Handle;
    readonly implementation: Promise<ToolImplementation>;
    /** 在这一代上进行中的调用：从等工厂建好开始算，到底层的执行结束。 */
    readonly calls: Set<Promise<unknown>>;
    /** 这一代被撤回了：之后不再开始执行，进行中的调用最多再等 5 秒。 */
    revoked: boolean;
    /** 进行中的调用各一个：撤回时开始它的 5 秒计时。调用结束时移除。 */
    readonly onRevoke: Set<() => void>;
    /** 正在执行的调用的 `invocation`：工具登记任务只认它们（jobs.md）。 */
    readonly live: Set<string>;
    /** 撤回时调一次的：这一代登记的任务按中断收口。 */
    readonly retired: Set<() => void>;
}

class ToolWrapper implements ToolImplementation {
    #built: Built | null = null;
    #disposed = false;

    constructor(
        private readonly id: string,
        private readonly context: ToolSessionContext,
        private readonly registry: AgentTools,
        private readonly options: AgentToolsOptions,
    ) {}

    async execute(args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<ToolResult | string> {
        if (this.#disposed) return unavailable(this.id);
        const built = await this.#ensure();
        if (built === null) return unavailable(this.id);
        // 一次调用整个算进这一代的进行中：等工厂建好、复核、执行。工厂挂住时撤回的 5 秒上限照样生效。
        const work = this.#run(built, args, context);
        built.calls.add(work);
        let onRevoke: (() => void) | null = null;
        const cut = new Promise<ToolResult>((resolve) => {
            onRevoke = () => {
                const cancel = this.options.clock.schedule(() => resolve(unavailable(this.id)), REVOKE_GRACE_MS);
                void work.then(cancel, cancel);
            };
            built.onRevoke.add(onRevoke);
            if (built.revoked) onRevoke();
        });
        void work.then(() => undefined, () => undefined).finally(() => {
            built.calls.delete(work);
            if (onRevoke !== null) built.onRevoke.delete(onRevoke);
        });
        return Promise.race([work, cut]);
    }

    async #run(built: Built, args: Readonly<Record<string, unknown>>, context: ToolContext): Promise<ToolResult | string> {
        let implementation: ToolImplementation;
        try {
            implementation = await built.implementation;
        } catch (error) {
            this.options.report("tool-create-failed", `creating tool ${this.id} threw`, {tool: this.id, message: error instanceof Error ? error.message : String(error)});
            if (this.#built === built) this.#built = null;
            return unavailable(this.id);
        }
        // 等工厂的这段时间里运行可能已中止、这一代可能已撤回、会话可能已关闭：这时不再开始执行，免得中止之后才有副作用。
        if (context.signal.aborted || built.revoked || this.#disposed) return unavailable(this.id);
        // 执行期间这次调用可以登记任务；结算之后不行（jobs.md 的工具登记任务）。
        built.live.add(context.invocation);
        try {
            return await implementation.execute(args, context);
        } finally {
            built.live.delete(context.invocation);
        }
    }

    /** 提供方的这一代撤回：作废它，交回的 Promise 在进行中的调用都结算或 5 秒到时完成。 */
    async revoke(handle: Handle): Promise<void> {
        const built = this.#built;
        if (built === null || built.handle !== handle) return;
        this.#built = null;
        built.revoked = true;
        for (const listener of [...built.onRevoke]) listener();
        for (const listener of [...built.retired]) listener();
        await this.#retire(built);
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        this.registry.forget(this.id, this);
        const built = this.#built;
        this.#built = null;
        // 会话关了不停插件登记的任务：撤回监听交给登记表，插件这一代撤回时照样停下它们。
        if (built !== null && !built.revoked) this.registry.adopt(built.handle, built.retired);
        if (built !== null) await this.#retire(built);
    }

    async #ensure(): Promise<Built | null> {
        const handle = await this.registry.current(this.id);
        if (handle === null || this.#disposed) return null;
        if (this.#built?.handle === handle) return this.#built;
        const live = new Set<string>();
        const retired = new Set<() => void>();
        let built!: Built;
        const scope: ToolJobScope = {plugin: handle.plugin, sessionId: this.context.sessionId, live, revoked: () => built.revoked, onRevoke: (listener) => void retired.add(listener)};
        let implementation: Promise<ToolImplementation>;
        try {
            implementation = Promise.resolve(handle.implementation().create(this.context, this.options.services(this.context, this.id, scope)));
        } catch (error) {
            // 句柄在这之间被撤回，或工厂同步抛错。
            implementation = Promise.reject(error);
        }
        implementation.catch(() => undefined);
        built = {handle, implementation, calls: new Set(), revoked: false, onRevoke: new Set(), live, retired};
        this.#built = built;
        return this.#built;
    }

    /**
     * 等这一代进行中的调用结算（最多 5 秒）再释放；5 秒时还没结算的写 `tool-abandoned`，释放推迟到它们与工厂都真结束
     * （没有强制终止，contributions.md 输出 6）。交回的 Promise 不等推迟的释放，也不等挂住的工厂。
     */
    async #retire(built: Built): Promise<void> {
        const release = async () => {
            try {
                await (await built.implementation).dispose?.();
            } catch (error) {
                this.options.report("tool-dispose-failed", `disposing tool ${this.id} threw`, {tool: this.id, message: error instanceof Error ? error.message : String(error)});
            }
        };
        const settled = Promise.allSettled([...built.calls, built.implementation]);
        let timedOut = false;
        await new Promise<void>((resolve) => {
            const cancel = this.options.clock.schedule(() => {
                timedOut = true;
                resolve();
            }, REVOKE_GRACE_MS);
            void settled.then(() => {
                cancel();
                resolve();
            });
        });
        if (!timedOut) return release();
        this.options.report("tool-abandoned", `tool ${this.id} did not finish ${REVOKE_GRACE_MS} ms after its plugin stopped; its implementation is released once it does`, {tool: this.id});
        void settled.then(release);
    }
}
