/**
 * ApiDetectResults（同名 .md）：网络出口选不出路的三个码（docs/specs/network/egress.md 输出 6）写成说法，不显示“失败（码）”。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {SAMPLE_DETECTION} from "nbook/plugins/models/web/lab/sample";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {modelsCatalogs} from "../text";
import ApiDetectResults from "./ApiDetectResults.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

describe("ApiDetectResults", () => {
    it("代理不支持、地址无效、系统设置读不到：每一行写对应的说法", async () => {
        const codes = ["proxy-unsupported", "proxy-invalid", "proxy-unreadable", "proxy-unsupported"] as const;
        const detection = {...SAMPLE_DETECTION, results: SAMPLE_DETECTION.results.map((row, index) => ({...row, ok: false, status: null, ms: null, url: null, code: codes[index]!, message: "nothing was sent"}))};
        const wrapper = mount(ApiDetectResults, {global, props: {state: {status: "done", detection}, connection: "c1"}, attachTo: document.body});
        mounted.push(wrapper);
        await flushPromises();
        const text = document.body.textContent ?? "";
        expect(text).toContain("代理不支持（SOCKS 或自动配置脚本）");
        expect(text).toContain("代理地址无效");
        expect(text).toContain("无法读取系统的代理设置");
        expect(text).not.toContain("失败（proxy");
    });
});
