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

import {onAgentTool, TOOLS_POINT} from "../shared/points";
import type {AgentToolDeclaration, AgentToolImplementation} from "../shared/points";

/** 撤回时等执行中的调用结算的上限（提案 P11 停止的第一步）。 */
export const REVOKE_GRACE_MS = 5_000;

type Handle = ContributionHandle<AgentToolDeclaration, AgentToolImplementation>;

export interface ToolRequirements {
    readonly required: readonly string[];
    readonly optional: readonly string[];
}

export interface AgentToolsOptions {
    readonly declarations: ContributionDeclarations;
    readonly clock: RuntimeClock;
    /** 激活声明了 `onAgentTool:<id>` 的入口；有入口激活失败或受阻时交回 false。 */
    readonly activate: (event: string) => Promise<boolean>;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

const unavailable = (id: string): ToolResult => ({text: `Tool ${id} is not available right now; its plugin is not running.`, status: "error", code: "tool-unavailable"});

export class AgentTools {
    /** 工具 id → 提供方当前发布的这一代。 */
    readonly #published = new Map<string, Handle>();
    /** 工具 id → 用着它的包装（撤回时逐个作废）。 */
    readonly #wrappers = new Map<string, Set<ToolWrapper>>();

    constructor(private readonly options: AgentToolsOptions) {}

    readonly receiver: ContributionReceiver<AgentToolDeclaration, AgentToolImplementation> = {
        published: (handle) => {
            this.#published.set(handle.id, handle);
        },
        revoke: async (handle) => {
            if (this.#published.get(handle.id) !== handle) return;
            this.#published.delete(handle.id);
            await Promise.all([...(this.#wrappers.get(handle.id) ?? [])].map((wrapper) => wrapper.revoke(handle)));
        },
    };

    /** 已接受的全部工具声明，按 id。 */
    all(): ReadonlyMap<string, ToolDeclaration> {
        const tools = new Map<string, ToolDeclaration>();
        for (const descriptor of this.options.declarations.list<AgentToolDeclaration>(TOOLS_POINT)) {
            tools.set(descriptor.id, this.#declaration(descriptor.id, descriptor.plugin, descriptor.declaration));
        }
        return tools;
    }

    /**
     * 一个会话的工具集（contributions.md 输出 4）：Profile 要的 + 装到所有 Profile 的 + 绑定加的 − 绑定去掉的，必需的去不掉；
     * 不存在的 id 忽略（必需工具缺失由内核判定）。
     */
    forProfile(requirements: ToolRequirements, binding: {readonly added: readonly string[]; readonly removed: readonly string[]} | undefined): ToolDeclaration[] {
        const all = this.all();
        const wanted = new Set([...requirements.required, ...requirements.optional]);
        for (const descriptor of this.options.declarations.list<AgentToolDeclaration>(TOOLS_POINT)) {
            if (descriptor.declaration.defaultForAll === true) wanted.add(descriptor.id);
        }
        for (const id of binding?.added ?? []) wanted.add(id);
        const required = new Set(requirements.required);
        for (const id of binding?.removed ?? []) if (!required.has(id)) wanted.delete(id);
        return [...wanted].flatMap((id) => {
            const declaration = all.get(id);
            return declaration === undefined ? [] : [declaration];
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

    forget(id: string, wrapper: ToolWrapper): void {
        this.#wrappers.get(id)?.delete(wrapper);
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
            effect,
        };
    }
}

/** 一代真正的实现与在它上面执行中的调用。 */
interface Built {
    readonly handle: Handle;
    readonly implementation: Promise<ToolImplementation>;
    readonly calls: Set<Promise<unknown>>;
    /** 这一代被撤回时触发：执行中的调用最多再等 5 秒。 */
    revoked: boolean;
    readonly onRevoke: Set<() => void>;
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
        let implementation: ToolImplementation;
        try {
            implementation = await built.implementation;
        } catch (error) {
            this.options.report("tool-create-failed", `creating tool ${this.id} threw`, {tool: this.id, message: error instanceof Error ? error.message : String(error)});
            if (this.#built === built) this.#built = null;
            return unavailable(this.id);
        }
        // 等实现建好的这段时间里这一代可能已被撤回。
        if (built.revoked) return unavailable(this.id);
        const call = implementation.execute(args, context);
        built.calls.add(call);
        void call.then(() => undefined, () => undefined).finally(() => built.calls.delete(call));
        // 撤回后最多再等 5 秒：到时以 tool-unavailable 结算，提供方之后交回的结果丢掉。
        const cut = new Promise<ToolResult>((resolve) => built.onRevoke.add(() => {
            const cancel = this.options.clock.schedule(() => resolve(unavailable(this.id)), REVOKE_GRACE_MS);
            void call.then(cancel, cancel);
        }));
        return Promise.race([call, cut]);
    }

    /** 提供方的这一代撤回：作废它，交回的 Promise 在执行中的调用都结算或 5 秒到时完成。 */
    async revoke(handle: Handle): Promise<void> {
        const built = this.#built;
        if (built === null || built.handle !== handle) return;
        this.#built = null;
        built.revoked = true;
        for (const listener of built.onRevoke) listener();
        await this.#retire(built);
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        this.registry.forget(this.id, this);
        const built = this.#built;
        this.#built = null;
        if (built !== null) await this.#retire(built);
    }

    async #ensure(): Promise<Built | null> {
        const handle = await this.registry.current(this.id);
        if (handle === null || this.#disposed) return null;
        if (this.#built?.handle === handle) return this.#built;
        let implementation: Promise<ToolImplementation>;
        try {
            implementation = Promise.resolve(handle.implementation().create(this.context));
        } catch (error) {
            // 句柄在这之间被撤回，或工厂同步抛错。
            implementation = Promise.reject(error);
        }
        implementation.catch(() => undefined);
        this.#built = {handle, implementation, calls: new Set(), revoked: false, onRevoke: new Set()};
        return this.#built;
    }

    /**
     * 等这一代执行中的调用结算（最多 5 秒）再释放；5 秒时还没结算的写 `tool-abandoned`，释放推迟到它们真结束
     * （没有强制终止，contributions.md 输出 6）。交回的 Promise 不等推迟的释放。
     */
    async #retire(built: Built): Promise<void> {
        const release = async () => {
            try {
                await (await built.implementation).dispose?.();
            } catch (error) {
                this.options.report("tool-dispose-failed", `disposing tool ${this.id} threw`, {tool: this.id, message: error instanceof Error ? error.message : String(error)});
            }
        };
        if (built.calls.size === 0) return release();
        const all = Promise.allSettled([...built.calls]);
        let timedOut = false;
        await new Promise<void>((resolve) => {
            const cancel = this.options.clock.schedule(() => {
                timedOut = true;
                resolve();
            }, REVOKE_GRACE_MS);
            void all.then(() => {
                cancel();
                resolve();
            });
        });
        if (!timedOut) return release();
        this.options.report("tool-abandoned", `tool ${this.id} did not finish ${REVOKE_GRACE_MS} ms after its plugin stopped; its implementation is released once it does`, {tool: this.id});
        void all.then(release);
    }
}
