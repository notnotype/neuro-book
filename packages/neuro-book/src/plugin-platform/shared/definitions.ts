/**
 * 三处宿主（服务端、项目实例、窗口）共用的插件定义登记：内置插件按代码定义、第三方插件按清单在本位置登记什么
 * （docs/specs/runtime/plugin-manifest.md 输出 11，plugin-code-loading.md 输出 1、2）。与应用无关，应用的产品清单
 * （`src/manifest.ts`）再导出 `pluginsAt` 与 `definitionAt`。
 */

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import {definitionOf, descriptorOf} from "@notnotype/nb-runtime/plugin-manifest";
import type {ManifestEntry, PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import type {ActivationContext, PluginDefinition, PluginDescriptor, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteContract} from "@notnotype/nb-runtime/remote";

/**
 * 在某个运行位置登记的插件：本位置有入口的，加上描述里有顶层声明式贡献的（runtime/plugin-manifest.md 输出 11）。
 * 只有浏览器入口的工作台声明的设置项，服务端也要知道，才能校验用户的设置文件。三个宿主的装配与浏览器引导都按它取集合。
 */
export function pluginsAt(location: RuntimeLocation, descriptors: ReadonlyArray<PluginDescriptor>): PluginDescriptor[] {
    return descriptors.filter((descriptor) => descriptor.locations.includes(location) || (descriptor.contributions ?? []).length > 0);
}

/**
 * 一个插件在本位置登记的定义：描述写了本位置时必须有定义（`definition`），并上描述的顶层贡献；没写时只登记顶层
 * 贡献（`entries` 为空）。描述写了本位置却没有定义、或定义的 id 不符，直接失败，不静默少装。
 */
export function definitionAt(location: RuntimeLocation, descriptor: PluginDescriptor, definition: PluginDefinition | undefined): PluginDefinition {
    const contributions = descriptor.contributions ?? [];
    // 版本只用于核对别的插件写的 `pluginVersions`（plugin-manifest.md 输出 8），从描述并入，各位置的定义不另写。
    // 描述里的贡献点只给本位置没有入口时用（入口定义自己写着）：别的位置也要认识这些顶层贡献。
    const points = descriptor.contributionPoints ?? [];
    if (!descriptor.locations.includes(location)) return {id: descriptor.id, version: descriptor.version, entries: [], contributions, ...(points.length === 0 ? {} : {contributionPoints: points})};
    if (definition === undefined) throw new Error(`清单中的插件 ${descriptor.id} 没有 ${location} 入口定义`);
    if (definition.id !== descriptor.id) throw new Error(`${location} 入口定义的插件 id ${definition.id} 与清单 ${descriptor.id} 不一致`);
    return {...definition, version: descriptor.version, ...(contributions.length === 0 ? {} : {contributions: [...(definition.contributions ?? []), ...contributions]})};
}

/**
 * 第三方插件在本位置登记的定义。入口代码的装载（docs/specs/runtime/plugin-code-loading.md）实现之前，只登记描述里的
 * 顶层声明式贡献，不论描述写了哪些运行位置；集合按 `pluginsAt` 取。
 */
export function thirdPartyDefinition(descriptor: PluginDescriptor): PluginDefinition {
    return {id: descriptor.id, version: descriptor.version, entries: [], contributions: descriptor.contributions ?? []};
}

/** 第三方插件一个入口这一次激活用的 `activate`：装载器取回并执行入口代码（浏览器与服务端各有一个）。 */
export type EntryLoader = (entry: ManifestEntry, context: ActivationContext) => Promise<PluginEntryDefinition["activate"]>;

/**
 * 第三方插件在本位置登记的定义（docs/specs/runtime/plugin-manifest.md 输出 11，plugin-code-loading.md 输出 1、2）：按清单
 * 登记本位置的入口与顶层声明式贡献，入口激活时经 `load` 取回代码。三处宿主（服务端、项目实例、窗口）共用。
 *
 * 远程合同：清单里的合同由 `definitionOf` 还原，插件代码产出的是它自己打包的那一份；内核按内容核对两份，相同就以登记的
 * 那份为准（runtime/plugins.md）。激活产出不是对象时同样由内核报 `activation-threw`。
 */
export function thirdPartyDefinitionAt(location: RuntimeLocation, manifest: PluginManifest, options: {readonly load: EntryLoader; readonly contractOf?: (id: string) => RemoteContract}): PluginDefinition {
    const definition = definitionOf(manifest, location, options.contractOf === undefined ? {} : {contractOf: options.contractOf});
    const entries = definition.entries.map((entry): PluginEntryDefinition => {
        const declared = manifest.entries.find((item) => item.id === entry.id && item.location === location);
        if (declared === undefined) throw new Error(`插件 ${manifest.id} 的入口 ${entry.id} 不在清单里`);
        return {
            ...entry,
            activate: async (context) => {
                const activate = await options.load(declared, context);
                return activate(context);
            },
        };
    });
    return definitionAt(location, descriptorOf(manifest), {...definition, entries});
}

/** 一个要按清单登记的第三方插件：清单与它的入口装载器（服务端经 Bun 装载、窗口经脚本装载）。 */
export interface ThirdPartySource {
    readonly manifest: PluginManifest;
    readonly load: EntryLoader;
}

export interface ThirdPartyOptions {
    /** 本位置的内置插件定义：清单引用的内置合同从这里找。 */
    readonly builtin: ReadonlyArray<PluginDefinition>;
    readonly record: (input: DiagnosticInput) => void;
    /** 登记不了时那条诊断的事件名：各宿主沿用自己的事件前缀。 */
    readonly unregistrableEvent: string;
}

/**
 * 三处宿主共用的第三方插件登记：本位置有入口或有顶层声明式贡献的（`pluginsAt`）按清单登记，入口激活时经各自的装载器
 * 取回代码。引用了本位置不认识的合同等登记不了的情况，只登记它的顶层声明并记诊断：一个插件出错不挡实例启动。
 */
export function thirdPartyDefinitionsFor(location: RuntimeLocation, sources: ReadonlyArray<ThirdPartySource>, options: ThirdPartyOptions): PluginDefinition[] {
    const contracts = new Map<string, RemoteContract>();
    for (const definition of options.builtin) {
        for (const entry of definition.entries) {
            for (const contract of [...(entry.remoteProvides ?? []), ...(entry.remoteDelegates ?? [])]) contracts.set(contract.id, contract);
        }
    }
    const definitions: PluginDefinition[] = [];
    for (const {manifest, load} of sources) {
        const descriptor = descriptorOf(manifest);
        if (pluginsAt(location, [descriptor]).length === 0) continue;
        try {
            definitions.push(thirdPartyDefinitionAt(location, manifest, {
                load,
                contractOf: (id) => {
                    const contract = contracts.get(id);
                    if (contract === undefined) throw new Error(`引用了本位置没有的合同 ${id}`);
                    return contract;
                },
            }));
        } catch (error) {
            options.record({level: "warn", event: options.unregistrableEvent, message: `第三方插件 ${manifest.id} 的入口登记不了，只登记它的顶层声明`, error, data: {plugin: manifest.id}});
            definitions.push(thirdPartyDefinition(descriptor));
        }
    }
    return definitions;
}
