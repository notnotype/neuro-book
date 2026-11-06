/**
 * 主题编辑器的会话（docs/specs/theme/editor.md 输出 1）：编辑器有页签和浮动窗口两种放法，同一时刻只有一份模型。谁挂载谁 `acquire`，
 * 卸载时 `release`；第一个 `acquire` 建模型（预览随之开始），最后一个 `release` 释放（预览清掉、文档根回到设置里选的主题）。
 */

import {effectScope, shallowRef} from "vue";
import type {EffectScope} from "vue";

import {ThemeEditorModel} from "./theme-editor-model";
import type {Appearance, ThemeEditorEnvironment} from "./theme-editor-model";

type BaseColors = ThemeEditorEnvironment["baseColors"];

export class ThemeEditorSession {
    /** 浮动窗口开着没有。页签是否开着由编辑区管，这里不记。 */
    readonly floating = shallowRef(false);
    readonly #env: Omit<ThemeEditorEnvironment, "baseColors">;
    /** 主题包的缺省配色来自 `ui/theme/product-themes`，它装载整套主题包，不能进首屏：编辑器第一次加载时才交进来。 */
    #baseColors: BaseColors = () => ({});
    #scope: EffectScope | null = null;
    #model: ThemeEditorModel | null = null;
    #holders = 0;

    constructor(env: Omit<ThemeEditorEnvironment, "baseColors">) {
        this.#env = env;
    }

    provideBaseColors(source: BaseColors): void {
        this.#baseColors = source;
    }

    acquire(): ThemeEditorModel {
        this.#holders += 1;
        if (this.#model === null) {
            this.#scope = effectScope(true);
            this.#model = this.#scope.run(() => new ThemeEditorModel({...this.#env, baseColors: (base: string, appearance: Appearance) => this.#baseColors(base, appearance)})) ?? null;
        }
        if (this.#model === null) throw new Error("主题编辑器的模型没有建起来");
        return this.#model;
    }

    release(): void {
        this.#holders = Math.max(0, this.#holders - 1);
        if (this.#holders > 0) return;
        this.#scope?.stop();
        this.#scope = null;
        this.#model = null;
    }

    /** 本窗口的入口停止时调用：不管还有没有人挂着，预览都要清掉。 */
    dispose(): void {
        this.#holders = 0;
        this.#scope?.stop();
        this.#scope = null;
        this.#model = null;
        this.floating.value = false;
    }
}
