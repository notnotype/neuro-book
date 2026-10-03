// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick, ref, type App} from "vue";
import {afterEach, describe, expect, it} from "vitest";
import {LAB_EVENT_SINK, LAB_INPUT_SINK} from "./lab-event-sink";
import {useLabSubject, type LabSceneInput} from "./lab-subject";

const Picker = defineComponent({
    props: {
        open: {type: Boolean, required: true},
        modelValue: {type: String, required: true},
        models: {type: Array, required: true},
        direction: {type: String, default: "auto"},
    },
    emits: ["update:open", "update:model-value", "select"],
    setup(props, {emit}) {
        return () => h("button", {
            onClick: () => {
                emit("update:model-value", "b");
                emit("select", "b", {id: "b"});
                emit("update:open", false);
            },
        }, `${props.open}:${props.modelValue}:${props.direction}`);
    },
});

describe("useLabSubject", () => {
    let app: App | null = null;
    afterEach(() => {
        app?.unmount();
        app = null;
    });

    it("只记录声明事件，model update 回写并返回到组件", async () => {
        const events: Array<[string, unknown]> = [];
        const writes: Array<[string, string, unknown]> = [];
        const input = ref<LabSceneInput>({model: {open: true, modelValue: "a"}, props: {models: []}});
        const Fixture = defineComponent(() => {
            const subject = useLabSubject<typeof Picker>(() => input.value, ["select", "update:model-value"]);
            return () => h(Picker, subject.bindings.value);
        });
        const host = document.createElement("div");
        app = createApp(Fixture);
        app.provide(LAB_EVENT_SINK, (name, payload) => events.push([name, payload]));
        app.provide(LAB_INPUT_SINK, (layer, key, value) => {
            writes.push([layer, key, value]);
            input.value = {...input.value, [layer]: {...input.value[layer], [key]: value}};
        });
        app.mount(host);

        expect(host.textContent).toBe("true:a:auto");
        host.querySelector("button")!.click();
        await nextTick();

        expect(host.textContent).toBe("false:b:auto");
        expect(events).toEqual([
            ["update:modelValue", "b"],
            ["select", ["b", {id: "b"}]],
            ["update:open", false],
        ]);
        expect(writes).toEqual([
            ["model", "modelValue", "b"],
            ["model", "open", false],
        ]);
    });

    it("没有 Lab provider 时不伪造外部受控状态", async () => {
        const input = ref<LabSceneInput>({model: {open: true, modelValue: "a"}, props: {models: []}});
        const Fixture = defineComponent(() => {
            const subject = useLabSubject<typeof Picker>(() => input.value, ["select"]);
            return () => h(Picker, subject.bindings.value);
        });
        const host = document.createElement("div");
        app = createApp(Fixture);
        app.mount(host);

        host.querySelector("button")!.click();
        await nextTick();

        expect(host.textContent).toBe("true:a:auto");
        expect(input.value).toEqual({model: {open: true, modelValue: "a"}, props: {models: []}});
    });
});
