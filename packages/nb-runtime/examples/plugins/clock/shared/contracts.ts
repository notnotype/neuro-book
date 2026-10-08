/**
 * `example.clock` 对其它插件公开的合同。别的插件在运行时只引用这个文件（docs/adr/0025-service-keys-by-id.md）：
 * 服务键按服务 id 识别，只在这里定义一次。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export interface ClockService {
    /** 当前时间，毫秒。 */
    now(): number;
}

/** 服务 id 以提供它的插件 id 加 `/` 开头。 */
export const clockKey: ServiceKey<ClockService> = defineServiceKey<ClockService>("example.clock/clock");
