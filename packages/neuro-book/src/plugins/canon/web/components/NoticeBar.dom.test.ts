/** NoticeBar（同名 .md，docs/specs/canon/author-ui.md 输出 18、30）：标题、“看回执”与关闭各发什么；`role="status"`。 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import NoticeBar from "./NoticeBar.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

describe("NoticeBar", () => {
    it("写标题；“看回执”发 receipt，关闭发 close", async () => {
        const wrapper = mount(NoticeBar, {props: {title: "改外观"}, global: {provide: provideText(port)}});
        expect(wrapper.get("[role='status']").text()).toContain("改外观");
        await wrapper.findAll("button").find((button) => button.text() === "看回执")!.trigger("click");
        await wrapper.get("button[aria-label='关闭']").trigger("click");
        expect(wrapper.emitted("receipt")).toHaveLength(1);
        expect(wrapper.emitted("close")).toHaveLength(1);
        wrapper.unmount();
    });
});
