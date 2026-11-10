import {describe, expect, test} from "bun:test";
import {effectScope, nextTick, type EffectScope} from "vue";
import {useAnswerDraft} from "../src/web/host/answer-draft.js";
import {emptyAnswerDraft} from "../src/web/host/answers.js";
import {useWebEnv} from "./web-env.js";

/**
 * 评审板的填写存在本机（t21）：产物页打开时读回上次没交的填写，改一处存一次；提交成功、自己关闭评审后清掉。
 * “重新打开页面”用新的 scope 再调一次 `useAnswerDraft`，与产物页按路径参数重建实例时一样。
 */
const scopes: EffectScope[] = [];
useWebEnv(() => {
    for (const scope of scopes.splice(0)) scope.stop();
});

function openPage(target: string): ReturnType<typeof useAnswerDraft> {
    const scope = effectScope();
    scopes.push(scope);
    return scope.run(() => useAnswerDraft(target))!;
}

const REVIEW = "w00022-dev-panel/t21-panel-answer-drafts/review";

describe("答复草稿", () => {
    test("填了选项、文字、说明与备注，离开再回来都还在；另一块评审看不到", async () => {
        const page = openPage(REVIEW);
        page.draft.value = {...page.draft.value, values: {pick: "b", words: "第二段太长"}, touched: {pick: true, words: true}};
        page.draft.value = {...page.draft.value, comments: {pick: "倾向乙"}, commenting: {pick: true}, note: "整体可以"};
        await nextTick();

        expect(openPage(REVIEW).draft.value).toEqual({values: {pick: "b", words: "第二段太长"}, touched: {pick: true, words: true}, comments: {pick: "倾向乙"}, commenting: {pick: true}, editing: {}, note: "整体可以"});
        expect(openPage("w00022-dev-panel/t21-panel-answer-drafts/other").draft.value).toEqual(emptyAnswerDraft());
    });

    test("提交成功或关闭评审后清掉：再打开是空的，存储里也不留这一项", async () => {
        const page = openPage(REVIEW);
        page.draft.value = {...page.draft.value, values: {words: "要改"}, touched: {words: true}};
        await nextTick();
        expect(localStorage.getItem(`nbdev-panel:answer-draft:${REVIEW}`)).not.toBeNull();

        page.clear();
        await nextTick();
        expect(localStorage.getItem(`nbdev-panel:answer-draft:${REVIEW}`)).toBeNull();
        expect(openPage(REVIEW).draft.value).toEqual(emptyAnswerDraft());
    });

    test("清空了的题、只展开了空说明框、备注只有空白：没有值得留的，不存", async () => {
        const page = openPage(REVIEW);
        page.draft.value = {...page.draft.value, values: {pick: undefined, words: "  "}, touched: {pick: false, words: false}, commenting: {pick: true}, note: " \n"};
        await nextTick();
        expect(localStorage.getItem(`nbdev-panel:answer-draft:${REVIEW}`)).toBeNull();
    });

    test("点了“改答”还没改的题也留着，回来仍是改答的样子", async () => {
        const page = openPage(REVIEW);
        page.draft.value = {...page.draft.value, values: {pick: ["a"]}, editing: {pick: true}};
        await nextTick();
        expect(openPage(REVIEW).draft.value.editing).toEqual({pick: true});
    });

    test("存坏了（不是 JSON、形状不对）按没有草稿处理，页面照常打开", () => {
        localStorage.setItem(`nbdev-panel:answer-draft:${REVIEW}`, "{坏的");
        expect(openPage(REVIEW).draft.value).toEqual(emptyAnswerDraft());
        localStorage.setItem(`nbdev-panel:answer-draft:${REVIEW}`, JSON.stringify({values: {}, touched: {pick: "yes"}, comments: {}, commenting: {}, editing: {}, note: ""}));
        expect(openPage(REVIEW).draft.value).toEqual(emptyAnswerDraft());
    });
});
