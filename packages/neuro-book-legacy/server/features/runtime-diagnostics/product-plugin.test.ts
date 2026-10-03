import {afterEach, describe, expect, it, vi} from "vitest";
import {consola} from "consola";
import {createApplication} from "nbook/runtime/application/application";
import type {Application} from "nbook/runtime/application/application";
import {createDiagnosticsStore, diagnosticsKey} from "nbook/runtime/diagnostics/diagnostics";
import {createProductDiagnosticsPlugin} from "./product-plugin";

const logger = vi.hoisted(() => ({
    info: vi.fn(async () => undefined),
    warn: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
    debug: vi.fn(async () => undefined),
    writeDiagnostic: vi.fn(async () => undefined),
    fatalSync: vi.fn(),
}));
vi.mock("nbook/server/app-logs/logger", () => ({appLogger: logger}));
const applications: Application[] = [];
afterEach(async () => {
    for (const application of applications.splice(0)) await application.stop();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

async function activate(instanceId: string) {
    const store = createDiagnosticsStore({identity: {location: "server", instanceId}});
    const application = createApplication({identity: store.identity, stopSignal: new AbortController().signal, emergency: () => undefined}, {
        keys: [diagnosticsKey], plugins: [createProductDiagnosticsPlugin(store)], requiredPlugins: ["nbook.diagnostics"], gates: [],
    });
    applications.push(application);
    expect(await application.startup).toMatchObject({status: "available"});
    return {application, store};
}

describe("产品诊断日志桥接", () => {
    it("生产激活后 console 只写 JSONL，关闭恢复原 console、reporters 与异常监听", async () => {
        vi.stubEnv("NODE_ENV", "production");
        const originalWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const originalError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const reporters = [...consola.options.reporters];
        const rejectionListeners = process.listeners("unhandledRejection");
        const exceptionListeners = process.listeners("uncaughtExceptionMonitor");
        const {application} = await activate("production");
        console.warn("断管警告");
        console.error("断管错误");
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());
        expect(originalWarn).not.toHaveBeenCalled();
        expect(originalError).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith("console.warn", {args: ["断管警告"]}, "断管警告");
        expect(logger.error).toHaveBeenCalledExactlyOnceWith("console.error", {args: ["断管错误"]}, undefined, "断管错误");
        await application.stop();
        expect(console.error).toBe(originalError);
        expect(console.warn).toBe(originalWarn);
        expect(consola.options.reporters).toEqual(reporters);
        expect(process.listeners("unhandledRejection")).toEqual(rejectionListeners);
        expect(process.listeners("uncaughtExceptionMonitor")).toEqual(exceptionListeners);
    });

    it("开发实例关闭后新实例只包装一次 console.error，并保留宿主 console", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const originalError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const {application: first} = await activate("development-first");
        await first.stop();
        const {application: second} = await activate("development-second");
        console.error("重载后的错误");
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());
        expect(originalError).toHaveBeenCalledExactlyOnceWith("重载后的错误");
        expect(logger.error).toHaveBeenCalledExactlyOnceWith("console.error", {args: ["重载后的错误"]}, undefined, "重载后的错误");
        await second.stop();
        expect(console.error).toBe(originalError);
    });
});
