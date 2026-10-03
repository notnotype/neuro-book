/**
 * 浏览器环境适配器：把页面的显式销毁与卸载翻译成 runtime.application 的宿主上下文。
 *
 * 只依赖内核与结构化的页面事件目标（不依赖 DOM 类型与 Vue），因此能在 bun test 中用 EventTarget 验证。
 * 卸载只发出停止请求、不等待：浏览器卸载页面时不保证异步回调执行（runtime.browser-host 窗口关闭）。
 * 同一页面的多个实例按 instanceId 隔离；释放一个实例不向服务端发送全局停止。
 */

import {createApplication, createInstanceTable, stopTimeout} from "@notnotype/nb-runtime/application";
import type {Application, ApplicationManifest, EmergencyReport, StopResult} from "@notnotype/nb-runtime/application";

/** 适配器需要的最小页面事件接口；浏览器里传 `window`。 */
export interface PageLifecycleTarget {
    addEventListener(type: "pagehide", listener: () => void): void;
    removeEventListener(type: "pagehide", listener: () => void): void;
}

export interface BrowserHostOptions {
    readonly instanceId: string;
    readonly manifest: ApplicationManifest;
    readonly page: PageLifecycleTarget;
    readonly emergency: (report: EmergencyReport) => void;
    /** 显式销毁的有界等待（毫秒），超时后停止结算为 `incomplete(deadline)`；缺省不设界。 */
    readonly stopTimeoutMs?: number;
}

export interface BrowserHost {
    readonly application: Application;
    /** 显式销毁；重复调用观察同一结果。 */
    destroy(): Promise<StopResult>;
    /** 生效的停止来源；`unload` 只说明请求过停止，不保证关闭结果可观察。 */
    readonly stopSource: "destroy" | "unload" | null;
    /** 停止结算后卸载监听已移除。 */
    readonly detached: boolean;
}

class BrowserHostImpl implements BrowserHost {
    readonly application: Application;
    stopSource: "destroy" | "unload" | null = null;
    detached = false;
    readonly #controller = new AbortController();
    readonly #page: PageLifecycleTarget;
    readonly #onPageHide = (): void => this.#requestStop("unload");

    constructor(options: BrowserHostOptions) {
        this.#page = options.page;
        this.#page.addEventListener("pagehide", this.#onPageHide);
        this.application = createApplication(
            {
                identity: {location: "browser", instanceId: options.instanceId},
                stopSignal: this.#controller.signal,
                stopDeadline: options.stopTimeoutMs === undefined ? undefined : stopTimeout(options.stopTimeoutMs),
                emergency: options.emergency,
            },
            options.manifest,
        );
        // 无论由销毁、卸载还是启动失败触发，停止结算后都移除监听，之后的页面事件不再触碰该实例。
        void this.application.stopped.then(() => this.#detach());
    }

    destroy(): Promise<StopResult> {
        this.#requestStop("destroy");
        return this.application.stop();
    }

    #requestStop(source: "destroy" | "unload"): void {
        if (this.#controller.signal.aborted) return;
        this.stopSource = source;
        this.#controller.abort();
    }

    #detach(): void {
        this.#page.removeEventListener("pagehide", this.#onPageHide);
        this.detached = true;
    }
}

/** 同一 instanceId 存活期间重复启动共享同一实例；实例关闭后该 id 退役，不能再启动（见 createInstanceTable）。 */
export class BrowserRuntimeHost {
    readonly #instances = createInstanceTable<BrowserHostImpl>();

    start(options: BrowserHostOptions): BrowserHost {
        return this.#instances.start(options.instanceId, () => new BrowserHostImpl(options));
    }

    get(instanceId: string): BrowserHost | null {
        return this.#instances.get(instanceId);
    }
}
