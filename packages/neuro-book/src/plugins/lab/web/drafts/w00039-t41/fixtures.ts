/** w00039 t41（人物设定组）第 2 轮的静态稿：人物、形象两个分页画在真实的条目页骨架里；评审板在那个 Task 的 artifacts/review。 */
import {defineLabFixture} from "../../fixtures/define";
import type CharacterViewDraft from "./CharacterViewDraft.vue";
import type LookViewDraft from "./LookViewDraft.vue";

export const fixtures = [
    defineLabFixture<typeof CharacterViewDraft>({
        component: "CharacterViewDraft",
        scenes: [
            {id: "filled", label: "填好的人物", input: {props: {scene: "filled"}}},
            {id: "no-look", label: "条目上没有形象这一组", input: {props: {scene: "no-look"}}},
            {id: "empty", label: "刚新建的人物", input: {props: {scene: "empty"}}},
            {id: "edit-suggest", label: "改一个有建议值的短项", input: {props: {scene: "edit-suggest"}}},
            {id: "edit-ref", label: "改一个指向条目的短项", input: {props: {scene: "edit-ref"}}},
            {id: "edit-text", label: "改一段文字", input: {props: {scene: "edit-text"}}},
            {id: "add-field", label: "添加一项资料", input: {props: {scene: "add-field"}}},
            {id: "origins", label: "点“第 N 章改过”看来历", input: {props: {scene: "origins"}}},
            {id: "semantic", label: "现在的状态：各句、记一句", input: {props: {scene: "semantic"}}},
        ],
        load: async () => (await import("./CharacterViewDraftFixture.vue")).default as never,
    }),
    defineLabFixture<typeof LookViewDraft>({
        component: "LookViewDraft",
        scenes: [
            {id: "filled", label: "填好的形象", input: {props: {scene: "filled"}}},
            {id: "empty", label: "刚加上、还空着", input: {props: {scene: "empty"}}},
            {id: "pick-image", label: "选立绘", input: {props: {scene: "pick-image"}}},
            {id: "wearing", label: "换装", input: {props: {scene: "wearing"}}},
        ],
        load: async () => (await import("./LookViewDraftFixture.vue")).default as never,
    }),
];
