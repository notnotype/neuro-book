/**
 * bot 服务（docs/specs/bots/bots.md 输出 4–7 与“时序与寿命”）：启动的后台任务、`list` 与 `ensureMain`。
 *
 * 后台任务由入口在收到自己的缺省预设声明时开始：读记录、收拾上次没做完的、一个 bot 都没有时等缺省预设的文件核对再建、对每个 bot 持有
 * 已有的主对话。读记录与持有不看缺省预设的文件是否可用。`ensureMain` 等“读记录与建 bot”做完再查 bot，持有那一步各 bot 自己排队。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {BOTS_PLUGIN, DEFAULT_BOT, DEFAULT_PRESET} from "../shared/contracts";
import type {BotItem} from "../shared/contracts";
import {createBot, recoverBots} from "./create";
import type {BotFilesOptions} from "./create";
import {BotsStopping} from "./main";
import type {EnsureResult, MainConversations} from "./main";
import type {PresetTable} from "./presets";
import type {BotRecord, BotStore, ReadBots} from "./store";
import type {SeenResult, UnreadTracker} from "./unread";

export interface BotServiceOptions {
    /** 插件存储打不开时为 null：没有 bot，`ensureMain` 得 `unknown-bot`。 */
    readonly store: BotStore | null;
    /** `<状态根>/user/bots`。 */
    readonly root: string;
    readonly presets: PresetTable;
    readonly main: MainConversations;
    readonly unread: UnreadTracker;
    readonly clock: RuntimeClock;
    readonly signal: AbortSignal;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export class BotService {
    #bots: readonly BotRecord[] = [];
    #running: Promise<void> | null = null;
    readonly #loaded: Promise<void>;
    #markLoaded!: () => void;
    readonly #listeners = new Set<() => void>();

    constructor(private readonly options: BotServiceOptions) {
        this.#loaded = new Promise<void>((resolve) => {
            this.#markLoaded = resolve;
        });
    }

    /** 开始后台任务；重复调只开始一次。 */
    start(): void {
        this.#running ??= this.#run().catch((error: unknown) => {
            this.options.report("start-failed", `bot 的后台任务出错：${error instanceof Error ? error.message : String(error)}`);
        }).finally(() => this.#markLoaded());
    }

    list(): BotItem[] {
        return this.#bots.map((bot) => ({id: bot.id, name: bot.name, main: this.options.main.state(bot.id), ...this.options.unread.item(bot.id)}));
    }

    /** bot 记录里有这个 bot（头像路由按它判断）。 */
    has(botId: string): boolean {
        return this.#bots.some((bot) => bot.id === botId);
    }

    /** 记“看到”（main-conversation.md 的未读）。 */
    async markSeen(botId: string, through: number): Promise<SeenResult | {readonly ok: false; readonly code: "unknown-bot"}> {
        await this.#loaded;
        if (!this.has(botId)) return {ok: false, code: "unknown-bot"};
        return this.options.unread.markSeen(botId, through);
    }

    /** 主对话（main-conversation.md 输出 1）：后台任务读完记录、建完 bot 之前到的等它。 */
    async ensureMain(botId: string): Promise<EnsureResult> {
        await this.#loaded;
        const bot = this.#bots.find((item) => item.id === botId);
        if (bot === undefined) return {ok: false, code: "unknown-bot"};
        return this.options.main.ensure(bot);
    }

    onChanged(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    changed(): void {
        for (const listener of this.#listeners) listener();
    }

    /** 停止：等后台任务在途的一步做完（停止信号已经封住了后面的步骤）。 */
    async stop(): Promise<void> {
        this.#markLoaded();
        await this.#running;
    }

    async #run(): Promise<void> {
        const {store, signal} = this.options;
        if (store === null || signal.aborted) return;
        const files: BotFilesOptions = {root: this.options.root, store, report: (code, message, data) => this.options.report(code, message, data)};
        let read = await store.read();
        if (read.ok && !signal.aborted) read = await recoverBots(files, read.bots);
        if (!this.#accept(read)) return;
        if (this.#bots.length === 0 && !signal.aborted) {
            // 只有这个分支等缺省预设的文件核对：已有的 bot 不受它影响。
            const preset = await this.options.presets.settled(DEFAULT_PRESET);
            if (preset === null) this.options.report("default-preset-missing", `缺省预设 ${DEFAULT_PRESET} 不可用，没有建 bot`, {preset: DEFAULT_PRESET});
            else if (!signal.aborted && !this.#accept(await createBot(files, preset, DEFAULT_BOT, this.options.clock.now()), "create-failed")) return;
        }
        this.#markLoaded();
        for (const bot of this.#bots) {
            if (signal.aborted) return;
            await this.options.main.ensure(bot, {create: false}).catch((error: unknown) => {
                if (!(error instanceof BotsStopping)) throw error;
            });
        }
    }

    /** 读到的记录记下来；读不懂时写诊断（不当成没有 bot，不建新的）。`failed`：别的失败用的诊断码。 */
    #accept(read: ReadBots, failed = "record-failed"): boolean {
        if (!read.ok) {
            const code = read.unreadable ? "record-unreadable" : failed;
            this.options.report(code, `bot 记录${read.unreadable ? "读不懂" : "没写成"}：${read.detail}`, {detail: read.detail, plugin: BOTS_PLUGIN});
            return false;
        }
        this.#bots = read.bots;
        this.changed();
        return true;
    }
}
