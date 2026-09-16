// t39 审查探针 F：panel DOM id 是文档级全局身份。
// 复现：复制到 packages/nb-ui/src/components/layout/ 后运行
//   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-panel-dom-id.test.ts --disable-console-intercept
// 观察点：两个实例渲染出相同的 id；Reka 的 aria-controls 也指向这同一个 id。
import {afterEach, describe, it} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";

const PANELS: SplitterPanelConfig[] = [
    {id: "outline", defaultSize: 28},
    {id: "editor", defaultSize: 52},
    {id: "inspector", defaultSize: 20},
];

const containers: HTMLElement[] = [];

function attachContainer(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
}

function mountSplitter(): VueWrapper {
    return mount(Splitter, {attachTo: attachContainer(), props: {panels: PANELS}});
}

afterEach(() => {
    for (const container of containers.splice(0)) container.remove();
});

describe("探针 F：面板稳定身份的可见范围", () => {
    it("两个实例同时挂载时的 DOM id 与 aria-controls", async () => {
        const first = mountSplitter();
        const second = mountSplitter();
        await nextTick();
        console.log("F first ids", JSON.stringify(first.findAll("[data-panel]").map((panel) => (panel.element as HTMLElement).id)));
        console.log("F second ids", JSON.stringify(second.findAll("[data-panel]").map((panel) => (panel.element as HTMLElement).id)));
        console.log("F duplicate #outline count", document.querySelectorAll("#outline").length);
        console.log("F aria-controls", JSON.stringify(first.findAll("[role=separator]").map((sash) => sash.attributes("aria-controls"))));
    });
});
