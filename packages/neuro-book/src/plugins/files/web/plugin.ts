/**
 * `nbook.files` 的浏览器入口：按调用方提供文件客户端 `filesKey`（docs/specs/workspace/resources.md）。不启动即激活：
 * 第一个依赖它的入口（资源管理器、编辑器）激活时才激活。
 */

import {defineEntry, providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {filesKey, projectFilesContract, userFilesContract} from "../shared/contracts";
import {createFilesClient} from "./client";

export const filesBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        provides: [filesKey],
        // 以原调用方的身份调用两份合同：提供者看到的是用文件客户端的插件，据此确定写入来源。
        remoteDelegates: [projectFilesContract, userFilesContract],
        activate: (context) => ({services: [providePerConsumer(filesKey, (consumer) => createFilesClient(context.remote, consumer))]}),
    })],
};
