import {describe, expect, it} from "vitest";
import {shallowRef} from "vue";

import type {GridLayerItem} from "../grid-rects";
import {useRenderOrder} from "./useRenderOrder";

/** 读屏顺序（docs/specs/ui/nested-grid.md 的“按矩形摆放”）：`aria-owns` 按树序列出，停放的内容项 `inert`，读屏本来就读不到，不进列表。 */
const item = (key: string, kind: "leaf" | "content" = "leaf") => ({key, kind}) as unknown as GridLayerItem<unknown>;

describe("useRenderOrder", () => {
    it("DOM 序与树序一致时没有 aria-owns；不一致时按树序列出，跳过停放的内容项", () => {
        const layers = shallowRef<ReadonlyArray<GridLayerItem<unknown>>>([item("leaf:a"), item("leaf:b"), item("tab:1", "content"), item("tab:2", "content")]);
        const order = useRenderOrder(layers, "grid", (candidate) => candidate.key === "tab:2");
        expect(order.items.value.map((candidate) => candidate.key)).toEqual(["leaf:a", "leaf:b", "tab:1", "tab:2"]);
        expect(order.ariaOwns.value).toBeUndefined();

        layers.value = [item("leaf:b"), item("leaf:a"), item("tab:1", "content"), item("tab:2", "content")];
        expect(order.outOfOrder.value).toBe(true);
        expect(order.ariaOwns.value).toBe(["leaf:b", "leaf:a", "tab:1"].map((key) => order.domIdOf(key)).join(" "));
    });
});
