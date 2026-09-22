// @vitest-environment jsdom
/**
 * t41 追加复核的渲染容器探针（临时文件，跑完移回 Task evidences）。
 * 目标：布局两叶 max100 / 容器 500 时，分支根元素是否真的按 grid 呈现尺寸留白。
 */
import {describe, expect, it, vi} from "vitest";
import {mount} from "@vue/test-utils";
import {defineComponent} from "vue";
import {createGrid} from "@notnotype/nb-ui/components";
import WorkbenchBranch from "nbook/app/components/workbench/WorkbenchBranch.vue";

const SplitterStub = defineComponent({
    name: "Splitter",
    props: ["panels", "sashSizes", "direction"],
    emits: ["gesture-start", "gesture-end", "gesture-cancel"],
    template: "<div><slot v-for='panel in panels' :name='`panel-${panel.id}`'/></div>",
});

describe("t41 Branch 渲染容器", () => {
    it("两叶触 max 时分支根元素按 layout 呈现尺寸，留白不被拉满", () => {
        vi.stubGlobal("ResizeObserver", class {observe() {} disconnect() {}});
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "a", ref: "a", size: {width: 100, height: 0}, minimumSize: {width: 0, height: 0}, maximumSize: {width: 100, height: Number.MAX_SAFE_INTEGER}},
                {kind: "leaf", id: "b", ref: "b", size: {width: 100, height: 0}, minimumSize: {width: 0, height: 0}, maximumSize: {width: 100, height: Number.MAX_SAFE_INTEGER}},
            ],
        }, {sashSize: 0});
        const layout = grid.layout({width: 500, height: 300});
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要分支");
        const wrapper = mount(WorkbenchBranch, {
            props: {node: root, layout, onResizeBranch: () => {}},
            global: {stubs: {Splitter: SplitterStub}},
        });
        const style = (wrapper.element as HTMLElement).style;
        const splitter = wrapper.findComponent(SplitterStub);
        const evidence = {
            branchStyle: {width: style.width, height: style.height, flexShrink: style.flexShrink},
            panels: splitter.props("panels"),
            layoutSizes: layout.sizes.root,
            issues: layout.issues,
        };
        console.log(`EVIDENCE P7.branch-container ${JSON.stringify(evidence)}`);
        expect(style.width).toBe("200px");
        expect(style.height).toBe("300px");
        expect(style.flexShrink).toBe("0");
        wrapper.unmount();
        vi.unstubAllGlobals();
    });
});
