// #nitro-internal-pollyfills 与 trapUnhandledNodeErrors 是 Nitro 内部导出，升级 nitropack 时要重新验证。
import "#nitro-internal-pollyfills";
import {toNodeListener} from "h3";
import {useNitroApp, useRuntimeConfig} from "nitropack/runtime";
import {trapUnhandledNodeErrors} from "nitropack/runtime/internal";
import {startProductRuntime} from "nbook/server/runtime/product-startup";

import {reportProductStartupFailure} from "nbook/server/host/startup-diagnostic";

trapUnhandledNodeErrors();
void (async () => {
    const nitroApp = useNitroApp();
    const runtime = startProductRuntime({
        mode: "production",
        nitroApp,
        http: {listener: toNodeListener(nitroApp.h3App), baseURL: useRuntimeConfig().app.baseURL || ""},
        exit: (code) => process.exit(code),
    });
    try {
        await runtime.ready;
    } catch {
        // 启动函数已同步写致命诊断；等待同一宿主停止结算，不靠未捕获异常终止进程。
        await runtime.stopped;
    }
})().catch((error: unknown) => {
    reportProductStartupFailure(error);
    process.exit(1);
});

export default {};
