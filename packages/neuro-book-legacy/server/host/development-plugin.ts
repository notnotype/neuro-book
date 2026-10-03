import {defineNitroPlugin} from "nitropack/runtime";
import {appLogger} from "nbook/server/app-logs/logger";
import {startProductRuntime} from "nbook/server/runtime/product-startup";
import {installDevelopmentWorkerStopBridge} from "nbook/server/host/development-process";

/** 由 Nuxt 模块只在开发模式登记；Nitro 不等待 async plugin，启动结果由准入观察。 */
export default defineNitroPlugin((nitroApp) => {
    const runtime = startProductRuntime({mode: "development", nitroApp});
    const bridge = installDevelopmentWorkerStopBridge(
        async (source) => {
            runtime.requestStop(source);
            return (await runtime.stopped).exitCode;
        },
        {report: (error) => appLogger.fatalSync("product.shutdown.failed", undefined, error, "开发运行实例关闭不完整")},
    );
    nitroApp.hooks.hook("close", async () => {
        try {
            await runtime.stop();
        } catch (error) {
            appLogger.fatalSync("product.shutdown.failed", undefined, error, "开发运行实例关闭不完整");
        } finally {
            bridge.close();
        }
    });
});
