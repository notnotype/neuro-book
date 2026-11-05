/**
 * 在真实的项目子进程里测 canon 与建在它上面的插件（canon.test.ts 与剧情插件的远程用例共用）：服务端实例、路由与项目管理器是
 * 真实的，窗口是本进程里的浏览器内核实例，装 `nbook.canon` 的浏览器入口，经进程内链路绑定项目。只由测试用。
 */

import {expect} from "bun:test";

import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import type {RemoteNode} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import type {WriteRequest} from "@notnotype/nb-canon";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createApplication} from "nbook/application";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {windowProjectKey} from "nbook/shared/projects";

import {canonClientKey} from "../shared/contracts";
import type {CanonClient} from "../shared/contracts";
import {canonBrowserPlugin} from "../web/plugin";

export function serverPlugins(): PluginDefinition[] {
    const silent = {error: () => undefined};
    return [createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)})];
}

export interface TestWindow {
    readonly canon: CanonClient;
    /** 窗口的远程节点：别的插件的远程合同经它调。 */
    readonly node: RemoteNode;
    /** 断开窗口的链路（不停窗口实例）。 */
    disconnect(): void;
    close(): Promise<void>;
}

/** 绑定 `book` 的窗口：浏览器内核实例，装 `nbook.canon` 的浏览器入口与一个用世界客户端的插件。 */
export async function windowOf(h: ProjectHarness, id: string, client: string): Promise<TestWindow> {
    let canon: CanonClient | null = null;
    const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: {project: "book"}});
    const pair = createLinkPair();
    h.router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    const binding = node.binding!;
    const app = createApplication(
        {identity: {location: "browser", instanceId: id, client}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: {id: binding.id, name: binding.name, generation: binding.generation}})}],
            plugins: [
                canonBrowserPlugin,
                {id: "app.writer", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: canonClientKey}], activate: (context) => {
                    canon = context.services.require(canonClientKey);
                    return {};
                }}]},
            ],
            gates: [],
            remote: node,
        },
    );
    expect(await app.startup).toMatchObject({status: "available", failures: []});
    return {
        canon: canon!,
        node,
        disconnect: () => pair.left.close(),
        close: async () => {
            await app.stop();
            pair.left.close();
        },
    };
}

/** 等一个异步才成立的条件（目录监视、事件推送）；10 秒内不成立就失败。 */
export async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
    await waitUntil("等待的条件成立", condition, {timeoutMs: 10_000, intervalMs: 20});
}

export async function version(canon: CanonClient): Promise<number> {
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error(JSON.stringify(status.failure));
    return status.value.version;
}

export async function publish(canon: CanonClient, request: WriteRequest, token?: string) {
    return canon.publish({...request, baseVersion: await version(canon)}, token);
}

