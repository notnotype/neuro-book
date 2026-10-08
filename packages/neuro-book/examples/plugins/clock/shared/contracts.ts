/**
 * `example.clock` 对其它插件公开的合同。
 *
 * 别的插件在运行时只引用这个文件（`src/architecture.test.ts` 检查）：要用报时服务，就从这里拿服务键 `clockKey`，
 * 写进自己入口的 `dependencies`。不从 `backend/` 拿，是因为那会把 clock 的实现连同它的依赖一起拉进对方的代码，对方
 * 也会跟着 clock 的内部改动而改动。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** `until` 的结果：到点为 `ok: true`；clock 的入口停止时还没到点为 `stopped`。 */
export type UntilResult = {readonly ok: true} | {readonly ok: false; readonly code: "stopped"};

/**
 * 报时服务。它是本地服务（只在同一个实例里用），但用它的可能是第三方插件，所以按数据面的约束写：方法都返回
 * Promise，参数与结果是普通数据，失败以结构化结果返回，不抛（docs/specs/runtime/plugin-api.md 的“远程形态约束”）。
 * 这样以后插件移出宿主进程时，只换传输，不改接口。
 */
export interface ClockService {
    /** 当前时间，毫秒。 */
    now(): Promise<number>;
    /** 等到时刻 `at`（毫秒）。已经过了的时刻立即返回 `ok: true`。 */
    until(at: number): Promise<UntilResult>;
}

/**
 * 服务键。服务按 id 识别（docs/adr/0025-service-keys-by-id.md），id 写成“提供它的插件 id + `/` + 名字”，并且只在
 * 提供方的这个文件里定义一次：别处再定义同一个 id 就是同一个键，两份定义一旦写得不一样就会互相冒充。
 */
export const clockKey: ServiceKey<ClockService> = defineServiceKey<ClockService>("example.clock/clock");
