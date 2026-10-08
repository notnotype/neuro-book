/**
 * `example.counter` 两端共用的合同：服务端入口与浏览器入口之间的远程服务，以及浏览器入口交给窗口里其它插件的
 * 本地服务。远程服务是本插件两端之间的协议；别的插件用本地服务，不直接调远程合同。
 */

import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/**
 * 两端共用同一份合同：提供方按 schema 校验输入与输出，调用方再核对一次输出。合同 id 以插件 id 加 `/` 开头；
 * `provider` 是提供方的运行位置，`callers` 是允许调用的运行位置。
 */
export const counterContract = defineRemoteService({
    id: "example.counter/remote",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        increment: {input: Type.Object({by: Type.Integer({minimum: 1})}, {additionalProperties: false}), output: Type.Integer(), effect: "write"},
        current: {input: Type.Object({}, {additionalProperties: false}), output: Type.Integer(), effect: "read"},
    },
    events: {
        changed: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Integer()},
    },
});

/** 窗口里的插件用的计数器。远程调用不抛异常，失败以失败码返回（例如断线、输入不合合同）。 */
export interface CounterService {
    increment(by: number): Promise<RemoteResult<number>>;
    current(): Promise<RemoteResult<number>>;
    /** 订阅变化；返回的句柄释放订阅。本入口停止或连接结束时订阅随之结束。 */
    watch(listener: (value: number) => void): Promise<RemoteResult<{release(): void}>>;
}

export const counterKey: ServiceKey<CounterService> = defineServiceKey<CounterService>("example.counter/counter");
