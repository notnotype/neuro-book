/** 状态片：扩展记住的东西，全部由日志归约而来（docs/specs/harness/extensions.md）。 */

import type {DeepReadonly, Scope} from "./basics.js";

export interface Slice<S extends Scope, T> {
    readonly scope: S;
    readonly initial: T;
    /** 压缩时回到初值：用于“告诉过模型什么”这类片（压缩后摘要未必还记得）。 */
    readonly resetOnCompaction: boolean;
}
export type StateDecl = Record<string, Slice<Scope, any>>;

export type SliceValue<S> = S extends Slice<Scope, infer T> ? T : never;
export type StateValues<S extends StateDecl> = {readonly [k in keyof S]: DeepReadonly<SliceValue<S[k]>>};
/** 某个作用域的片：path 事件的归约只拿到、只能改 path 的片，session 同理。 */
export type SlicesIn<S extends StateDecl, Sc extends Scope> = {readonly [k in keyof S as S[k] extends Slice<Sc, any> ? k : never]: DeepReadonly<SliceValue<S[k]>>};
export type PatchIn<S extends StateDecl, Sc extends Scope> = {[k in keyof S as S[k] extends Slice<Sc, any> ? k : never]?: SliceValue<S[k]>};

/** `slice.path` 跟着对话路径走，回退时跟着回去；`slice.session` 在树外。 */
export interface SliceFactory {
    path<T>(initial: T, options?: {resetOnCompaction?: boolean}): Slice<"path", T>;
    session<T>(initial: T): Slice<"session", T>;
}
