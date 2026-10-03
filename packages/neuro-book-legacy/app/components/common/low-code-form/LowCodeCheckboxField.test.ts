// @vitest-environment jsdom
import {computed, createApp, defineComponent, h, nextTick, ref} from "vue";
import type {App} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";
import LowCodeCheckboxField from "./LowCodeCheckboxField.vue";

const mounted: App[] = [];

beforeEach(() => {
    // 组件按 Nuxt 自动导入使用 `computed`；vitest 不跑自动导入，这里补上同名全局。
    vi.stubGlobal("computed", computed);
});

afterEach(() => {
    for (const app of mounted.splice(0)) app.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

function field(options: Array<{value: LowCodeJsonValue; label: string; disabled?: boolean}>): LowCodeFieldDto {
    return {
        path: "flags",
        label: "标记",
        component: "checkbox",
        options: options.map((option) => ({...option, description: null, disabled: option.disabled === true})),
    } as unknown as LowCodeFieldDto;
}

type Mounted = {
    host: HTMLElement;
    updates: LowCodeJsonValue[];
};

function mount(modelValue: LowCodeJsonValue, options?: Array<{value: LowCodeJsonValue; label: string; disabled?: boolean}>): Mounted {
    const host = document.createElement("div");
    document.body.append(host);
    const updates: LowCodeJsonValue[] = [];
    const current = ref<LowCodeJsonValue>(modelValue);
    const app = createApp(defineComponent({
        setup() {
            return () => h(LowCodeCheckboxField, {
                field: field(options ?? [{value: "a", label: "A"}, {value: 2, label: "B"}]),
                modelValue: current.value,
                "onUpdate:modelValue": (value: LowCodeJsonValue) => {
                    updates.push(value);
                    current.value = value;
                },
            });
        },
    }));
    mounted.push(app);
    app.mount(host);
    return {host, updates};
}

describe("LowCodeCheckboxField", () => {
    it("切换已知选项时保留选项表里已不存在的历史值", async () => {
        const view = mount(["retired"]);
        await nextTick();

        const checkboxes = [...view.host.querySelectorAll<HTMLInputElement>("input[type='checkbox']")];
        expect(checkboxes).toHaveLength(2);
        checkboxes[0]!.click();
        await nextTick();

        expect(view.updates.at(-1)).toEqual(["a", "retired"]);
    });

    it("取消已选选项后只移除该值", async () => {
        const view = mount(["a", 2, "retired"]);
        await nextTick();

        const checkboxes = [...view.host.querySelectorAll<HTMLInputElement>("input[type='checkbox']")];
        checkboxes[1]!.click();
        await nextTick();

        expect(view.updates.at(-1)).toEqual(["a", "retired"]);
    });

    it("切换可选选项时保留 disabled 选项已带进来的值", async () => {
        const view = mount([2], [{value: "a", label: "A"}, {value: 2, label: "B", disabled: true}]);
        await nextTick();

        const checkboxes = [...view.host.querySelectorAll<HTMLInputElement>("input[type='checkbox']")];
        expect(checkboxes[1]!.disabled).toBe(true);
        checkboxes[0]!.click();
        await nextTick();

        expect(view.updates.at(-1)).toEqual(["a", 2]);
    });
});
