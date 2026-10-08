/**
 * nbook.diagnostics 插件定义：激活时打开环境出口并把它接到既有记录缓冲之后，向消费者提供
 * 诊断服务；释放时进入停止中、补写并关闭出口。
 *
 * 本文件平台中立：出口由宿主注入（后端文件出口、浏览器 console 出口），缺少文件能力不影响启动。
 * 行为合同见 docs/specs/runtime/diagnostics.md。
 */

import type {RuntimeLocation} from "../lifecycle/lifecycle";
import type {ActivationContext, PluginDefinition} from "../plugins/plugins";
import {defineEntry, provide} from "../plugins/plugins";
import {defineServiceKey} from "../services/services";
import type {ServiceKey} from "../services/services";

import type {
    DiagnosticExporterFactory,
    DiagnosticFallback,
    DiagnosticInput,
    DiagnosticQuery,
    DiagnosticQueryResult,
    DiagnosticsService,
    DiagnosticsStatus,
    DiagnosticsStore,
    ExporterOpenOutcome,
    RecordReceipt,
} from "./contracts";
import {describeDiagnosticError} from "./redaction";

/** 诊断服务键：同一运行实例内最多一个提供者。 */
export const diagnosticsKey: ServiceKey<DiagnosticsService> = defineServiceKey<DiagnosticsService>("nbook.diagnostics/diagnostics");

export interface DiagnosticsPluginOptions {
    /** 本插件的运行位置；与宿主实例身份一致。 */
    readonly location: RuntimeLocation;
    /** 装配方在 createApplication 之前创建的记录能力。 */
    readonly store: DiagnosticsStore;
    readonly exporter: DiagnosticExporterFactory;
    /** 宿主紧急最小输出通道；出口不可用时 error/fatal 记录走它。 */
    readonly fallback: DiagnosticFallback;
}

/**
 * 创建诊断插件定义：登记阶段不产生任何 I/O，出口只在激活时打开。
 */
export function createDiagnosticsPlugin(options: DiagnosticsPluginOptions): PluginDefinition {
    return {
        id: "nbook.diagnostics",
        entries: [
            defineEntry({
                id: "main",
                location: options.location,
                provides: [diagnosticsKey],
                activate: async (context: ActivationContext) => {
                    let outcome: ExporterOpenOutcome;
                    try {
                        outcome = await options.exporter({signal: context.signal});
                    } catch (error) {
                        // 出口工厂自身异常与“出口不可用”同义：日志可以降级，诊断仍要可用。
                        outcome = {status: "degraded", reason: "exporter-open-failed", detail: describeDiagnosticError(error)};
                    }
                    try {
                        await options.store.attach({outcome, fallback: options.fallback});
                    } catch (error) {
                        // 挂接失败（store 已关闭或已挂接）时本次激活不能发布服务：先尽力关掉刚打开的出口。
                        await closeUnpublishedExporter(outcome);
                        throw error;
                    }
                    return {services: [provide(diagnosticsKey, createService(options.store), () => options.store.shutdown())]};
                },
            }),
        ],
    };
}

/** 每次激活建立一个独立的服务实例：管理面（attach/shutdown）留给装配方，消费者只拿到记录与查询。 */
function createService(store: DiagnosticsStore): DiagnosticsService {
    return {
        record: (input: DiagnosticInput): RecordReceipt => store.record(input),
        query: (query?: DiagnosticQuery): DiagnosticQueryResult => store.query(query),
        status: (): DiagnosticsStatus => store.status(),
    };
}

/** 挂接失败后的收口：出口不再有归属者，关闭异常不能再掩盖原始激活失败。 */
async function closeUnpublishedExporter(outcome: ExporterOpenOutcome): Promise<void> {
    if (outcome.status !== "open") {
        return;
    }
    try {
        await outcome.exporter.close();
    } catch {
        // 本次激活已经失败；这里只避免继续持有位置授予，不改变激活结果。
    }
}
