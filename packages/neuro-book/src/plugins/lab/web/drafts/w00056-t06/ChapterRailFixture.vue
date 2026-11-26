<script setup lang="ts">
/** 章节条单独看（Lab）：压在一块暗绒上，和首页第一幕里一样宽，下面一句字幕，看它在桌布上的样子。 */
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import VELVET from "./assets/velvet.webp";
import ChapterRail from "./ChapterRail.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ChapterRail>(() => props.input, ["jump", "pause", "resume", "replay"]);
</script>

<template>
    <div class="crf" :style="{'--crf-velvet': `url(${VELVET})`}" data-lab-subject>
        <ChapterRail class="crf__rail" v-bind="subject.bindings.value" />
        <p class="crf__line">哪里埋了伏笔、哪里待改，一翻就看见。</p>
    </div>
</template>

<style scoped>
.crf {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 100%;
    padding: 40px 24px;
    background:
        radial-gradient(60% 70% at 50% 40%, rgb(104 16 32 / 0.42), transparent 78%),
        linear-gradient(rgb(16 3 7 / 0.35), rgb(16 3 7 / 0.55)),
        var(--crf-velvet) center / cover,
        #22040a;
}

/* 条尾挂在右边、不占章节条的宽：两边各留出它的位置，留不出来时条收到 360 以下、条尾挪下去（见 ChapterRail.md）。 */
.crf__rail {
    width: max(min(600px, 100% - 2 * var(--cr-tail)), min(100%, 360px));
}

.crf__line {
    margin: 0;
    color: #ece4d4;
    font-family: "Source Han Serif SC", "Noto Serif CJK SC", serif;
    font-size: 17px;
    letter-spacing: 0.05em;
    text-align: center;
}
</style>
