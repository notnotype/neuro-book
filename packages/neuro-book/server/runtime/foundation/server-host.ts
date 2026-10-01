/**
 * 后端环境适配器：把一个受管 Node/Bun 进程的合作停止输入翻译为 runtime.application 的宿主上下文。
 *
 * 适配器只拥有自己登记的进程信号监听：每个实例挂接一次，实例停止结算后移除，之后到达的信号
 * 不再触碰该实例。它不杀任何进程、不扫描 cwd、不读取凭据；根定位与权限由调用方先验证。
 */

import {createApplication, createInstanceTable, stopTimeout} from "../../../runtime/application/application";
import type {Application, ApplicationManifest, EmergencyReport, StopResult} from "../../../runtime/application/application";

/** 适配器需要的最小进程接口：只用到信号事件的挂接与移除；测试可传入 EventEmitter 替身。 */
export interface SignalSource {
    on(event: NodeJS.Signals, listener: () => void): unknown;
    off(event: NodeJS.Signals, listener: () => void): unknown;
}

type SignalHandler = {
    readonly signal: NodeJS.Signals;
    readonly listener: () => void;
};

export interface ServerHostOptions {
    readonly instanceId: string;
    readonly manifest: ApplicationManifest;
    /** 合作停止信号；缺省 SIGINT 与 SIGTERM。Windows 上外部进程发送的信号不可合作，宿主需另提供停止通道。 */
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    /** 挂接信号的进程对象；缺省当前进程。 */
    readonly process?: SignalSource;
    /** 紧急输出；缺省向 stderr 写一行 JSON。 */
    readonly emergency?: (report: EmergencyReport) => void;
    /**
     * 首次停止的有界等待（毫秒）：超时后停止结算为 `incomplete(deadline)`、监听移除，进程由宿主决定退出；
     * 在跑的释放不被撤销。缺省不设界（只受调用方截止约束）。
     */
    readonly stopTimeoutMs?: number;
    /** 在内核停止前等待宿主边界排空；失败仍继续关闭，并通过 beforeStopError 报告。 */
    readonly beforeStop?: () => void | Promise<void>;
}

export interface ServerHost {
    readonly application: Application;
    /** 所有宿主停止来源汇合于同一结算；只记录首次来源，重复调用不重入。 */
    requestStop(source: string): Promise<StopResult>;
    /** 生效的停止来源；未请求为 null。 */
    readonly stopSource: string | null;
    /** 停止结算后信号监听已移除。 */
    readonly detached: boolean;
    readonly stopped: Promise<StopResult>;
    readonly beforeStopError: unknown;
}

const DEFAULT_SIGNALS: ReadonlyArray<NodeJS.Signals> = ["SIGINT", "SIGTERM"];

function writeEmergency(report: EmergencyReport): void {
    process.stderr.write(`${JSON.stringify({emergency: report})}\n`);
}

class ServerHostImpl implements ServerHost {
    readonly application: Application;
    stopSource: string | null = null;
    detached = false;
    readonly #controller = new AbortController();
    readonly #source: SignalSource;
    readonly #signals: ReadonlyArray<NodeJS.Signals>;
    readonly #signalHandlers: ReadonlyArray<SignalHandler>;
    readonly #beforeStop: ServerHostOptions["beforeStop"];
    readonly #emergency: (report: EmergencyReport) => void;
    readonly #completion = Promise.withResolvers<StopResult>();
    readonly stopped = this.#completion.promise;
    beforeStopError: unknown;
    #stopping = false;

    constructor(options: ServerHostOptions) {
        const stopDeadline = options.stopTimeoutMs === undefined ? undefined : stopTimeout(options.stopTimeoutMs);
        this.#source = options.process ?? process;
        this.#signals = options.signals ?? DEFAULT_SIGNALS;
        this.#beforeStop = options.beforeStop;
        this.#emergency = options.emergency ?? writeEmergency;
        this.#signalHandlers = this.#signals.map((signal) => ({
            signal,
            // 停止来源绑定注册时的事件名，不依赖信号监听器的实参。
            listener: () => { void this.requestStop(`signal:${signal}`); },
        }));
        for (const {signal, listener} of this.#signalHandlers) {
            this.#source.on(signal, listener);
        }
        this.application = createApplication(
            {
                identity: {location: "server", instanceId: options.instanceId},
                stopSignal: this.#controller.signal,
                stopDeadline,
                emergency: this.#emergency,
            },
            options.manifest,
        );
        // 停止结算（无论由信号、启动失败还是 requestStop 触发）后移除监听；之后到达的信号不再触碰该实例。
        void this.application.stopped.then((result) => {
            this.#detach();
            if (!this.#stopping) this.#completion.resolve(result);
        });
    }

    requestStop(source: string): Promise<StopResult> {
        if (this.#stopping || this.detached) return this.stopped;
        this.#stopping = true;
        this.stopSource = source;
        void this.#stop();
        return this.stopped;
    }

    async #stop(): Promise<void> {
        try {
            if (this.#beforeStop) await this.#beforeStop();
        } catch (error) {
            this.beforeStopError = error;
            this.#emergency({instanceId: this.application.identity.instanceId, stage: "stop", reason: "宿主停止前置步骤失败", detail: error instanceof Error ? error.message : String(error)});
        }
        this.#controller.abort();
        const result = await this.application.stop();
        this.#detach();
        this.#completion.resolve(result);
    }

    #detach(): void {
        if (this.detached) return;
        for (const {signal, listener} of this.#signalHandlers) {
            this.#source.off(signal, listener);
        }
        this.detached = true;
    }
}

/**
 * 服务端宿主：一个进程可以持有多个实例（按 instanceId 隔离）；同一 instanceId 存活期间重复启动
 * 共享同一实例与同一组监听，不再挂接第二份；实例关闭后该 id 退役（见 createInstanceTable）。
 */
export class ServerRuntimeHost {
    readonly #instances = createInstanceTable<ServerHostImpl>();

    start(options: ServerHostOptions): ServerHost {
        return this.#instances.start(options.instanceId, () => new ServerHostImpl(options));
    }

    get(instanceId: string): ServerHost | null {
        return this.#instances.get(instanceId);
    }
}
