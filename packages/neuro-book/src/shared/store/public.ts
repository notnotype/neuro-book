/**
 * 公开键只声明一次（docs/specs/state/store.md、state/public-state.md）：`definePublicState` 的结果既写进插件定义的
 * 入口贡献，也交给 store 的 `publish` 绑定，名字与类型由编译器在两处核对。声明是否合规则由 `nbook.state` 的贡献点
 * 在登记时校验，这里不重复校验：第三方插件以后以清单 JSON 声明，走的是同一条校验。
 */

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";

import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import type {PublicStateBinding, PublicStateDeclaration} from "nbook/plugins/state/shared/contracts";

export type PublicDeclarations = Readonly<Record<string, PublicStateDeclaration>>;

export interface PublicState<D extends PublicDeclarations> {
    readonly plugin: string;
    readonly declarations: D;
    /** 写进插件定义的入口：`contributions: [...state.contributions]`。 */
    readonly contributions: ReadonlyArray<ContributionDeclaration<PublicStateDeclaration>>;
    /** 名对应的限定名 `<插件 id>/<名>`。 */
    key(name: keyof D & string): string;
}

type ValueOf<Declaration> = Declaration extends {readonly type: "boolean"} ? boolean : Declaration extends {readonly type: "string"} ? string : number;

/** `ref` 与 `computed` 都满足：只读 `value`。 */
export interface ReadableValue<T> {
    readonly value: T;
}

/** 与声明逐键对应：漏绑、多绑（对象字面量）与类型不符编译不过。 */
export type PublicBindings<D extends PublicDeclarations> = {readonly [K in keyof D]: ReadableValue<ValueOf<D[K]>>};

export function definePublicState<const D extends PublicDeclarations>(plugin: string, declarations: D): PublicState<D> {
    const key = (name: string): string => `${plugin}/${name}`;
    return {
        plugin,
        declarations,
        contributions: Object.entries(declarations).map(([name, declaration]) => ({capability: PUBLIC_STATE_POINT, id: key(name), declaration})),
        key,
    };
}

/** 一次 `publish` 交出的绑定，按限定名排好；多出的名字留给调用方记诊断。 */
export interface PublishedBindings {
    readonly bindings: ReadonlyMap<string, PublicStateBinding>;
    readonly extra: ReadonlyArray<string>;
}

/**
 * 把绑定换成贡献点要的实现。运行时仍按声明核对一遍（给绕过类型检查的调用方）：声明里有、绑定没给的交“未绑定”，
 * 绑定里多出的不交。
 */
export function bindingsOf<D extends PublicDeclarations>(state: PublicState<D>, bindings: PublicBindings<D>): PublishedBindings {
    const given = bindings as Readonly<Record<string, ReadableValue<unknown> | undefined>>;
    const result = new Map<string, PublicStateBinding>();
    for (const name of Object.keys(state.declarations)) {
        const binding = given[name];
        result.set(state.key(name), binding === undefined ? {kind: "unbound"} : {kind: "bound", read: () => binding.value as boolean | string | number});
    }
    return {bindings: result, extra: Object.keys(given).filter((name) => !(name in state.declarations))};
}
