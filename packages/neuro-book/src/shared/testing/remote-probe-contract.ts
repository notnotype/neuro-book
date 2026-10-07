/**
 * 测试用远程服务合同 `test.remote-probe/probe`：服务端测试插件提供，浏览器测试插件与宿主合同测试调用。
 * 只由测试引用，产品清单与产品代码不引用它。
 *
 * - `echo`（读）：返回提供方看到的调用方身份；
 * - `hold`（写）：等测试放行才返回，用来制造“已派发未回复”；放行前收到终止信号会被记下；
 * - 事件 `ticks`：测试让服务端推一次，订阅方按序收到。
 */

import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import type {PluginDescriptor} from "nbook/manifest";

/** 测试插件的描述：服务端入口提供合同，浏览器入口调用它（宿主测试入口把它加进本进程清单，引导接口才会列出它）。 */
export const remoteProbeDescriptor: PluginDescriptor = {id: "test.remote-probe", version: "0.1.0", locations: ["server", "browser"]};

const Caller = Type.Object({
    instanceId: Type.String(),
    location: Type.String(),
    plugin: Type.Union([Type.String(), Type.Null()]),
    entry: Type.Union([Type.String(), Type.Null()]),
    generation: Type.Union([Type.Integer(), Type.Null()]),
}, {additionalProperties: false});

export const remoteProbeContract = defineRemoteService({
    id: "test.remote-probe/probe",
    version: 1,
    callers: ["browser", "tui"],
    methods: {
        echo: {input: Type.Object({}, {additionalProperties: false}), output: Caller, effect: "read"},
        hold: {input: Type.Object({name: Type.String({minLength: 1})}, {additionalProperties: false}), output: Type.String(), effect: "write"},
    },
    events: {
        ticks: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Object({n: Type.Integer()}, {additionalProperties: false})},
    },
});
