// @vitest-environment happy-dom
import {describe, expect, it} from "vitest";
import {nodeReport, shortenFile, vueOwner} from "./inspect";

describe("inspect", () => {
    describe("shortenFile", () => {
        it("shortens absolute path to package relative path", () => {
            expect(shortenFile("C:/repo/packages/nb-ui/src/components/form/FormSelect.vue"))
                .toBe("packages/nb-ui/src/components/form/FormSelect.vue");
            expect(shortenFile("/usr/local/repo/packages/neuro-book/app/component-lab/LabShell.vue"))
                .toBe("packages/neuro-book/app/component-lab/LabShell.vue");
            expect(shortenFile("")).toBe("");
        });
    });

    describe("vueOwner transparent primitive bypass", () => {
        it("bypasses headless Primitive without file to resolve business component FormSelect", () => {
            const div = document.createElement("button");
            // 模拟 Reka UI 内部包装结构：Primitive -> SelectTrigger -> FormSelect
            const formSelectInstance = {
                type: {
                    __name: "FormSelect",
                    __file: "C:/repo/packages/nb-ui/src/components/form/FormSelect.vue",
                },
                parent: undefined,
            };
            const selectTriggerInstance = {
                type: {
                    name: "SelectTrigger",
                },
                parent: formSelectInstance,
            };
            const primitiveInstance = {
                type: {
                    name: "Primitive",
                },
                parent: selectTriggerInstance,
            };

            (div as unknown as {__vueParentComponent: unknown}).__vueParentComponent = primitiveInstance;

            const owner = vueOwner(div);
            expect(owner.name).toBe("FormSelect");
            expect(owner.file).toBe("C:/repo/packages/nb-ui/src/components/form/FormSelect.vue");
        });

        it("falls back to primitive name if no business component with file or distinct name is found", () => {
            const div = document.createElement("button");
            const primitiveInstance = {
                type: {
                    name: "Primitive",
                },
                parent: undefined,
            };

            (div as unknown as {__vueParentComponent: unknown}).__vueParentComponent = primitiveInstance;

            const owner = vueOwner(div);
            expect(owner.name).toBe("Primitive");
            expect(owner.file).toBe("");
        });
    });

    describe("nodeReport", () => {
        it("formats inspected node with component name and file", () => {
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
            });

            expect(report).toContain("元素  header.lab-bar > button.nb-ui-control");
            expect(report).toContain("组件  FormSelect");
            expect(report).toContain("源文件  packages/nb-ui/src/components/form/FormSelect.vue");
            expect(report).toContain("尺寸  170 × 26");
            expect(report).toContain("类名  nb-ui-control w-[170px]");
        });
    });
});
