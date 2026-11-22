/**
 * 一张详情的外壳给里面的东西（docs/specs/story/viewer.md 输出 67、68）：
 *
 * - `DETAIL_SCOPE`：两张并排时卡片的菜单里有“与另一张对调”，键盘与读屏用户不用拖。外壳之外（平板与手机的浮层）没有提供，
 *   读的地方按“没有另一张”处理。
 * - `scopeSession`：卡片里的链接换它所在的那张。
 */

import type {InjectionKey, Ref} from "vue";

import type {BookSession} from "./book";
import type {Tab} from "./details";

export interface DetailScope {
    /** 此刻并排着两张。 */
    readonly paired: Readonly<Ref<boolean>>;
    /** 与另一张对调（这一张成为最近点过的）。 */
    swap(): void;
}

export const DETAIL_SCOPE: InjectionKey<DetailScope> = Symbol("nb-story detail scope");

/**
 * 一张详情里的会话（输出 67：卡片里的链接换它所在的那张）。外壳把它 `provide` 成 `BOOK_SESSION`，卡片里的入口都不用知道自己在哪一张。
 *
 * 原型是会话本身：`info` 这类 getter 每次现读（展开语法会把它们求值成那一刻的旧值），没覆盖的成员原样是会话的。只覆盖换哪一张
 * （打开到 `{key}`，不按“最近点过的”：要先取新数据的打开回来时，最近的那张可能已经换了）与关哪一张（`close`）。
 * `key` 在建的时候定下：一个外壳只对应一张详情，换成别的内容时宿主换 `key`、换外壳。
 */
export function scopeSession(session: BookSession, key: number, close: () => void): BookSession {
    return Object.create(session, {
        openCard: {value: (entity: string, tab?: Tab) => session.openDetail(tab === undefined ? {kind: "card", entity} : {kind: "card", entity, tab}, {key})},
        openSource: {value: (ref: string) => session.openDetail({kind: "source", ref}, {key})},
        openParagraph: {value: (chapter: number, paragraph: number) => session.openDetail({kind: "para", chapter, paragraph}, {key})},
        openNode: {value: (id: string, label: string) => session.openDetail({kind: "node", id, label}, {key})},
        closeDrawer: {value: close},
    }) as BookSession;
}
