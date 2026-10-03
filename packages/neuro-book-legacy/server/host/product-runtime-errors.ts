/** Project 消费者共享错误身份，但不依赖产品插件装配的循环模块图。 */
export class ProductRuntimeNotReadyError extends Error {
    readonly code = "PRODUCT_RUNTIME_NOT_READY" as const;

    constructor() {
        super("Product runtime 未就绪，不接纳 Project generation");
        this.name = "ProductRuntimeNotReadyError";
    }
}

export function isProductRuntimeNotReadyError(error: unknown): error is ProductRuntimeNotReadyError {
    return error instanceof ProductRuntimeNotReadyError
        || (typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === "PRODUCT_RUNTIME_NOT_READY");
}
