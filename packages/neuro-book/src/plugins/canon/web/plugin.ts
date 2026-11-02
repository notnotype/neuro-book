/**
 * `nbook.canon` 的浏览器入口：不存世界，按调用方提供世界客户端，以调用方的身份经远程服务转给本窗口绑定的项目实例
 * （docs/specs/canon/project.md 输出 1）。没有绑定项目的窗口调用得到 `no-project`。
 */

import {defineEntry, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {windowProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {componentsPoint} from "../shared/components";
import {canonClientKey, canonWorldContract} from "../shared/contracts";
import {createCanonClient} from "./client";

export const canonBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    // 贡献点在每个有本插件的实例里都定义：内置类型是顶层声明，各实例都登记它们（plugin-manifest.md 输出 11）。
    contributionPoints: [componentsPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        dependencies: [{key: windowProjectKey}],
        provides: [canonClientKey],
        remoteDelegates: [canonWorldContract],
        activate: (context) => {
            const bound = context.services.require(windowProjectKey).project !== null;
            return {services: [provideServicePerConsumer(canonClientKey, (consumer) => createCanonClient(bound ? () => context.remote.on(consumer) : null))]};
        },
    })],
};
