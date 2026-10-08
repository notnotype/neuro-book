/**
 * 场景用的宿主：像应用包的服务端与浏览器宿主（`packages/neuro-book/src/server/`、`src/web/`）那样，把各插件
 * 在本运行位置的入口装进一个运行实例。跨实例时服务端带路由，窗口经进程内链路连上它；产品里的链路是 WebSocket，
 * 这里帧照样经 JSON 编解码。
 *
 * `Stage` 记下它起的实例与路由，`close()` 逆序停止实例、再关路由；场景测试在 `afterEach` 里调用它，失败的用例
 * 也收口。
 */

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application, ApplicationManifest, StopResult} from "@notnotype/nb-runtime/application";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";

export interface InstanceOptions {
    readonly plugins: ReadonlyArray<PluginDefinition>;
    /** 代理允许清单：可以以调用方身份转发的插件。 */
    readonly delegation?: ApplicationManifest["delegation"];
}

export class Stage {
    readonly #apps: Application[] = [];
    readonly #routers: RemoteRouter[] = [];

    /** 只在本进程里的服务端实例，不接远程。 */
    async local(options: InstanceOptions): Promise<Application> {
        return this.#start({location: "server", instanceId: "server"}, options, undefined);
    }

    /** 服务端实例与它的路由：窗口经路由连上来。 */
    async server(options: InstanceOptions): Promise<{readonly app: Application; readonly router: RemoteRouter}> {
        const node = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
        const app = await this.#start({location: "server", instanceId: "hub"}, options, node);
        const router = createRemoteRouter(node);
        this.#routers.push(router);
        return {app, router};
    }

    /** 浏览器窗口实例：先连上服务端的路由，再起运行实例。`client` 是客户端身份（同一浏览器的窗口共用）。 */
    async window(router: RemoteRouter, id: string, options: InstanceOptions & {readonly client?: string}): Promise<Application> {
        const client = options.client ?? "profile-1";
        const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}});
        const link = createLinkPair();
        router.accept(link.right);
        const connected = await node.connect(link.left);
        if (!connected.ok) throw new Error(`窗口 ${id} 连不上服务端：${connected.reason}`);
        return this.#start({location: "browser", instanceId: id, client}, options, node);
    }

    /** 逆序停止全部实例（窗口先于服务端），再关路由。 */
    async close(): Promise<ReadonlyArray<StopResult>> {
        const results: StopResult[] = [];
        for (const app of this.#apps.splice(0).reverse()) results.push(await app.stop());
        for (const router of this.#routers.splice(0)) router.close();
        return results;
    }

    async #start(identity: {readonly location: string; readonly instanceId: string; readonly client?: string}, options: InstanceOptions, remote: ApplicationManifest["remote"]): Promise<Application> {
        const app = createApplication(
            // 宿主给出的上下文：实例身份、停止来源、紧急输出。
            {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
            {plugins: options.plugins, gates: [], remote, delegation: options.delegation},
        );
        this.#apps.push(app);
        const startup = await app.startup;
        if (startup.status !== "available") throw new Error(`实例 ${identity.instanceId} 启动失败：${JSON.stringify(startup)}`);
        return app;
    }
}
