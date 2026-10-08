/**
 * 场景用的宿主：像应用包的服务端、项目与浏览器宿主（`packages/neuro-book/src/server/`、`src/project/`、`src/web/`）
 * 那样，把各插件在本运行位置的入口装进一个运行实例。跨实例时服务端带路由，项目实例与窗口经进程内链路连上它；
 * 产品里项目实例在子进程里、经 Bun IPC 连接，窗口经 WebSocket 连接，这里帧照样经 JSON 编解码。
 *
 * `Stage` 记下它起的实例与路由，`close()` 逆序停止实例、再关路由；场景测试在 `afterEach` 里调用它，失败的用例
 * 也收口。
 */

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application, ApplicationManifest, StopResult} from "@notnotype/nb-runtime/application";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {InstanceDescriptor, RemoteLink, RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";

export interface InstanceOptions {
    readonly plugins: ReadonlyArray<PluginDefinition>;
    /** 代理允许清单：可以以调用方身份转发的插件。 */
    readonly delegation?: ApplicationManifest["delegation"];
}

/** 一个项目：代次单调递增，同一时刻至多一代在运行。 */
interface Project {
    generation: number;
    running: {readonly app: Application; readonly link: RemoteLink} | null;
}

export class Stage {
    readonly #apps: Application[] = [];
    readonly #routers: RemoteRouter[] = [];
    readonly #projects = new Map<string, Project>();

    /** 只在本进程里的服务端实例，不接远程。 */
    async local(options: InstanceOptions): Promise<Application> {
        return this.#start({location: "server", instanceId: "server"}, options, undefined);
    }

    /** 服务端实例与它的路由：项目实例与窗口经路由连上来。 */
    async server(options: InstanceOptions): Promise<{readonly app: Application; readonly router: RemoteRouter}> {
        const node = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
        const app = await this.#start({location: "server", instanceId: "hub"}, options, node);
        const router = createRemoteRouter(node, {
            // 窗口按项目名绑定到它此刻运行的那一代。应用包里由项目管理器负责（打开、租约、宽限期，见
            // packages/neuro-book/src/server/projects/）；示例只按名字找正在运行的代次，不演示租约收回。
            bindProject: async (request) => {
                const project = this.#projects.get(request.project);
                if (project === undefined || project.running === null) {
                    return {ok: false, reason: "project-unavailable", message: `项目 ${request.project} 没有打开`};
                }
                if ("generation" in request && request.generation !== project.generation) {
                    return {ok: false, reason: "project-gone", message: `项目 ${request.project} 的这一代已经结束`};
                }
                return {ok: true, binding: {id: request.project, name: request.project, generation: project.generation}, revoked: new AbortController().signal, release: () => undefined};
            },
        });
        this.#routers.push(router);
        return {app, router};
    }

    /** 起项目 `name` 的下一代实例（产品里是一个项目子进程），经路由登记。 */
    async project(router: RemoteRouter, name: string, options: InstanceOptions): Promise<Application> {
        const project = this.#projects.get(name) ?? {generation: 0, running: null};
        this.#projects.set(name, project);
        project.generation += 1;
        const descriptor: InstanceDescriptor = {id: `project:${name}#${String(project.generation)}`, kind: "project", role: "project", project: {id: name, generation: project.generation}, client: null};
        const node = createRemoteNode({instance: descriptor});
        const link = createLinkPair();
        router.accept(link.right, {expect: descriptor});
        const connected = await node.connect(link.left);
        if (!connected.ok) throw new Error(`项目 ${name} 连不上服务端：${connected.reason}`);
        const app = await this.#start({location: "project", instanceId: descriptor.id}, options, node);
        project.running = {app, link: link.left};
        return app;
    }

    /** 结束项目 `name` 正在运行的这一代：停止它的实例、断开它的链路（产品里是项目子进程退出）。 */
    async stopProject(name: string): Promise<StopResult> {
        const project = this.#projects.get(name);
        const running = project?.running ?? null;
        if (project === undefined || running === null) throw new Error(`项目 ${name} 没有在运行`);
        project.running = null;
        const result = await running.app.stop();
        running.link.close();
        return result;
    }

    /**
     * 浏览器窗口实例：先连上服务端的路由，再起运行实例。`client` 是客户端身份（同一浏览器的窗口共用）；
     * `project` 是窗口绑定的项目名（地址栏的 `/?project=`），不给时窗口不绑定项目。
     */
    async window(router: RemoteRouter, id: string, options: InstanceOptions & {readonly client?: string; readonly project?: string}): Promise<Application> {
        const client = options.client ?? "profile-1";
        const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: options.project === undefined ? null : {project: options.project}});
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
