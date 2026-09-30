// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest";
import {measureStage} from "./lab-debug";

function box(element: Element, left: number, width: number) {
    element.getBoundingClientRect = () => ({x: left, y: 0, left, top: 0, right: left + width, bottom: 20, width, height: 20, toJSON: () => ({})});
}

describe("measureStage", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("只报越出舞台且没被裁剪容器挡住的元素", () => {
        document.body.innerHTML = `
            <div data-lab-stage>
                <p class="wide">越界</p>
                <div class="scroller" style="overflow-x: auto"><pre class="long">块内长行</pre></div>
                <span class="fits">正常</span>
            </div>`;
        const stage = document.querySelector<HTMLElement>("[data-lab-stage]")!;
        box(stage, 0, 390);
        box(stage.querySelector(".wide")!, 0, 430);
        box(stage.querySelector(".scroller")!, 0, 390);
        box(stage.querySelector(".long")!, 0, 900);
        box(stage.querySelector(".fits")!, 10, 100);

        const result = measureStage(stage);
        expect(result.offenders.map((offender) => [/\bp\b/u.test(offender.selector), offender.overflow])).toEqual([[true, 40]]);
        expect(result.box.width).toBe(390);
    });
});
