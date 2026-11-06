/**
 * 由代码提供的场景图（docs/specs/theme/skins.md 输出 18）：主题经 `sceneProvider` 引用 `workbench.theme-scenes` 的贡献，这里
 * 请求、检查、缓存它画的图。
 *
 * 要守住的几件事：
 * - 结果放在响应式表里，`sceneFor` 读它：结果落下时，读过它的 `watchEffect`（`WorkbenchDocument`）自动重算主题。启动请求写在
 *   非响应式的 `#jobs` 里，所以 effect 里调 `sceneFor` 不会写响应式状态。
 * - 图要先过浏览器解码才放进表：对象 URL 建得出来不等于解得开，解不开的图会让位置变成空白，而不是后备的静态图。
 * - 每个主题条目有代次，主题重新发布或撤回时加一，名下的请求与结果全部作废；迟到的结果代次对不上就丢弃并撤销它的 URL。
 * - 失败不重试（一个键失败后留着，直到主题或提供者重新发布），免得提供者坏了每次重算主题都再请求一遍；原因按提供者记一次诊断。
 * - 提供者所在入口要在启动时激活，这里不替它激活：没发布的提供者按“没有提供者”处理，用后备图。
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
}

type ProviderHandle = ContributionHandle<SceneProviderDeclaration, SceneProviderImplementation>;

interface Spec {
    readonly entryId: string;
    readonly providerId: string;
    readonly appearance: "light" | "dark";
    readonly working: boolean;
    readonly generation: number;
}

interface Job {
    readonly spec: Spec;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout> | undefined;
}

/** 单次 `setTimeout` 的上限（有符号 32 位毫秒）；更远的到点后再排一次。 */
const MAX_TIMER_MS = 2 ** 31 - 1;

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
    readonly #generations = new Map<string, number>();
    readonly #reported = new Set<string>();
    readonly #decode: (url: string) => Promise<void>;
    readonly #report: (providerId: string, problem: string) => void;
    readonly #now: () => number;
    #disposed = false;

    constructor(options: SceneProviderOptions) {
        this.#decode = options.decode ?? decodeInBrowser;
        this.#report = options.report ?? (() => undefined);
        this.#now = options.now ?? Date.now;
    }

    /**
     * 这个主题在这个明暗与状态下，提供者画好的图（已解码的对象 URL）；没有提供者、还没画好、或失败时为 undefined，调用方用后备图。
     * 第一次读到发布了的提供者时发起请求。
     */
    sceneFor(entry: {readonly id: string; readonly declaration: {readonly sceneProvider?: string}}, appearance: "light" | "dark", working: boolean): string | undefined {
        const providerId = entry.declaration.sceneProvider;
        if (providerId === undefined || this.#disposed) return undefined;
        if (!this.#handles.value.has(providerId)) return undefined;
        const key = `${entry.id}\n${appearance}\n${String(working)}`;
        const url = this.#results.value.get(key);
        if (!this.#jobs.has(key)) {
            const spec: Spec = {entryId: entry.id, providerId, appearance, working, generation: this.#generations.get(entry.id) ?? 0};
            this.#jobs.set(key, {spec, controller: new AbortController(), timer: undefined});
            void this.#run(key);
        }
        return url;
    }

    receiver(): ContributionReceiver<SceneProviderDeclaration, SceneProviderImplementation> {
        return {
            published: (handle) => {
                const next = new Map(this.#handles.value);
                next.set(handle.id, handle);
                this.#handles.value = next;
            },
            revoke: (handle) => {
                if (this.#handles.value.get(handle.id) === handle) {
                    const next = new Map(this.#handles.value);
                    next.delete(handle.id);
                    this.#handles.value = next;
                }
                this.#drop((job) => job.spec.providerId === handle.id);
            },
        };
    }

    /** 主题条目重新发布或撤回：名下的请求与结果作废，迟到的结果因代次对不上被丢弃。 */
    generationChanged(entryId: string): void {
        this.#generations.set(entryId, (this.#generations.get(entryId) ?? 0) + 1);
        this.#drop((job) => job.spec.entryId === entryId);
    }

    dispose(): void {
        this.#disposed = true;
        this.#drop(() => true);
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
        const stale = (): boolean => signal.aborted || this.#jobs.get(key) !== job || (this.#generations.get(spec.entryId) ?? 0) !== spec.generation;
        let url: string | undefined;
        try {
            // 让出一次：`sceneFor` 在 effect 里调用，提供者的代码不能跑在 effect 的依赖收集里。
            await Promise.resolve();
            if (stale()) return;
            const handle = this.#handles.value.get(spec.providerId);
            if (handle === undefined) return;
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
            if (!this.#reported.has(spec.providerId)) {
                this.#reported.add(spec.providerId);
                this.#report(spec.providerId, error instanceof Error ? error.message : String(error));
            }
        }
    }

    #schedule(key: string, job: Job, expiresAt: number): void {
        const delay = Math.max(0, expiresAt - this.#now());
        job.timer = setTimeout(() => {
            if (delay > MAX_TIMER_MS) this.#schedule(key, job, expiresAt);
            else void this.#run(key);
        }, Math.min(delay, MAX_TIMER_MS));
    }
}
