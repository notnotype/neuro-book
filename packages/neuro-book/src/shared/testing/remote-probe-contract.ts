/**
 * 测试用远程服务合同：只由测试引用，产品清单与产品代码不引用它们。
 *
 * `test.remote-probe/probe`（服务端提供，浏览器测试插件与宿主合同测试调用）：
 * - `echo`（读）：返回提供方看到的调用方身份；
 * - `hold`（写）：等测试放行才返回，用来制造“已 ACK 未回复”；放行前收到终止信号会被记下；
 * - 事件 `ticks`：测试让服务端推一次，订阅方按序收到。
 *
 * `test.remote-probe/project`（项目实例提供）：
 * - `echo`（读）：返回项目实例的当前项目与提供方看到的调用方；
 * - `tick`（写）：向这个项目实例上的全部订阅推一次事件，返回推给了几个；
 * - `crash`（写）：项目子进程以给定的退出码立即退出，用来制造崩溃；
 * - `storageRead`（读）、`storageSave`（写）：项目入口以自己的身份经 `nbook.storage` 读写一条探针示例记录
 *   （`probe-storage.ts`），结果原样交回；
 * - 事件 `ticks`：同上。
 */

import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import type {PluginDescriptor} from "nbook/manifest";

import {PROBE_RECORD_NAMES, ProbeReadSchema, ProbeSaveSchema} from "./probe-storage";

/** 测试插件的描述：服务端入口提供合同，浏览器入口调用它（宿主测试入口把它加进本进程清单，引导接口才会列出它）。 */
export const remoteProbeDescriptor: PluginDescriptor = {id: "test.remote-probe", version: "0.1.0", locations: ["server", "project", "browser"]};

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
    provider: "server",
    callers: ["browser", "tui"],
    methods: {
        echo: {input: Type.Object({}, {additionalProperties: false}), output: Caller, effect: "read"},
        hold: {input: Type.Object({name: Type.String({minLength: 1})}, {additionalProperties: false}), output: Type.String(), effect: "write"},
    },
    events: {
        ticks: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Object({n: Type.Integer()}, {additionalProperties: false})},
    },
});

const Ticks = Type.Object({n: Type.Integer()}, {additionalProperties: false});
const RecordName = Type.Enum(PROBE_RECORD_NAMES);

export const projectProbeContract = defineRemoteService({
    id: "test.remote-probe/project",
    version: 1,
    provider: "project",
    callers: ["browser", "tui", "server"],
    methods: {
        echo: {
            input: Type.Object({}, {additionalProperties: false}),
            output: Type.Object({project: Type.Object({id: Type.String(), name: Type.String(), generation: Type.Integer()}, {additionalProperties: false}), caller: Caller}, {additionalProperties: false}),
            effect: "read",
        },
        tick: {input: Type.Object({}, {additionalProperties: false}), output: Type.Integer(), effect: "write"},
        crash: {input: Type.Object({code: Type.Integer({minimum: 1, maximum: 125})}, {additionalProperties: false}), output: Type.Null(), effect: "write"},
        storageRead: {input: Type.Object({name: RecordName}, {additionalProperties: false}), output: ProbeReadSchema, effect: "read"},
        storageSave: {
            input: Type.Object({name: RecordName, text: Type.String(), expect: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false}),
            output: ProbeSaveSchema,
            effect: "write",
        },
    },
    events: {
        ticks: {filter: Type.Object({}, {additionalProperties: false}), payload: Ticks},
    },
});
