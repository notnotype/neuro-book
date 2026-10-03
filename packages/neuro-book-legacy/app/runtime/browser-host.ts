/**
 * 浏览器环境适配器：把一个浏览器窗口/页面的显式销毁与卸载事件翻译为 runtime.application 的宿主上下文。
 *
 * 适配器独立于 Vue 页面与 Nuxt：只依赖 `pagehide` 事件目标与 runtime 机制，不加载服务端模块、
 * 不访问数据库对象、服务端路径或凭据；远端协议代理由装配方作为本地能力提供。
 * 每个实例挂接一次卸载监听，实例停止结算后移除；卸载事件只发出停止请求，不等待任何 Promise——
 * 浏览器卸载不保证异步回调执行，已确认的持久数据由服务保证，页面退出仅 best effort。
 * 同一 `window` 内的两个实例按 instanceId 隔离，互不共享对象；释放一个实例不发送共享后端的全局关闭。
 */

import {createApplication, createInstanceTable, stopTimeout} from "../../runtime/application/application";
import type {Application, ApplicationManifest, EmergencyReport, StopResult} from "../../runtime/application/application";

/** 适配器需要的最小页面事件接口：`pagehide` 的挂接与移除；测试可传入 EventTarget 替身。 */
export interface PageLifecycleTarget {
    addEventListener(type: "pagehide", listener: () => void): void;
    removeEventListener(type: "pagehide", listener: () => void): void;
}

export interface BrowserHostOptions {
    readonly instanceId: string;
    readonly manifest: ApplicationManifest;
    /** 页面事件目标；缺省当前 `window`，没有 DOM 时必须显式传入。 */
    readonly page?: PageLifecycleTarget;
    /** 紧急输出；缺省 `console.error` 一行 JSON。 */
    readonly emergency?: (report: EmergencyReport) => void;
    /**
     * 首次停止的有界等待（毫秒）：超时后停止结算为 `incomplete(deadline)`、监听移除；在跑的释放不被撤销。
     * 缺省不设界。页面卸载本就不保证异步回调执行，这里只约束显式销毁可观察的结果。
     */
    readonly stopTimeoutMs?: number;
}

export interface BrowserHost {
    readonly application: Application;
    /** 显式销毁：走同一生命周期合同，返回关闭结果；重复调用观察同一结果。 */
    destroy(): Promise<StopResult>;
    /** 生效的停止来源；未请求为 null。`pagehide` 只能记录为 unload，不保证关闭结果可观察。 */
    readonly stopSource: "destroy" | "unload" | null;
    /** 停止结算后卸载监听已移除。 */
    readonly detached: boolean;
}

function resolvePage(page: PageLifecycleTarget | undefined): PageLifecycleTarget {
    if (page !== undefined) {
        return page;
    }
    // 不引入 DOM lib：机制验证配置只有 ESNext lib，这里按结构取当前 window。
    const candidate = (globalThis as {window?: PageLifecycleTarget}).window;
    if (candidate === undefined) {
        throw new TypeError("没有 window：浏览器宿主需要显式传入 page 事件目标");
    }
    return candidate;
}

function writeEmergency(report: EmergencyReport): void {
    console.error(JSON.stringify({emergency: report}));
}

class BrowserHostImpl implements BrowserHost {
    readonly application: Application;
    stopSource: "destroy" | "unload" | null = null;
    detached = false;
    readonly #controller = new AbortController();
    readonly #page: PageLifecycleTarget;
    readonly #onPageHide = (): void => this.#requestStop("unload");

    constructor(options: BrowserHostOptions) {
        const stopDeadline = options.stopTimeoutMs === undefined ? undefined : stopTimeout(options.stopTimeoutMs);
        this.#page = resolvePage(options.page);
        this.#page.addEventListener("pagehide", this.#onPageHide);
        this.application = createApplication(
            {
                identity: {location: "browser", instanceId: options.instanceId},
                stopSignal: this.#controller.signal,
                stopDeadline,
                emergency: options.emergency ?? writeEmergency,
            },
            options.manifest,
        );
        // 停止结算（无论由销毁、卸载还是启动失败触发）后移除监听；之后的页面事件不再触碰该实例。
        void this.application.stopped.then(() => this.#detach());
    }

    destroy(): Promise<StopResult> {
        this.#requestStop("destroy");
        return this.application.stop();
    }

    #requestStop(source: "destroy" | "unload"): void {
        if (this.#controller.signal.aborted) {
            return;
        }
        this.stopSource = source;
        this.#controller.abort();
    }

    #detach(): void {
        this.#page.removeEventListener("pagehide", this.#onPageHide);
        this.detached = true;
    }
}

/**
 * 浏览器宿主：一个页面可以持有多个实例（按 instanceId 隔离）；同一 instanceId 存活期间重复启动共享同一实例；
 * 实例关闭后该 id 退役（见 createInstanceTable）。
 */
export class BrowserRuntimeHost {
    readonly #instances = createInstanceTable<BrowserHostImpl>();

    start(options: BrowserHostOptions): BrowserHost {
        return this.#instances.start(options.instanceId, () => new BrowserHostImpl(options));
    }

    get(instanceId: string): BrowserHost | null {
        return this.#instances.get(instanceId);
    }
}
