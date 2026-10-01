import {createServer} from "node:http";
import type {RequestListener, Server} from "node:http";
import destr from "destr";
import {provide} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";
import {ProductHttpAdmission} from "./admission";

export const httpKey = defineServiceKey<ProductHttpAdmission>("nbook.http/admission");

export type ProductHttpListener = {
    readonly listener: RequestListener;
    readonly baseURL: string;
};

export function createHttpPlugin(http: ProductHttpAdmission, listener: ProductHttpListener | undefined, recordStartupError: (error: unknown) => void): PluginDefinition {
    return {
        id: "nbook.http",
        entries: [{
            id: "server",
            location: "server",
            provides: [httpKey],
            activate: async (context) => {
                if (listener) {
                    const server = createServer(listener.listener);
                    // 监听失败或激活被取消时，端口仍归本代次释放，不能只在发布服务后登记清理。
                    context.scope.register({kind: "http-listener", label: "product", value: server, release: () => closeListener(server)});
                    try {
                        await listen(server, listener.baseURL);
                    } catch (error) {
                        recordStartupError(error);
                        throw error;
                    }
                }
                return {services: [provide(httpKey, http)]};
            },
        }],
    };
}

function listen(server: Server, baseURL: string): Promise<void> {
    const port = destr<number>(process.env.NITRO_PORT || process.env.PORT) || 3000;
    const host = process.env.NITRO_HOST || process.env.HOST;
    const {promise, resolve, reject} = Promise.withResolvers<void>();
    const failed = (error: Error): void => {
        server.off("listening", listening);
        reject(error);
    };
    const listening = (): void => {
        server.off("error", failed);
        const address = server.address();
        if (!address || typeof address === "string") {
            reject(new Error("HTTP listener 未取得 TCP 地址"));
            return;
        }
        const url = `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${String(address.port)}${baseURL.replace(/\/$/u, "")}`;
        console.log(`Listening on ${url}`);
        resolve();
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen({port, host});
    return promise;
}

function closeListener(server: Server): Promise<void> {
    if (!server.listening) return Promise.resolve();
    const {promise, resolve, reject} = Promise.withResolvers<void>();
    server.close((error) => error ? reject(error) : resolve());
    // 排空已完成或已超时；停止监听后不能再让未结束连接阻挡内核的关闭结算。
    server.closeAllConnections();
    return promise;
}
