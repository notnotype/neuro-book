// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest";
import {nextTick, ref} from "vue";
import {useTitleBarEditTarget} from "nbook/app/composables/useTitleBarEditTarget";

/**
 * 编辑目标会话：焦点进标题栏（键盘的正常路径）不该把编辑动作全禁掉，
 * 而焦点离开标题栏时必须回到「按此刻焦点判」——不假装可编辑、不把 Studio 撤销冒充原生撤销。
 */

const mountedNodes: HTMLElement[] = [];

afterEach(() => {
    for (const node of mountedNodes.splice(0)) node.remove();
});

function tree(): {input: HTMLInputElement; barTrigger: HTMLButtonElement; pageButton: HTMLButtonElement; panelItem: HTMLButtonElement} {
    const host = document.createElement("div");
    const input = document.createElement("input");
    const bar = document.createElement("div");
    bar.className = "desktop-title-bar";
    const barTrigger = document.createElement("button");
    bar.append(barTrigger);
    const pageButton = document.createElement("button");
    const panel = document.createElement("div");
    panel.setAttribute("data-titlebar-menu-panel", "group");
    const panelItem = document.createElement("button");
    panel.append(panelItem);
    host.append(input, bar, pageButton, panel);
    document.body.append(host);
    mountedNodes.push(host);
    return {input, barTrigger, pageButton, panelItem};
}

describe("useTitleBarEditTarget", () => {
    it("焦点进标题栏后沿用最近一次可编辑焦点；离开标题栏后按此刻焦点判", async () => {
        const {input, barTrigger, pageButton, panelItem} = tree();
        const activeElement = ref<Element | null>(null);
        const editorActive = ref(false);
        const session = useTitleBarEditTarget({editorActive: () => editorActive.value, activeElement});

        activeElement.value = input;
        await nextTick();
        expect(session.target.value).toBe("native");
        expect(session.rememberedElement.value).toBe(input);
        expect(session.titleBarOwnsFocus.value).toBe(false);

        // 键盘 Tab 进标题栏：真实焦点变了，但编辑动作仍作用在输入框上。
        activeElement.value = barTrigger;
        await nextTick();
        expect(session.target.value).toBe("native");
        expect(session.titleBarOwnsFocus.value).toBe(true);

        // 焦点在下拉层里（面板被 Teleport 到 body）：同一档。
        activeElement.value = panelItem;
        await nextTick();
        expect(session.target.value).toBe("native");

        // 焦点回到页面其它控件：不拿记忆冒充可编辑。
        activeElement.value = pageButton;
        await nextTick();
        expect(session.target.value).toBe("none");
        expect(session.titleBarOwnsFocus.value).toBe(false);

        // 再回到输入框：恢复实时判定。
        activeElement.value = input;
        await nextTick();
        expect(session.target.value).toBe("native");
    });

    it("记忆的元素一旦离开文档就不再算可编辑目标：不显示可用、也不归还焦点", async () => {
        const {input, barTrigger} = tree();
        const activeElement = ref<Element | null>(null);
        const session = useTitleBarEditTarget({editorActive: () => false, activeElement});

        activeElement.value = input;
        await nextTick();
        expect(session.target.value).toBe("native");

        // 对话框 / 内联编辑器关闭：元素游离，焦点回到 body。
        input.remove();
        activeElement.value = document.body;
        await nextTick();
        activeElement.value = barTrigger;
        await nextTick();

        expect(session.target.value).toBe("none");
        expect(session.rememberedElement.value).toBeNull();
    });

    it("Studio 活跃时记的是 editor 档：焦点进标题栏后撤销仍走会话", async () => {
        const {barTrigger} = tree();
        const activeElement = ref<Element | null>(null);
        const editorActive = ref(true);
        const session = useTitleBarEditTarget({editorActive: () => editorActive.value, activeElement});

        const contentEditable = document.createElement("div");
        contentEditable.contentEditable = "true";
        document.body.append(contentEditable);
        mountedNodes.push(contentEditable);

        activeElement.value = contentEditable;
        await nextTick();
        expect(session.target.value).toBe("editor");

        activeElement.value = barTrigger;
        await nextTick();
        expect(session.target.value).toBe("editor");

        // 从没有过可编辑焦点：标题栏里也是 none，不假装能编辑。
        const fresh = useTitleBarEditTarget({editorActive: () => false, activeElement: ref<Element | null>(barTrigger)});
        await nextTick();
        expect(fresh.target.value).toBe("none");
    });
});
