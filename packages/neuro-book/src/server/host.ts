/**
 * 后端环境适配器：把进程的停止输入翻译成 runtime.application 的宿主上下文。
 *
 * 停止来源（进程信号、标准输入的 `stop` 行、标准输入关闭、进程级未处理异常、调用方请求）汇合为同一次
 * 停止：先执行 `beforeStop`（HTTP 排空），失败也继续，再交给内核按依赖逆序关闭。启动失败不经这里：
 * 内核自行关闭已取得的资源，此前请求都还在等待就绪、没有被接纳的，排空无事可做。适配器只拥有自己
 * 挂接的监听，停止结算后全部移除；它不退出进程、不杀进程、不读凭据，退出码由装配方决定。
 */

import {createInterface} from "node:readline";
import type {Interface} from "node:readline";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application, ApplicationManifest, EmergencyReport, StopResult} from "@notnotype/nb-runtime/application";

export type FatalKind = "uncaught-exception" | "unhandled-rejection";

/** 适配器用到的最小进程接口；测试可传入 EventEmitter 替身。 */
export interface ProcessEvents {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface ServerHostOptions {
    readonly instanceId: string;
    /** 运行位置：服务端进程为 `server`（缺省），项目子进程为 `project`，两者共用这个适配器。 */
    readonly location?: "server" | "project";
    readonly manifest: ApplicationManifest;
    readonly emergency: (report: EmergencyReport) => void;
    /** 挂接信号与未处理异常的进程对象；缺省当前进程。 */
    readonly process?: ProcessEvents;
    /** 合作停止信号；缺省 SIGINT 与 SIGTERM。 */
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    /** 停止通道：读到一行 `stop` 即请求停止，流结束也请求停止（父进程已不在）。缺省不挂接。 */
    readonly stopInput?: NodeJS.ReadableStream | null;
    /** 内核停止前的宿主步骤；失败仍继续关闭，原因见 `beforeStopError`。 */
    readonly beforeStop?: () => void | Promise<void>;
    /**
     * 进程级未处理异常：由装配方记录（并据此决定退出码），宿主随后以 `fatal:<kind>` 请求停止。
     * 挂接它会取代运行时“打印并退出”的默认行为。
     */
    readonly onFatal: (error: unknown, kind: FatalKind) => void;
}

export interface ServerHost {
    readonly application: Application;
    /** 所有停止来源汇合于同一结算；只记录首次来源，重复调用不重入。 */
    requestStop(source: string): Promise<StopResult>;
    /** 生效的停止来源；未请求为 null。 */
    readonly stopSource: string | null;
    /** 本实例首次停止的结算（无论由哪个来源或启动失败触发）。 */
    readonly stopped: Promise<StopResult>;
    readonly beforeStopError: unknown;
    /** 停止结算后监听已移除。 */
    readonly detached: boolean;
}

const DEFAULT_SIGNALS: ReadonlyArray<NodeJS.Signals> = ["SIGINT", "SIGTERM"];

type Listener = {readonly event: string; readonly listener: (...args: unknown[]) => void};

class ServerHostImpl implements ServerHost {
    readonly application: Application;
    stopSource: string | null = null;
    beforeStopError: unknown;
    detached = false;
    readonly #controller = new AbortController();
    readonly #completion = Promise.withResolvers<StopResult>();
    readonly stopped = this.#completion.promise;
    readonly #process: ProcessEvents;
    readonly #listeners: ReadonlyArray<Listener>;
    readonly #beforeStop: ServerHostOptions["beforeStop"];
    readonly #emergency: (report: EmergencyReport) => void;
    #stopInput: Interface | null = null;
    #stopping = false;

    constructor(options: ServerHostOptions) {
        this.#process = options.process ?? process;
        this.#beforeStop = options.beforeStop;
        this.#emergency = options.emergency;
        this.#listeners = [
            // 停止来源绑定挂接时的事件名，不依赖监听器的实参。
            ...(options.signals ?? DEFAULT_SIGNALS).map((signal) => ({event: signal, listener: () => { void this.requestStop(`signal:${signal}`); }})),
            {event: "uncaughtException", listener: (error: unknown) => this.#fatal(options.onFatal, error, "uncaught-exception")},
            {event: "unhandledRejection", listener: (reason: unknown) => this.#fatal(options.onFatal, reason, "unhandled-rejection")},
        ];
        for (const {event, listener} of this.#listeners) this.#process.on(event, listener);
        if (options.stopInput) this.#stopInput = this.#watchStopInput(options.stopInput);
        this.application = createApplication(
            {
                identity: {location: options.location ?? "server", instanceId: options.instanceId},
                stopSignal: this.#controller.signal,
                emergency: this.#emergency,
            },
            options.manifest,
        );
        // 启动失败时内核自行收口：同样结算并移除监听，之后到达的信号不再触碰该实例。
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

    #fatal(onFatal: ServerHostOptions["onFatal"], error: unknown, kind: FatalKind): void {
        try {
            onFatal(error, kind);
        } finally {
            void this.requestStop(`fatal:${kind}`);
        }
    }

    async #stop(): Promise<void> {
        try {
            await this.#beforeStop?.();
        } catch (error) {
            this.beforeStopError = error;
            this.#emergency({
                instanceId: this.application.identity.instanceId,
                stage: "stop",
                reason: "宿主停止前置步骤失败",
                detail: error instanceof Error ? error.message : String(error),
            });
        }
        this.#controller.abort();
        const result = await this.application.stop();
        this.#detach();
        this.#completion.resolve(result);
    }

    #watchStopInput(input: NodeJS.ReadableStream): Interface {
        const lines = createInterface({input, crlfDelay: Infinity});
        lines.on("line", (line) => {
            if (line.trim() === "stop") void this.requestStop("stdin:stop");
        });
        lines.on("close", () => { void this.requestStop("stdin:closed"); });
        return lines;
    }

    #detach(): void {
        if (this.detached) return;
        this.detached = true;
        for (const {event, listener} of this.#listeners) this.#process.off(event, listener);
        // 先标记已移除再关闭：readline 关闭时触发的 close 事件不能再当作停止来源。
        this.#stopInput?.close();
        this.#stopInput = null;
    }
}

/** 建立一个后端运行实例并挂接停止来源；一个进程只应调用一次。 */
export function startServerHost(options: ServerHostOptions): ServerHost {
    return new ServerHostImpl(options);
}
