import {describe, expect, it} from "vitest";
import {buildColorwayFileJson, colorwayFileName, parseColorwayFileJson} from "nbook/app/utils/theme/colorway-io";

const payload = {
    label: "夜航",
    appearance: "dark" as const,
    vars: {
        "--bg-main": "#101010",
        "--bg-subtle": "color-mix(in srgb, #101010 78%, #202020)",
        "--shadow-panel": "0 1px 2px rgba(0, 0, 0, 0.5)",
    },
};

describe("配色导入导出", () => {
    it("导出再导入逐项一致（取值与派生写法都不被改写）", () => {
        const parsed = parseColorwayFileJson(buildColorwayFileJson(payload));

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        expect(parsed.payload).toEqual(payload);
    });

    it("非 JSON、非本产品文件、坏取值各自给出可读原因", () => {
        expect(parseColorwayFileJson("{")).toMatchObject({ok: false, messageKey: "settings.frontend.colorwayImportInvalidJson"});
        expect(parseColorwayFileJson("[]")).toMatchObject({ok: false, messageKey: "settings.frontend.colorwayImportSchemaMismatch"});
        expect(parseColorwayFileJson(JSON.stringify({schema: 2, kind: "nb-colorway", label: "x", appearance: "dark", vars: {"--bg-main": "#000"}})))
            .toMatchObject({ok: false, messageKey: "settings.frontend.colorwayImportSchemaMismatch"});
        expect(parseColorwayFileJson(JSON.stringify({schema: 1, kind: "other", label: "x", appearance: "dark", vars: {"--bg-main": "#000"}})))
            .toMatchObject({ok: false, messageKey: "settings.frontend.colorwayImportSchemaMismatch"});
        expect(parseColorwayFileJson(JSON.stringify({schema: 1, kind: "nb-colorway", label: "x", appearance: "sepia", vars: {"--bg-main": "#000"}})))
            .toMatchObject({ok: false, messageKey: "settings.frontend.colorwayImportSchemaMismatch"});
        expect(parseColorwayFileJson(JSON.stringify({schema: 1, kind: "nb-colorway", label: "", appearance: "dark", vars: {"--bg-main": "#000"}})))
            .toMatchObject({ok: false, messageKey: "settings.frontend.colorwayImportSchemaMismatch"});
    });

    it("坏取值拒绝并报出变量名，契约外的键忽略而不是让整份文件失败", () => {
        const broken = parseColorwayFileJson(JSON.stringify({
            schema: 1,
            kind: "nb-colorway",
            label: "坏",
            appearance: "dark",
            vars: {"--bg-main": "#101010", "--bg-panel": "not-a-color", "--bg-unknown": "#ffffff"},
        }));

        expect(broken).toMatchObject({ok: false, messageKey: "settings.frontend.colorwayImportInvalidValue", variableName: "--bg-panel"});
    });

    it("没有可用变量的文件被拒绝", () => {
        const empty = parseColorwayFileJson(JSON.stringify({
            schema: 1,
            kind: "nb-colorway",
            label: "空",
            appearance: "light",
            vars: {"--bg-unknown": "#ffffff"},
        }));

        expect(empty).toMatchObject({ok: false, messageKey: "settings.frontend.colorwayImportEmpty"});
    });

    it("导出文件名由展示名压成安全短名", () => {
        expect(colorwayFileName("夜航")).toBe("夜航.colorway.json");
        expect(colorwayFileName("a/b:c*d?e")).toBe("a-b-c-d-e.colorway.json");
        expect(colorwayFileName("   ")).toBe("colorway.colorway.json");
    });
});
