import {appLogger} from "nbook/server/app-logs/logger";
import {stopProductRuntime} from "nbook/server/runtime/product-startup";
import {ProductShutdownController} from "nbook/server/runtime/shutdown/product-shutdown-controller";

export {ProductShutdownController} from "nbook/server/runtime/shutdown/product-shutdown-controller";
export type {
    ProductShutdownControllerOptions,
    ProductShutdownStep,
} from "nbook/server/runtime/shutdown/product-shutdown-controller";

export const productShutdownController = new ProductShutdownController(
    [
        {name: "product-runtime", close: () => stopProductRuntime()},
        {name: "app-logger", close: async () => appLogger.flush()},
    ],
    {
        reportFailure: (error) => appLogger.fatalSync(
            "product.shutdown.failed",
            undefined,
            error,
            "Product 关闭不完整",
        ),
    },
);
