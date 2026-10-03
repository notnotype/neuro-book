// @vitest-environment jsdom
import {createApp} from "vue";
import type {App} from "vue";
import {afterEach, describe, expect, it} from "vitest";
import HighlightBox from "./HighlightBox.vue";

const mounted: App[] = [];

function mountHighlight(showBox?: boolean): HTMLElement {
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(HighlightBox, {
        rect: {top: 10, left: 20, width: 200, height: 80},
        label: "div.lab-panel  200 × 80",
        ...(showBox === undefined ? {} : {showBox}),
    });
    mounted.push(app);
    app.mount(host);
    return host;
}

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
});

describe("HighlightBox", () => {
    it("默认同时显示矩形框与标签", () => {
        const host = mountHighlight();

        expect(host.querySelector(".nb-lab-highlight-box")).not.toBeNull();
        expect(host.querySelector(".nb-lab-highlight-label")?.textContent).toContain("div.lab-panel");
    });

    it("showBox=false 时只显示标签", () => {
        const host = mountHighlight(false);

        expect(host.querySelector(".nb-lab-highlight-box")).toBeNull();
        expect(host.querySelector(".nb-lab-highlight-label")?.textContent).toContain("div.lab-panel");
    });
});
