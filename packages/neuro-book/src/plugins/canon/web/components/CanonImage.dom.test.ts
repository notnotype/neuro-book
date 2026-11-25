/**
 * CanonImage（同名 .md，docs/specs/canon/author-ui.md 输出 53）：取图地址经注入的函数算；读到以后才显示，读不出来或没有地址时画
 * “图片找不到”；路径换了重新读。
 */

import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {CANON_IMAGE_URL} from "../images";
import {canonCatalogs} from "../text";
import CanonImage from "./CanonImage.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

/** 作品里只有 `插图/` 下的图有地址（同文件服务对作品外路径不给地址）。 */
const urlOf = (path: string): string | null => (path.startsWith("插图/") ? `/raw/${encodeURIComponent(path)}` : null);

function image(props: {path: string; alt?: string}, url: ((path: string) => string | null) | null = urlOf): VueWrapper {
    const provide = {...provideText(port), ...(url === null ? {} : {[CANON_IMAGE_URL as symbol]: url})};
    const wrapper = mount(CanonImage, {props, global: {provide}});
    mounted.push(wrapper);
    return wrapper;
}

const state = (wrapper: VueWrapper) => wrapper.get("[data-canon-image]").attributes("data-image-state");

describe("CanonImage", () => {
    it("按注入的函数取地址；读到之前是读取中，读到以后是已读到", async () => {
        const wrapper = image({path: "插图/星瑕.png", alt: "星瑕的立绘"});
        const img = wrapper.get("img");
        expect(img.attributes("src")).toBe("/raw/%E6%8F%92%E5%9B%BE%2F%E6%98%9F%E7%91%95.png");
        expect(img.attributes("alt")).toBe("星瑕的立绘");
        expect(img.attributes("loading")).toBe("lazy");
        expect(state(wrapper)).toBe("loading");
        await img.trigger("load");
        expect(state(wrapper)).toBe("loaded");
    });

    it("读不出来、没有地址、没有注入取地址的函数时都画“图片找不到”", async () => {
        const broken = image({path: "插图/不在.png"});
        await broken.get("img").trigger("error");
        expect(state(broken)).toBe("missing");
        expect(broken.find("img").exists()).toBe(false);
        expect(broken.get("[role='img']").attributes("aria-label")).toBe("图片找不到");

        expect(state(image({path: "../外面.png"}))).toBe("missing");
        expect(state(image({path: "插图/星瑕.png"}, null))).toBe("missing");
    });

    it("路径换了重新读：上一张读失败不留到下一张", async () => {
        const wrapper = image({path: "插图/不在.png"});
        await wrapper.get("img").trigger("error");
        await wrapper.setProps({path: "插图/星瑕.png"});
        expect(state(wrapper)).toBe("loading");
        await wrapper.get("img").trigger("load");
        expect(state(wrapper)).toBe("loaded");
    });
});
