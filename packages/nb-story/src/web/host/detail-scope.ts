/**
 * 一张详情的外壳给里面的东西（docs/specs/story/viewer.md 输出 68）：两张并排时卡片的菜单里有“与另一张对调”，键盘与读屏用户不用拖。
 * 外壳之外（平板与手机的浮层）没有提供，读的地方按“没有另一张”处理。
 */

import type {InjectionKey, Ref} from "vue";

export interface DetailScope {
    /** 此刻并排着两张。 */
    readonly paired: Readonly<Ref<boolean>>;
    /** 与另一张对调（这一张成为最近点过的）。 */
    swap(): void;
}

export const DETAIL_SCOPE: InjectionKey<DetailScope> = Symbol("nb-story detail scope");
