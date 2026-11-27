/**
 * 此刻画出来的各层（docs/specs/agent/page-agent.md 输出 3 的“弹层各成一层”、输出 12 的 `not-found` 详情）。快照表头与定位失败的
 * 详情用同一种写法，模型看到的层名对得上。
 *
 * 层根怎么认见 `snapshot/walk.ts` 的 `enter`：dialog、alertdialog、`aria-modal` 总是，menu 与 listbox 只在弹出来时才是。这里
 * 不走一遍整棵树，只查可能是层根的元素，再用同一个 `enter` 的结果判断。
 */

import {LAYER_LIMIT} from "./api";
import {deepQueryAll} from "./dom";
import type {Inspector} from "./inspect";
import {quote} from "./text";

export interface PageLayer {
    /** 层根；`base` 是 null。 */
    readonly root: Element | null;
    readonly label: string;
}

const LAYER_NAME_CHARS = 40;
/** 可能是层根的元素；是不是由 `enter` 判断（menu 与 listbox 要弹出来才算）。 */
const LAYER_CANDIDATES = "dialog, [role=\"dialog\"], [role=\"alertdialog\"], [aria-modal=\"true\"], [role=\"menu\"], [role=\"listbox\"]";

/** 层的写法：`base`，或角色加名字（例如 `dialog "设置"`）。 */
export function layerLabel(inspector: Inspector, root: Element | null): string {
    if (root === null) return "base";
    const name = inspector.name(root);
    return `${inspector.role(root) ?? root.localName}${name === "" ? "" : ` ${quote(name, LAYER_NAME_CHARS)}`}`;
}

/** `base` 在前，弹层按组合树的先后（后打开的通常在后）；至多 `LAYER_LIMIT` 层，超出时留 `base` 与最上面的几层。 */
export function currentLayers(inspector: Inspector): PageLayer[] {
    const roots = deepQueryAll(inspector.document, LAYER_CANDIDATES)
        .filter((element) => inspector.entered(element)?.layerRoot === true && inspector.isRendered(element));
    const kept = roots.length < LAYER_LIMIT ? roots : roots.slice(roots.length - (LAYER_LIMIT - 1));
    return [{root: null, label: "base"}, ...kept.map((root) => ({root, label: layerLabel(inspector, root)}))];
}
