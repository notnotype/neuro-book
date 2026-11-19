/**
 * bot 的主对话（docs/specs/bots/main-conversation.md）：读会话头、建、持有，持有状态与长会话的指标。
 *
 * 同一个 bot 的 `ensure` 排成一条 Promise 链：并发的调用依次跑，后到的看到已持有就交回同一个结果。停止信号一到就封住：不再开始新的
 * 一步、不再排重试；在途的一步做完后，迟到交回的持有立即放掉（bots.md“时序与寿命”）。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {SessionHold} from "@notnotype/nb-harness/kit/sessions";

import type {AgentService} from "nbook/plugins/agent/shared/contracts";

import {BOTS_PLUGIN, mainSessionId} from "../shared/contracts";
import type {MainState} from "../shared/contracts";
import type {BotRecord} from "./store";

/** `hold` 得 `session-busy` 时多久再试（main-conversation.md 输出 2）。 */
export const BUSY_RETRY_MS = 5_000;
/** 打开超过这么久写 `bots.main-open-slow`（输出 6）。 */
export const SLOW_OPEN_MS = 2_000;

export type EnsureResult = {readonly ok: true; readonly sessionId: string} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

export interface MainConversationsOptions {
    readonly agent: AgentService;
    readonly clock: RuntimeClock;
    readonly report: (level: "info" | "warn", code: string, message: string, data: Readonly<Record<string, unknown>>) => void;
    /** 某个 bot 的持有状态变了。 */
    readonly changed: () => void;
}

/** 封住之后到的 `ensure`：`nbook.bots` 正在停止。 */
export class BotsStopping extends Error {
    constructor() {
        super("nbook.bots is stopping");
        this.name = "BotsStopping";
    }
}

export class MainConversations {
    readonly #states = new Map<string, MainState>();
    readonly #holds = new Map<string, SessionHold>();
    readonly #chains = new Map<string, Promise<unknown>>();
    readonly #retries = new Map<string, () => void>();
    #sealed = false;

    constructor(private readonly options: MainConversationsOptions) {}

    state(botId: string): MainState {
        return this.#states.get(botId) ?? {state: "none"};
    }

    /**
     * 确保主对话在、已持有（输出 1）。`create: false` 是启动时的后台任务（输出 2）：还没有主对话的不建，留给 `ensureMain`。封住之后抛
     * `BotsStopping`。
     */
    ensure(bot: BotRecord, options: {readonly create: boolean} = {create: true}): Promise<EnsureResult> {
        if (this.#sealed) return Promise.reject(new BotsStopping());
        const previous = this.#chains.get(bot.id) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(() => this.#ensure(bot, options.create));
        this.#chains.set(bot.id, next);
        return next;
    }

    /** 停止信号：同步封住，取消排着的重试。 */
    seal(): void {
        this.#sealed = true;
        for (const cancel of this.#retries.values()) cancel();
        this.#retries.clear();
    }

    /** 停止：等在途的一步做完，再放掉全部持有。 */
    async stop(): Promise<void> {
        this.seal();
        await Promise.allSettled([...this.#chains.values()]);
        for (const hold of this.#holds.values()) hold.release();
        this.#holds.clear();
    }

    async #ensure(bot: BotRecord, create: boolean): Promise<EnsureResult> {
        const sessionId = mainSessionId(bot.id);
        if (this.#holds.has(bot.id)) return {ok: true, sessionId};
        if (this.#sealed) throw new BotsStopping();
        this.#retries.get(bot.id)?.();
        this.#retries.delete(bot.id);
        // 后台任务只把已有主对话的 bot 带到 opening（main-conversation.md“状态与转换”）：读到会话头之前不改状态。
        if (create) this.#set(bot.id, {state: "opening"});
        for (;;) {
            const header = await this.options.agent.header(sessionId);
            if (header.ok) {
                const owner = header.value.owner;
                if (owner?.plugin !== BOTS_PLUGIN || owner.id !== bot.id) return this.#fail(bot, {ok: false, code: "owner-mismatch"});
                this.#set(bot.id, {state: "opening"});
                return this.#hold(bot);
            }
            if (header.code !== "session-not-found") return this.#fail(bot, failure(header));
            if (!create) return {ok: false, code: "session-not-found"};
            if (this.#sealed) throw new BotsStopping();
            const created = await this.options.agent.create({profile: bot.profile, id: sessionId, owner: {id: bot.id}});
            // 别处刚建了：回去读会话头，按归属判断。
            if (!created.ok && created.code === "session-exists") continue;
            if (!created.ok) return this.#fail(bot, failure(created));
            return this.#hold(bot);
        }
    }

    async #hold(bot: BotRecord): Promise<EnsureResult> {
        const sessionId = mainSessionId(bot.id);
        if (this.#sealed) throw new BotsStopping();
        const held = await this.options.agent.hold(sessionId);
        if (!held.ok) {
            if (held.code === "session-busy" && !this.#sealed) {
                this.#retries.set(bot.id, this.options.clock.schedule(() => {
                    this.#retries.delete(bot.id);
                    // 停止信号会取消这次重试；ensure 自己也拒绝封住之后的调用。
                    void this.ensure(bot, {create: false}).catch(() => undefined);
                }, BUSY_RETRY_MS));
            }
            return this.#fail(bot, failure(held));
        }
        if (this.#sealed) {
            held.value.release();
            throw new BotsStopping();
        }
        this.#holds.set(bot.id, held.value);
        this.#set(bot.id, {state: "held"});
        if (held.value.opened !== null) await this.#measured(bot, held.value.opened);
        return {ok: true, sessionId};
    }

    /** 实际打开了会话（不是复用已开的）才记（输出 6）。读快照失败只少一个事件数，不影响持有。 */
    async #measured(bot: BotRecord, ms: number): Promise<void> {
        const sessionId = mainSessionId(bot.id);
        const head = await this.options.agent.session(sessionId).snapshot().then((snapshot) => snapshot.head, () => null);
        const data = {bot: bot.id, session: sessionId, events: head, ms};
        this.options.report("info", "main-opened", `打开了 bot ${bot.id} 的主对话：${String(head)} 个事件，${String(ms)} 毫秒`, data);
        if (ms > SLOW_OPEN_MS) this.options.report("warn", "main-open-slow", `打开 bot ${bot.id} 的主对话用了 ${String(ms)} 毫秒，超过 ${String(SLOW_OPEN_MS)}`, data);
    }

    #fail(bot: BotRecord, result: {readonly ok: false; readonly code: string; readonly detail?: unknown}): EnsureResult {
        this.#set(bot.id, {state: "failed", code: result.code});
        return result;
    }

    #set(botId: string, state: MainState): void {
        const before = this.#states.get(botId);
        if (before?.state === state.state && (before.state !== "failed" || before.code === (state as {code: string}).code)) return;
        this.#states.set(botId, state);
        this.options.changed();
    }
}

const failure = (result: {readonly code: string; readonly detail?: unknown}): {readonly ok: false; readonly code: string; readonly detail?: unknown} => ({ok: false, code: result.code, ...(result.detail === undefined ? {} : {detail: result.detail})});
