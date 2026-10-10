/**
 * 地址栏与 Lab 会话状态的同步（docs/specs/ui/component-lab.md 的输出“地址栏就是标签页的会话状态”，验收 21）：真实的
 * vue-router（内存历史）。导航被拒时画面回到当前地址；别处带来的地址按地址改状态并交出主题配色；切组件新增历史、
 * 切场景替换当前记录。
 */

import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, effectScope, nextTick, ref} from "vue";
import type {EffectScope} from "vue";
import {createMemoryHistory, createRouter} from "vue-router";
import type {LocationQuery, Router} from "vue-router";

import {useLabSession} from "./use-lab-session";

const catalog = {componentNames: ["Button", "Card", "Blocked"], zooms: [0.5, 1, 2], defaults: {component: "Button", zoom: 1, tab: "doc"}};
const Page = defineComponent({render: () => null});
const scopes: EffectScope[] = [];

afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
});

async function setup(initial: string): Promise<{router: Router; refs: ReturnType<typeof makeRefs>; looks: LocationQuery[]}> {
    const router = createRouter({history: createMemoryHistory(), routes: [{path: "/lab", component: Page}, {path: "/", component: Page}]});
    // 拒绝去往 Blocked 的导航：模拟守卫拒绝。
    router.beforeEach((to) => to.query.c !== "Blocked");
    await router.push(initial);
    const refs = makeRefs();
    const looks: LocationQuery[] = [];
    const scope = effectScope();
    scopes.push(scope);
    const session = scope.run(() => useLabSession(router, refs, catalog, {onAddressLook: (query) => looks.push(query)}))!;
    session.start();
    await settle();
    return {router, refs, looks};
}

function makeRefs() {
    return {component: ref(""), scene: ref(""), canvasWidth: ref(0), canvasHeight: ref(0), zoom: ref("1"), tab: ref("doc")};
}

/** 等 post watch 与异步导航都落定。 */
async function settle(): Promise<void> {
    for (let index = 0; index < 6; index += 1) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let index = 0; index < 6; index += 1) await nextTick();
}

describe("地址栏与会话状态", () => {
    it("进入时按地址恢复，规范化旧参数名而不新增历史", async () => {
        const {router, refs} = await setup("/lab?component=Card&scene=error&debug=1");
        expect(refs.component.value).toBe("Card");
        expect(refs.scene.value).toBe("error");
        expect(router.currentRoute.value.fullPath).toBe("/lab?debug=1&c=Card&s=error");
    });

    it("切组件新增一条历史，切场景替换当前记录：后退一次回到上一个组件", async () => {
        const {router, refs} = await setup("/lab?c=Button&s=a");
        refs.component.value = "Card";
        refs.scene.value = "x";
        await settle();
        refs.scene.value = "y";
        await settle();
        expect(router.currentRoute.value.query).toMatchObject({c: "Card", s: "y"});
        router.back();
        await settle();
        expect(refs.component.value).toBe("Button");
        expect(refs.scene.value).toBe("a");
    });

    it("快速连续切换：不等导航完成就连切三次，最后地址、路由与状态一致；被后一次取代的中间组件不留历史", async () => {
        const {router, refs} = await setup("/lab?c=Button&s=a");
        for (const [component, scene] of [["Card", "x"], ["Button", "b"], ["Card", "y"]] as const) {
            refs.component.value = component;
            refs.scene.value = scene;
            await nextTick();
        }
        await settle();
        expect(router.currentRoute.value.query).toMatchObject({c: "Card", s: "y"});
        expect([refs.component.value, refs.scene.value]).toEqual(["Card", "y"]);
        router.back();
        await settle();
        expect([refs.component.value, refs.scene.value]).toEqual(["Button", "a"]);
        expect(router.currentRoute.value.query).toMatchObject({c: "Button", s: "a"});
    });

    it("导航被拒：画面回到当前地址，之后照常写", async () => {
        const {router, refs} = await setup("/lab?c=Button&s=a");
        refs.component.value = "Blocked";
        refs.scene.value = "z";
        await settle();
        expect(router.currentRoute.value.query).toMatchObject({c: "Button", s: "a"});
        expect(refs.component.value).toBe("Button");
        expect(refs.scene.value).toBe("a");

        refs.component.value = "Card";
        refs.scene.value = "x";
        await settle();
        expect(router.currentRoute.value.query).toMatchObject({c: "Card", s: "x"});
    });

    it("别处带来的地址：按它改状态，并把查询参数交给调用方处理主题配色；自己写的地址不交", async () => {
        const {router, refs, looks} = await setup("/lab?c=Button&s=a");
        refs.scene.value = "b";
        await settle();
        expect(looks).toEqual([]);
        await router.push("/lab?c=Card&s=x&theme=macos&cw=light");
        await settle();
        expect(refs.component.value).toBe("Card");
        expect(looks.at(-1)).toMatchObject({theme: "macos", cw: "light"});
        // 别处带来的主题配色在之后写地址时保留。
        refs.scene.value = "y";
        await settle();
        expect(router.currentRoute.value.query).toMatchObject({theme: "macos", cw: "light", s: "y"});
    });
});
