/**
 * 主题编辑器的会话（docs/specs/theme/editor.md 输出 1）：编辑器有页签和浮动窗口两种放法，同一时刻只有一份模型。谁挂载谁 `acquire`，
 * 卸载时 `release`；第一个 `acquire` 建模型（预览随之开始），最后一个 `release` 释放（预览清掉、文档根回到设置里选的主题）。
 *
 * 编辑状态（选中的主题、明暗、分区）放在会话里、不随模型释放：编辑区只挂载当前页签，切去看别的文件再切回来时，编辑的还是同一套、
 * 同一个明暗、同一个分区；只是切走期间预览暂停（文档根回到设置里选的主题）。模型的类只以类型引用：它与颜色算法不进首屏，由持有者在
 * 编辑器打开时才带进来。
 */

import {effectScope, shallowRef} from "vue";
import type {EffectScope} from "vue";

import type {ThemeEntry} from "../../themes";
import {createEditorState} from "./editor-state";
import type {Appearance, ThemeEditorState} from "./editor-state";
import type {ThemeEditorEnvironment, ThemeEditorModel} from "./theme-editor-model";

type BaseColors = ThemeEditorEnvironment["baseColors"];
type SessionEnvironment = Omit<ThemeEditorEnvironment, "baseColors">;

export class ThemeEditorSession {
    /** 浮动窗口开着没有。页签是否开着由编辑区管，这里不记。 */
    readonly floating = shallowRef(false);
    readonly #env: SessionEnvironment;
    /** 主题包的缺省配色来自 `ui/theme/product-themes`，它装载整套主题包，不能进首屏：编辑器第一次加载时才交进来。 */
    #baseColors: BaseColors = () => ({});
    #state: ThemeEditorState | null = null;
    #scope: EffectScope | null = null;
    #model: ThemeEditorModel | null = null;
    #holders = 0;

    constructor(env: SessionEnvironment) {
        this.#env = env;
    }

    /** 一个主题的场景图地址（复制插件主题时要把图读出来）。 */
    sceneUrl(entry: ThemeEntry, appearance: Appearance): string | null {
        return this.#env.catalog.sceneUrl(entry, appearance);
    }

    provideBaseColors(source: BaseColors): void {
        this.#baseColors = source;
    }

    /** 取模型；第一个持有者来时用 `create` 建。`create` 由持有者给，模型的类才不用进首屏。 */
    acquire(create: (env: ThemeEditorEnvironment, state: ThemeEditorState) => ThemeEditorModel): ThemeEditorModel {
        this.#holders += 1;
        if (this.#model === null) {
            this.#state ??= createEditorState(this.#env.currentAppearance());
            const state = this.#state;
            this.#scope = effectScope(true);
            this.#model = this.#scope.run(() => create({...this.#env, baseColors: (base: string, appearance: Appearance) => this.#baseColors(base, appearance)}, state)) ?? null;
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

    /** 本窗口的入口停止时调用：不管还有没有人挂着，预览都要清掉，编辑状态也丢。 */
    dispose(): void {
        this.#holders = 0;
        this.#scope?.stop();
        this.#scope = null;
        this.#model = null;
        this.#state = null;
        this.floating.value = false;
    }
}
