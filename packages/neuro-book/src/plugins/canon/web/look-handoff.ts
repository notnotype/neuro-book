/**
 * 人物分页的“添加立绘”交给形象分页的一次性标记（docs/specs/canon/author-ui.md 输出 49）：人物分页加上形象（或者形象已经在、
 * 还没有立绘）以后立起它、切到形象分页，形象分页挂上时读到它就打开立绘的选图，读完放倒。条目页的宿主（`EntryPageHost`）
 * 提供它；两个分页都是 canon 自己的专门界面，这条交接不进公开的 `context`（别的插件的界面用不上）。
 */
import type {InjectionKey, ShallowRef} from "vue";

export const LOOK_PICK_KEY: InjectionKey<ShallowRef<boolean>> = Symbol("canon.look-pick");
