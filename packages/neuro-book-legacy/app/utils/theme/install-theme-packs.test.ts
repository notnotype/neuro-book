import {describe, expect, it} from "vitest";
import {getInstalledTheme, NbThemeInstallError} from "@notnotype/nb-ui/theme";
import type {NbThemeModule} from "@notnotype/nb-ui/theme";
// 求值顺序就是 bug 现场的顺序：产品侧（theme-packs）先装 nbook / macos，`/lab` 的 lab-theme 再来装 4 套。
import {productThemes} from "nbook/app/utils/theme/theme-packs";
import {labThemes} from "nbook/app/component-lab/lab-theme";
import {installThemePacks} from "nbook/app/utils/theme/install-theme-packs";

/** hostVersion 不匹配 nb-ui 的探针主题：装载必须当场失败，不能被「已装过」这条路径吃掉。 */
const brokenModule: NbThemeModule = {
    manifest: {id: "probe", name: "探针", version: "0.0.1", hostVersion: "^99.0.0"},
};

describe("installThemePacks", () => {
    /**
     * 这条就是 /lab 的实际故障：lab-theme 原先直接 installTheme，撞上产品侧已装的 nbook，
     * 模块求值期抛 duplicate-id，整个 /lab 装载失败。合并清单由这个入口承担后，
     * 两边拿到的都是自己那份清单，重合的两套指向**同一份登记**。
     */
    it("产品侧与 lab 侧在同一页面先后装载：两边清单都在，重合的复用同一份登记", () => {
        expect(productThemes.map((theme) => theme.manifest.id)).toEqual(["nbook", "macos"]);
        expect(labThemes.map((theme) => theme.manifest.id)).toEqual(["nbook", "macos", "editorial", "aurora"]);
        expect(labThemes.find((theme) => theme.manifest.id === "nbook")).toBe(productThemes[0]);
        expect(labThemes.find((theme) => theme.manifest.id === "macos")).toBe(productThemes[1]);
    });

    it("装不上的主题照样抛错，没有半装", () => {
        expect(() => installThemePacks([brokenModule])).toThrow(NbThemeInstallError);
        expect(getInstalledTheme("probe")).toBeUndefined();
    });
});
