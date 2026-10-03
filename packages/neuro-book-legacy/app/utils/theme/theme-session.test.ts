// @vitest-environment jsdom
import {beforeEach, describe, expect, it} from "vitest";
import {productAppearances, productThemeIds} from "nbook/shared/theme/theme-axes";
import {productThemes} from "nbook/app/utils/theme/theme-packs";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";

/**
 * 四个组合（nbook / macos × light / dark）在文档根上解析出的配色取值，
 * 必须与 nb-ui 主题包自己给的那一份**逐项相等**。
 *
 * 取值全部从主题包读（`installed.themes[...].colorways[...]`），测试里不抄任何字面量：
 * 抄一份就等于给颜色建了第二个事实源，主题包改色时这边静默漂移。
 */
describe("product theme session", () => {
    const session = useProductTheme();

    beforeEach(() => {
        session.applyStoredAxes({});
    });

    it("四个组合把主题包自带的配色逐项写到 <html>", () => {
        for (const themeId of productThemeIds) {
            const pack = productThemes.find((theme) => theme.manifest.id === themeId);
            expect(pack, `主题包 ${themeId} 必须已装载`).toBeDefined();
            const defaultColorway = pack?.manifest.defaultColorway;
            expect(defaultColorway, `主题包 ${themeId} 必须给出默认配色`).toBeDefined();

            for (const appearance of productAppearances) {
                session.applyStoredAxes({themeId, appearance});

                const colorwayId = defaultColorway?.[appearance];
                const expected = colorwayId === undefined ? undefined : pack?.colorways[colorwayId];
                expect(expected, `${themeId} 缺 ${appearance} 配色`).toBeDefined();

                const root = document.documentElement;
                expect(root.dataset.nbTheme).toBe(themeId);
                expect(root.dataset.nbAppearance).toBe(appearance);
                expect(root.style.colorScheme).toBe(appearance);

                for (const [name, value] of Object.entries(expected ?? {})) {
                    expect(root.style.getPropertyValue(name), `${themeId}/${appearance} 的 ${name}`).toBe(value);
                }

                // 与 nb-ui 配色 store 一致：body 上也写一份，浮层与视口才跟随同一套取值。
                expect(document.body.style.getPropertyValue("--bg-panel")).toBe(expected?.["--bg-panel"]);
                expect(session.colorwayId.value).toBe(colorwayId);
            }
        }
    });

    it("老体系取值与缺失字段一律回落默认，不做映射", () => {
        for (const legacyThemeId of ["sepia", "light", "dark", "tokyo-night", "custom-night", "missing-theme", ""]) {
            session.applyStoredAxes({themeId: legacyThemeId, appearance: "sepia"});
            expect(session.themeId.value).toBe("nbook");
            expect(session.appearance.value).toBe("light");
        }

        session.applyStoredAxes({themeId: "macos", appearance: "dark"});
        session.applyStoredAxes({themeId: undefined, appearance: undefined});
        expect(session.themeId.value).toBe("nbook");
        expect(session.appearance.value).toBe("light");
    });
});

/**
 * 配色轴的用户侧：编辑后的取值怎么生效、无效值怎么被挡、删掉在用的配色之后落到哪。
 * 期望值全部从主题包读，测试里不抄字面量（同上一组）。
 */
describe("product theme session 用户配色", () => {
    const session = useProductTheme();
    const nbook = productThemes.find((theme) => theme.manifest.id === "nbook");
    const darkBase = nbook?.colorways["nbook-dark"];
    const lightBase = nbook?.colorways["nbook-light"];

    beforeEach(() => {
        session.applyStoredAxes({themeId: "nbook", appearance: "light"});
        session.applyStoredColorways({colorwayId: "", userColorways: []});
    });

    it("保存后立即生效：改过的键与手写值一致，没改的键沿用主题自带配色", () => {
        const id = session.saveUserColorway({
            label: "夜航",
            appearance: "dark",
            vars: {"--bg-main": "#123456", "--bg-panel": "#654321"},
        });

        expect(id).toMatch(/^custom-/);
        const root = document.documentElement;
        expect(root.style.getPropertyValue("--bg-main")).toBe("#123456");
        expect(root.style.getPropertyValue("--bg-panel")).toBe("#654321");
        expect(root.style.getPropertyValue("--text-main")).toBe(darkBase?.["--text-main"]);
        // 两轴表现与内置配色一致：属性 + 明暗 + 原生 UI
        expect(root.dataset.nbAppearance).toBe("dark");
        expect(root.style.colorScheme).toBe("dark");
        expect(root.dataset.nbTheme).toBe("nbook");
        expect(session.colorwayId.value).toBe(id);
        expect(session.colorwayIsUser.value).toBe(true);
        expect(document.body.style.getPropertyValue("--bg-main")).toBe("#123456");
    });

    it("坏取值不写进变量，也不妨碍同一份配色里合法的键生效", () => {
        session.saveUserColorway({
            label: "半坏",
            appearance: "light",
            vars: {"--bg-panel": "#111111", "--bg-main": "not-a-color"},
        });

        const root = document.documentElement;
        expect(root.style.getPropertyValue("--bg-panel")).toBe("#111111");
        // 坏值被丢掉后这个键落到主题自带亮色配色，而不是被写成 not-a-color
        expect(root.style.getPropertyValue("--bg-main")).toBe(lightBase?.["--bg-main"]);
    });

    it("一套合法变量都没有的草稿不保存", () => {
        expect(session.saveUserColorway({label: "空", appearance: "dark", vars: {"--bg-main": "nope"}})).toBeNull();
        expect(session.saveUserColorway({label: "", appearance: "dark", vars: {"--bg-main": "#101010"}})).toBeNull();
        expect(session.userColorways.value).toHaveLength(0);
    });

    it("重命名改的是同一套（id 不变），另存为产生新 id", () => {
        const id = session.saveUserColorway({label: "夜航", appearance: "dark", vars: {"--bg-main": "#123456"}});
        expect(id).not.toBeNull();
        if (id === null) {
            return;
        }
        expect(session.saveUserColorway({id, label: "夜航 2", appearance: "dark", vars: {"--bg-main": "#123456"}})).toBe(id);
        expect(session.userColorways.value).toHaveLength(1);
        expect(session.userColorways.value[0]?.label).toBe("夜航 2");

        const copyId = session.saveUserColorway({label: "夜航 3", appearance: "dark", vars: {"--bg-main": "#123456"}});
        expect(copyId).not.toBe(id);
        expect(session.userColorways.value).toHaveLength(2);
    });

    it("删掉正在使用的自定义配色 → 回落主题自带配色（明暗轴跟着它）", () => {
        const id = session.saveUserColorway({label: "夜航", appearance: "dark", vars: {"--bg-main": "#123456"}});
        expect(id).not.toBeNull();
        if (id === null) {
            return;
        }

        expect(session.deleteUserColorway(id)).toBe(true);
        expect(session.colorwayId.value).toBe("nbook-dark");
        expect(session.colorwayIsUser.value).toBe(false);
        expect(document.documentElement.style.getPropertyValue("--bg-main")).toBe(darkBase?.["--bg-main"]);
        expect(session.deleteUserColorway(id)).toBe(false);
    });

    it("配置里读到无效配色 id 与坏条目：回落内置配色、丢掉坏条目，都不报错", () => {
        session.applyStoredColorways({
            colorwayId: "custom-已经不存在",
            userColorways: [
                {id: "custom-keep", label: "留着", appearance: "dark", vars: {"--bg-main": "#010203", "--bg-unknown": "#ffffff", "--bg-panel": "不是颜色"}},
                {id: "bad id", label: "坏 id", appearance: "dark", vars: {"--bg-main": "#010203"}},
                {id: "custom-empty", label: "没标签", appearance: "sepia", vars: {"--bg-main": "#010203"}},
            ] as never,
        });

        expect(session.colorwayId.value).toBe("nbook-light");
        expect(session.colorwayIsUser.value).toBe(false);
        // 契约外的键与坏值在客户端被过滤，条目本身留着（用户没有做错什么）
        expect(session.userColorways.value.map((colorway) => colorway.id)).toEqual(["custom-keep"]);
        expect(session.userColorways.value[0]?.vars).toEqual({"--bg-main": "#010203"});
    });

    it("配置里存着的自定义配色会在下次启动时被应用（刷新后保持）", () => {
        session.applyStoredColorways({
            colorwayId: "custom-night",
            userColorways: [{id: "custom-night", label: "夜航", appearance: "dark", vars: {"--bg-main": "#0a0b0c"}}],
        });

        expect(session.colorwayId.value).toBe("custom-night");
        expect(session.colorwayIsUser.value).toBe(true);
        expect(document.documentElement.style.getPropertyValue("--bg-main")).toBe("#0a0b0c");
        expect(document.documentElement.dataset.nbAppearance).toBe("dark");
    });

    it("选明暗等于回到主题自带配色，选主题自带的另一套配色则保持显式选择", () => {
        session.saveUserColorway({label: "夜航", appearance: "dark", vars: {"--bg-main": "#123456"}});

        session.setAxes({appearance: "light"});
        expect(session.colorwayId.value).toBe("nbook-light");
        expect(session.colorwayIsUser.value).toBe(false);

        // 主题自带配色的明暗默认值不落成显式 id：换主题后仍然跟着新主题走
        session.setColorway("nbook-dark");
        expect(session.colorwayId.value).toBe("nbook-dark");
        expect(session.appearance.value).toBe("dark");
        expect(document.documentElement.style.getPropertyValue("--bg-main")).toBe(darkBase?.["--bg-main"]);
    });
});
