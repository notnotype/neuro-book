/**
 * 由代码提供的场景图（docs/specs/theme/skins.md 输出 18）：主题经 `sceneProvider` 引用 `workbench.theme-scenes` 的贡献，这里
 * 请求、检查、缓存它画的图。
 *
 * 要守住的几件事：
 * - 结果放在响应式表里，`sceneFor` 读它：结果落下时，读过它的 `watchEffect`（`WorkbenchDocument`）自动重算主题。启动请求写在
 *   非响应式的 `#jobs` 里，所以 effect 里调 `sceneFor` 不会写响应式状态。
 * - 图要先过浏览器解码才放进表：对象 URL 建得出来不等于解得开，解不开的图会让位置变成空白，而不是后备的静态图。
 * - 主题条目重新发布、撤回或换了提供者时（`entryChanged`），名下的请求与结果全部作废：请求被取消、定时器清掉、已画的图撤销；迟到的结果因为
 *   这个键的任务已经不是它，被丢弃并撤销它的 URL。
 * - 第一次画失败不重试（一个键失败后留着，直到主题或提供者重新发布），免得提供者坏了每次重算主题都再请求一遍；刷新失败时旧图继续显示，
 *   隔一段时间再试。原因按提供者记一次诊断，提供者撤回后清掉记录。
 * - 提供者所在入口要在启动时激活，这里不替它激活：没发布的提供者按“没有提供者”处理，用后备图。启动时入口还没激活是正常的，所以隔
 *   一段时间还没发布才记诊断，最常见的作者错误（入口忘写 `onStartup`）才不至于静默。
 */

import {shallowRef} from "@vue/reactivity";

import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {MAX_SCENE_BYTES} from "../shared/themes";
import type {SceneProviderDeclaration, SceneProviderImplementation} from "../shared/themes";

export interface SceneProviderOptions {
    /** 浏览器解不解得开这张图；解不开就 reject。缺省用真实的 `Image.decode()`。 */
    readonly decode?: (url: string) => Promise<void>;
    /** 提供者出问题：同一个提供者只调用一次。 */
    readonly report?: (providerId: string, problem: string) => void;
    readonly now?: () => number;
    /** 三个时间都有缺省（见下面的常量）；测试用它们缩短等待。 */
    readonly minRefreshMs?: number;
    readonly retryMs?: number;
    readonly publishGraceMs?: number;
}

type ProviderHandle = ContributionHandle<SceneProviderDeclaration, SceneProviderImplementation>;

interface Spec {
    readonly entryId: string;
    readonly providerId: string;
    readonly appearance: "light" | "dark";
    readonly working: boolean;
}

interface Job {
    readonly spec: Spec;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout> | undefined;
}

/** 单次 `setTimeout` 的上限（有符号 32 位毫秒）；更远的到点后再排一次。 */
const MAX_TIMER_MS = 2 ** 31 - 1;
/**
 * 两次画之间至少隔这么久：`expiresAt` 是过去的时刻（例如把秒级时间戳当毫秒交上来）时不会变成请求死循环。
 */
const MIN_REFRESH_MS = 5_000;
/** 刷新失败后隔多久再试；旧图在这期间继续显示。 */
const RETRY_MS = 60_000;
/** 提供者发布得多晚才算“没发布”：入口启动、激活要时间。 */
const PUBLISH_GRACE_MS = 5_000;

/** 节点侧的类型检查（`tsc`）没有 DOM 库，而测试会引到这个文件，所以经 `globalThis` 取 `Image`。 */
async function decodeInBrowser(url: string): Promise<void> {
    const image = new (globalThis as unknown as {Image: new () => {src: string; decode(): Promise<void>}}).Image();
    image.src = url;
    await image.decode();
}

export class SceneProviders {
    readonly #handles = shallowRef<ReadonlyMap<string, ProviderHandle>>(new Map());
    /** 键 → 已解码的对象 URL。 */
    readonly #results = shallowRef<ReadonlyMap<string, string>>(new Map());
    readonly #jobs = new Map<string, Job>();
    readonly #reported = new Set<string>();
    /** 已经为“没发布”排过检查的提供者。 */
    readonly #watched = new Map<string, ReturnType<typeof setTimeout>>();
    readonly #decode: (url: string) => Promise<void>;
    readonly #report: (providerId: string, problem: string) => void;
    readonly #now: () => number;
    readonly #minRefreshMs: number;
    readonly #retryMs: number;
    readonly #publishGraceMs: number;
    #disposed = false;

    constructor(options: SceneProviderOptions) {
        this.#decode = options.decode ?? decodeInBrowser;
        this.#report = options.report ?? (() => undefined);
        this.#now = options.now ?? Date.now;
        this.#minRefreshMs = options.minRefreshMs ?? MIN_REFRESH_MS;
        this.#retryMs = options.retryMs ?? RETRY_MS;
        this.#publishGraceMs = options.publishGraceMs ?? PUBLISH_GRACE_MS;
    }

    /**
     * 这个主题在这个明暗与状态下，提供者画好的图（已解码的对象 URL）；没有提供者、还没画好、或失败时为 undefined，调用方用后备图。
     * 第一次读到发布了的提供者时发起请求。
     */
    sceneFor(entry: {readonly id: string; readonly declaration: {readonly sceneProvider?: string}}, appearance: "light" | "dark", working: boolean): string | undefined {
        const providerId = entry.declaration.sceneProvider;
        if (providerId === undefined || this.#disposed) return undefined;
        if (!this.#available(providerId)) {
            this.#watchPublished(providerId);
            return undefined;
        }
        const key = `${entry.id}\n${appearance}\n${String(working)}`;
        const url = this.#results.value.get(key);
        if (!this.#jobs.has(key)) {
            const spec: Spec = {entryId: entry.id, providerId, appearance, working};
            this.#jobs.set(key, {spec, controller: new AbortController(), timer: undefined});
            void this.#run(key);
        }
        return url;
    }

    /** 当前可用的提供者 id（已发布）。响应式：发布与撤回会让读过它的 effect 重算。 */
    get published(): ReadonlyArray<string> {
        return [...this.#handles.value].filter(([, handle]) => handle.published).map(([id]) => id).sort();
    }

    /**
     * 可用 = 句柄在表里且仍处于发布状态：入口开始停止时句柄先失去 `published`，撤回通知稍后才到，这段时间不能再列出、也不能再调实现
     * （docs/specs/runtime/plugins.md 的贡献状态）。
     */
    #available(providerId: string): boolean {
        return this.#handles.value.get(providerId)?.published === true;
    }

    receiver(): ContributionReceiver<SceneProviderDeclaration, SceneProviderImplementation> {
        return {
            published: (handle) => {
                const next = new Map(this.#handles.value);
                next.set(handle.id, handle);
                this.#handles.value = next;
                const watching = this.#watched.get(handle.id);
                if (watching !== undefined) clearTimeout(watching);
                this.#watched.delete(handle.id);
            },
            revoke: (handle) => {
                if (this.#handles.value.get(handle.id) === handle) {
                    const next = new Map(this.#handles.value);
                    next.delete(handle.id);
                    this.#handles.value = next;
                }
                this.#drop((job) => job.spec.providerId === handle.id);
                // 提供者回来后再出问题要能再记一次。
                this.#reported.delete(handle.id);
                this.#watched.delete(handle.id);
            },
        };
    }

    /** 主题条目重新发布、撤回或换了提供者：名下的请求与结果作废，迟到的结果被丢弃。 */
    entryChanged(entryId: string): void {
        this.#drop((job) => job.spec.entryId === entryId);
    }

    dispose(): void {
        this.#disposed = true;
        this.#drop(() => true);
        for (const timer of this.#watched.values()) clearTimeout(timer);
        this.#watched.clear();
    }

    /** 主题引用了还没发布的提供者：等一阵子还没发布就记一条诊断（同一个提供者一次）。发布了或撤回了，检查就取消。 */
    #watchPublished(providerId: string): void {
        if (this.#watched.has(providerId)) return;
        this.#watched.set(providerId, setTimeout(() => {
            if (this.#handles.value.has(providerId)) return;
            this.#reportOnce(providerId, "没有发布：提供者所在的入口要在启动时激活（activationEvents 写 onStartup），也可能插件没启用");
        }, this.#publishGraceMs));
    }

    #reportOnce(providerId: string, problem: string): void {
        if (this.#reported.has(providerId)) return;
        this.#reported.add(providerId);
        this.#report(providerId, problem);
    }

    /** 取消符合条件的请求与定时器，撤销它们的结果。 */
    #drop(matches: (job: Job) => boolean): void {
        const results = new Map(this.#results.value);
        let changed = false;
        for (const [key, job] of [...this.#jobs]) {
            if (!matches(job)) continue;
            job.controller.abort();
            if (job.timer !== undefined) clearTimeout(job.timer);
            this.#jobs.delete(key);
            const url = results.get(key);
            if (url !== undefined) {
                URL.revokeObjectURL(url);
                results.delete(key);
                changed = true;
            }
        }
        if (changed) this.#results.value = results;
    }

    async #run(key: string): Promise<void> {
        const job = this.#jobs.get(key);
        if (job === undefined) return;
        const {spec} = job;
        job.timer = undefined;
        job.controller = new AbortController();
        const {signal} = job.controller;
        const stale = (): boolean => signal.aborted || this.#jobs.get(key) !== job;
        let url: string | undefined;
        try {
            // 让出一次：`sceneFor` 在 effect 里调用，提供者的代码不能跑在 effect 的依赖收集里。
            await Promise.resolve();
            if (stale()) return;
            const handle = this.#handles.value.get(spec.providerId);
            if (handle === undefined || !handle.published) return;
            const result = await handle.implementation().scene({appearance: spec.appearance, working: spec.working}, signal);
            if (stale()) return;
            if (!result.image.type.startsWith("image/")) throw new Error(`返回的不是图片：${result.image.type === "" ? "没有类型" : result.image.type}`);
            if (result.image.size > MAX_SCENE_BYTES) throw new Error(`图片 ${String(result.image.size)} 字节，超过 ${String(MAX_SCENE_BYTES)}`);
            url = URL.createObjectURL(result.image);
            await this.#decode(url);
            if (stale()) {
                URL.revokeObjectURL(url);
                return;
            }
            const previous = this.#results.value.get(key);
            this.#results.value = new Map(this.#results.value).set(key, url);
            if (previous !== undefined) URL.revokeObjectURL(previous);
            if (result.expiresAt !== undefined) this.#schedule(key, job, result.expiresAt);
        } catch (error) {
            if (url !== undefined) URL.revokeObjectURL(url);
            if (signal.aborted) return;
            this.#reportOnce(spec.providerId, error instanceof Error ? error.message : String(error));
            // 刷新失败：旧图还在，隔一阵再试；第一次就失败的不重试（见文件头）。
            if (this.#jobs.get(key) === job && this.#results.value.has(key)) this.#schedule(key, job, this.#now() + this.#retryMs);
        }
    }

    #schedule(key: string, job: Job, expiresAt: number): void {
        // 不是有限数的 `expiresAt`（NaN）当作没有：只画一次。
        if (!Number.isFinite(expiresAt)) return;
        const delay = Math.max(this.#minRefreshMs, expiresAt - this.#now());
        job.timer = setTimeout(() => {
            if (delay > MAX_TIMER_MS) this.#schedule(key, job, expiresAt);
            else void this.#run(key);
        }, Math.min(delay, MAX_TIMER_MS));
    }
}
