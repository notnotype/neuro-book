// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick, type App} from "vue";
import {afterEach, describe, expect, it} from "vitest";
import {LAB_EVENT_SINK, LAB_INPUT_SINK} from "../lab-event-sink";
import type {LabSceneInput} from "../lab-subject";
import {defineSubjectFixture} from "./subject-fixture";

const Toggle = defineComponent({
    props: {expanded: {type: Boolean, required: true}, label: {type: String, required: true}, registry: {type: Object, default: null}},
    emits: ["toggle"],
    setup(props, {emit}) {
        return () => h("button", {onClick: () => emit("toggle", !props.expanded)}, `${props.label}:${props.expanded}:${props.registry === null ? "none" : "registry"}`);
    },
});

describe("defineSubjectFixture", () => {
    let app: App | null = null;
    afterEach(() => {
        app?.unmount();
        app = null;
    });

    it("绑定场景输入、补运行期 props、记录事件并按声明回写", async () => {
        const fixture = defineSubjectFixture<typeof Toggle>({
            component: "Toggle",
            scenes: [{id: "default", label: "默认", input: {props: {expanded: false, label: "思考"}}}],
            subject: async () => ({default: Toggle}),
            events: ["toggle"],
            writeBack: {toggle: {layer: "props", key: "expanded"}},
            class: "w-full",
            runtimeProps: async () => ({registry: {}}),
        });
        const Fixture = await fixture.load();
        let input: LabSceneInput = {props: {expanded: false, label: "思考"}};
        const events: Array<[string, unknown]> = [];
        const host = document.createElement("div");
        const Host = defineComponent({
            data: () => ({input}),
            render() {
                return h(Fixture, {scene: "default", input: this.input});
            },
        });
        app = createApp(Host);
        app.provide(LAB_EVENT_SINK, (name, payload) => events.push([name, payload]));
        const instance = {current: null as null | {input: LabSceneInput}};
        app.provide(LAB_INPUT_SINK, (layer, key, value) => {
            input = {...input, [layer]: {...input[layer], [key]: value}};
            if (instance.current) instance.current.input = input;
        });
        instance.current = app.mount(host) as unknown as {input: LabSceneInput};

        const button = host.querySelector("button")!;
        expect(button.hasAttribute("data-lab-subject")).toBe(true);
        expect(button.className).toBe("w-full");
        expect(button.textContent).toBe("思考:false:registry");

        button.click();
        await nextTick();
        expect(events).toEqual([["toggle", true]]);
        expect(host.querySelector("button")!.textContent).toBe("思考:true:registry");
    });
});
