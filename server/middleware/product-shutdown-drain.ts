import {createError, defineEventHandler} from "h3";
import {productShutdownController} from "nbook/server/runtime/shutdown/product-shutdown";

/**
 * 为每个 HTTP 请求持有进程级 drain lease。
 * Product 进入关闭状态后不再接受新业务请求；已有请求在响应结束时释放 lease。
 */
export default defineEventHandler((event) => {
    const release = productShutdownController.enterRequest();
    if (!release) {
        throw createError({statusCode: 503, message: "NeuroBook 正在关闭。"});
    }
    event.context.productShutdownSignal = release.signal;
    let released = false;
    const releaseOnce = (): void => {
        if (released) return;
        released = true;
        if (event.context.productShutdownSignal === release.signal) {
            delete event.context.productShutdownSignal;
        }
        release.release();
    };
    event.node.res.once("finish", releaseOnce);
    event.node.res.once("close", releaseOnce);
});
