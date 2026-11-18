import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {DropSectorsOverlay} from "@notnotype/nb-layout/vue";
import {docOf, H, testPolicy} from "../layout-doc-fixtures";
import {layoutDropSectors} from "../layout-drop";

/** 工作台的落点判定算出来的分区，落点分区组件照样画得出来：组件的形状契约（id 加多边形）和判定的输出对得上。 */

const wrappers: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe("工作台的分区交给 DropSectorsOverlay", () => {
    it("每块一个多边形，id 与判定给的一致", () => {
        const geometry = {id: "a", strip: null, body: {left: 0, top: 0, right: 100, bottom: 100}};
        const sectors = layoutDropSectors({doc: docOf(H(["a", "b"], "root")), source: {kind: "tab", tab: "view:b"}, point: {x: 0, y: 0}, panels: [geometry], policy: testPolicy()}, geometry);
        if (sectors === null) throw new Error("没有分区");
        wrappers.push(mount(DropSectorsOverlay, {attachTo: document.body, props: {rect: {left: 10, top: 20, right: 610, bottom: 420}, sectors, active: null}}));
        const drawn = [...document.body.querySelectorAll("[data-drop-sector]")].map((element) => element.getAttribute("data-drop-sector")).sort();
        expect(drawn).toEqual(sectors.map((sector) => sector.id).sort());
    });
});
