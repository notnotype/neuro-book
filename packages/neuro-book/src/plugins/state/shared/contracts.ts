/**
 * `nbook.state` 对其它插件公开的合同：贡献点 `state.public` 的声明与实现、读取服务。行为见
 * [`state.public`](../../../../../../docs/specs/state/public-state.md)。
 *
 * 其它插件在运行时只引用本文件；插件作者通常经 `nbook/shared/store/public` 的 `definePublicState` 与 store 的
 * `publish` 使用它，不直接写贡献。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {LocalizedText} from "nbook/shared/localized-text";

/** 贡献点 id：贡献 id 写限定名 `<插件 id>/<名>`。 */
export const PUBLIC_STATE_POINT = "state.public";

export type PublicStateValue = boolean | string | number;

/** 公开键的声明。`unready` 是没有可用绑定时读到的值；`reason` 只给布尔键，是值不为 true 时给用户看的原因。 */
export type PublicStateDeclaration =
    | {readonly type: "boolean"; readonly unready: boolean; readonly reason?: LocalizedText}
    | {readonly type: "string"; readonly unready: string}
    | {readonly type: "number"; readonly unready: number};

/**
 * 入口激活时交给贡献点的实现。“未绑定”是明确告诉 `nbook.state` 这一代不给值：内核要求已接受的入口贡献都给出
 * 实现，用它把“声明了却没绑定”与“读到的值恰好等于 unready”分开。
 */
export type PublicStateBinding = {readonly kind: "bound"; read(): PublicStateValue} | {readonly kind: "unbound"};

export type PublicStateRead =
    | {readonly status: "ready"; readonly value: PublicStateValue}
    | {readonly status: "unready"; readonly value: PublicStateValue}
    | {readonly status: "undeclared"};

/**
 * 本实例的公开状态：同步、不失败；在 `@vue/reactivity` 的 computed 或 effect 里读，绑定与值的变化都会使它重新求值。
 *
 * 同步读取按选用规则只限内置插件之间使用；第三方插件声明公开键不受影响，读取的异步写法随第三方插件 API 设计
 * （docs/specs/state/public-state.md）。
 */
export interface PublicStateService {
    read(key: string): PublicStateRead;
    /** 本运行位置入口声明、此刻已接受的声明；没有为 null。 */
    declaration(key: string): PublicStateDeclaration | null;
}

export const publicStateKey: ServiceKey<PublicStateService> = defineServiceKey<PublicStateService>("nbook.state/public");
