import {Button} from "@notnotype/nb-ui/components";
import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";

import {
    describeNode,
    extractDirectText,
    extractKeyAttributes,
    extractSnippet,
    isSemanticClass,
    isTransientClass,
    nodeReport,
    shortenFile,
    vueOwner,
} from "./inspect";

describe("inspect", () => {
    describe("shortenFile", () => {
        it("shortens absolute path to package relative path", () => {
            expect(shortenFile("C:/repo/packages/nb-ui/src/components/form/FormSelect.vue"))
                .toBe("packages/nb-ui/src/components/form/FormSelect.vue");
            expect(shortenFile("/usr/local/repo/packages/neuro-book/src/plugins/lab/web/LabShell.vue"))
                .toBe("packages/neuro-book/src/plugins/lab/web/LabShell.vue");
            expect(shortenFile("")).toBe("");
        });
    });

    describe("isTransientClass & isSemanticClass", () => {
        it("identifies and filters transient inspecting classes", () => {
            expect(isTransientClass("lab-root--inspecting")).toBe(true);
            expect(isTransientClass("lab-picked-marker")).toBe(true);
            expect(isTransientClass("lab-highlight-box")).toBe(true);
            expect(isTransientClass("lab-bar")).toBe(false);

            expect(isSemanticClass("lab-root--inspecting")).toBe(false);
        });

        it("recognizes semantic prefixes and BEM classes while filtering Tailwind utility classes", () => {
            // 语义类名
            expect(isSemanticClass("lab-bar")).toBe(true);
            expect(isSemanticClass("lab-bar--tight")).toBe(true);
            expect(isSemanticClass("desktop-title-bar__leading")).toBe(true);
            expect(isSemanticClass("desktop-title-bar__menus-root")).toBe(true);
            expect(isSemanticClass("agent-composer-input")).toBe(true);
            expect(isSemanticClass("workbench-view")).toBe(true);
            expect(isSemanticClass("nb-ui-control")).toBe(true);

            // 原子类
            expect(isSemanticClass("flex")).toBe(false);
            expect(isSemanticClass("shrink-0")).toBe(false);
            expect(isSemanticClass("items-center")).toBe(false);
            expect(isSemanticClass("p-4")).toBe(false);
            expect(isSemanticClass("text-xs")).toBe(false);
            expect(isSemanticClass("bg-slate-100")).toBe(false);
            expect(isSemanticClass("hover:bg-blue-500")).toBe(false);
            expect(isSemanticClass("h-[32px]")).toBe(false);
        });
    });

    describe("vueOwner：真实挂载的组件", () => {
        // 组件名与源文件取自 Vue 开发构建在实例上留下的信息（`type.__name`、`type.__file`），所以挂载真实组件来测。
        it("通用控件（nb-ui Button）报自己的源文件，宿主报外层的业务组件", () => {
            const Toolbar = defineComponent({name: "AgentComposerToolbar", setup: () => () => h(Button, {"data-probe": ""}, () => "发送")});
            const wrapper = mount(Toolbar);
            const owner = vueOwner(wrapper.get("[data-probe]").element);
            expect(owner.name).toBe("Button");
            expect(owner.file.endsWith("nb-ui/src/components/controls/Button.vue")).toBe(true);
            expect(owner.hostName).toBe("AgentComposerToolbar");
            wrapper.unmount();
        });

        it("不在组件里的节点报空名字", () => {
            const owner = vueOwner(document.createElement("div"));
            expect(owner).toEqual({name: "", file: "", hostName: "", hostFile: ""});
        });
    });

    describe("describeNode & subject scoping", () => {
        it("scopes selector to [data-lab-subject] without outer lab-root pollution", () => {
            const root = document.createElement("div");
            root.className = "lab-root lab-root--inspecting";

            const main = document.createElement("main");
            main.className = "lab-main";
            root.appendChild(main);

            const subject = document.createElement("div");
            subject.setAttribute("data-lab-subject", "");
            subject.className = "agent-composer";
            main.appendChild(subject);

            const toolbar = document.createElement("div");
            toolbar.className = "agent-composer-toolbar flex items-center";
            subject.appendChild(toolbar);

            const button = document.createElement("button");
            button.className = "nb-ui-control inline-flex";
            button.textContent = "清空排队 (0)";
            button.setAttribute("title", "清空消息");
            toolbar.appendChild(button);

            const node = describeNode(button);
            expect(node.selector).toBe("[data-lab-subject] > div.agent-composer-toolbar > button.nb-ui-control");
            expect(node.selector).not.toContain("lab-root");
            expect(node.selector).not.toContain("lab-root--inspecting");
            expect(node.text).toBe("清空排队 (0)");
            expect(node.snippet).toContain("<button");
            expect(node.snippet).toContain("title=\"清空消息\"");
        });

        it("strips transient classes from outer lab inspection target", () => {
            const root = document.createElement("div");
            root.className = "lab-root lab-root--inspecting";

            const main = document.createElement("main");
            main.className = "lab-main";
            root.appendChild(main);

            const bar = document.createElement("div");
            bar.className = "lab-bar lab-bar--tight flex shrink-0";
            bar.textContent = "正常就绪空闲 随窗口";
            main.appendChild(bar);

            const node = describeNode(bar);
            expect(node.selector).toBe("main.lab-main > div.lab-bar.lab-bar--tight");
            expect(node.selector).not.toContain("lab-root--inspecting");
            expect(node.text).toContain("正常就绪空闲 随窗口");
        });
    });

    describe("nodeReport", () => {
        it("formats inspected node with component name, host, and file", () => {
            const report = nodeReport({
                tag: "button",
                id: "",
                classes: ["nb-ui-control", "w-[170px]"],
                selector: "header.lab-bar > button.nb-ui-control",
                componentName: "FormSelect",
                componentFile: "packages/nb-ui/src/components/form/FormSelect.vue",
                width: 170,
                height: 26,
                isSubject: false,
                snippet: "<button class=\"nb-ui-control\">",
                text: "选择对话",
            });

            expect(report).toContain("元素  header.lab-bar > button.nb-ui-control");
            expect(report).toContain("组件  FormSelect");
            expect(report).toContain("源文件  packages/nb-ui/src/components/form/FormSelect.vue");
            expect(report).toContain("标签  <button class=\"nb-ui-control\">");
            expect(report).toContain("文本  \"选择对话\"");
            expect(report).toContain("尺寸  170 × 26");
            expect(report).toContain("类名  nb-ui-control (+1 个样式原子类)");
        });

        it("formats node with business host component information", () => {
            const report = nodeReport({
                tag: "button",
                id: "",
                classes: ["nb-ui-control"],
                selector: "[data-lab-subject] > div.agent-composer-toolbar > button.nb-ui-control",
                componentName: "Button",
                componentFile: "packages/nb-ui/src/components/controls/Button.vue",
                hostComponentName: "AgentComposerToolbar",
                hostComponentFile: "packages/neuro-book/src/plugins/agent/web/components/AgentComposerToolbar.vue",
                width: 84,
                height: 26,
                isSubject: false,
                snippet: "<button type=\"button\" class=\"nb-ui-control\" title=\"清空排队\">",
                text: "清空排队 (0)",
            });

            expect(report).toContain("组件  Button (所属宿主: AgentComposerToolbar)");
            expect(report).toContain("源文件  packages/neuro-book/src/plugins/agent/web/components/AgentComposerToolbar.vue");
            expect(report).toContain("标签  <button type=\"button\" class=\"nb-ui-control\" title=\"清空排队\">");
            expect(report).toContain("文本  \"清空排队 (0)\"");
        });
    });
});
