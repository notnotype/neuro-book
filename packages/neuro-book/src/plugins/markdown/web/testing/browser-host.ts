/**
 * 组件测试里的真实内核浏览器实例：拥有者用与 `nbook.markdown` 浏览器定义同样的贡献点与内置声明，方言目录是产品的
 * `SyntaxCatalog`；给的测试方言插件照常登记与交付。组件拿到的目录与产品里 `nbook.markdown` 交组件时给的是同一种。
 */

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createApplication} from "nbook/application";

import {descriptor} from "../../plugin";
import {MARKDOWN_SYNTAXES_POINT, validateSyntaxContribution} from "../../shared/contracts";
import {dialectsPoint} from "../../shared/plugin";
import {SyntaxCatalog} from "../syntax-catalog";
import type {InactiveCode} from "../syntax-catalog";

export interface MarkdownBrowserHost {
    readonly application: Application;
    readonly catalog: SyntaxCatalog;
    /** 目录记下的不生效。 */
    readonly inactive: ReadonlyArray<{readonly id: string; readonly code: InactiveCode}>;
}

const silent = {error: () => undefined};

/** 起实例并等启动完成；调用方负责 `application.stop()`。 */
export async function startMarkdownBrowserHost(plugins: ReadonlyArray<PluginDefinition>, instanceId = "markdown-host"): Promise<MarkdownBrowserHost> {
    let catalog: SyntaxCatalog | null = null;
    const inactive: Array<{readonly id: string; readonly code: InactiveCode}> = [];
    const owner: PluginDefinition = {
        id: descriptor.id,
        contributionPoints: [dialectsPoint, {id: MARKDOWN_SYNTAXES_POINT, implementation: "required", validate: validateSyntaxContribution}],
        contributions: descriptor.contributions ?? [],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            receives: [MARKDOWN_SYNTAXES_POINT],
            activate: (context) => {
                catalog = new SyntaxCatalog(context.declarations, (id, code) => inactive.push({id, code}));
                return {receivers: {[MARKDOWN_SYNTAXES_POINT]: catalog.receiver()}};
            },
        }],
    };
    const identity = {location: "browser" as const, instanceId};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: [], plugins: [diagnostics, owner, ...plugins], requiredPlugins: [diagnostics.id, descriptor.id], gates: []},
    );
    await application.startup;
    const ready = catalog as SyntaxCatalog | null;
    if (ready === null) throw new Error("拥有者没有激活");
    return {application, catalog: ready, inactive};
}
