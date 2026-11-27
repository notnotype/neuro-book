<script setup lang="ts">
/**
 * 表单下面的社交图标（t09 第 7、10 条：登录页与注册页同一种画法；t10 计划 3.7；审定 D3）：一行“或”，下面 GitHub、Google 两枚图标。
 * 只发 `start`，发起请求、校验、跳转都是页面的事。
 *
 * 画法照两家的品牌规范（`assets/brands/README.md`）：按钮面的底与描边由 CSS 按规范的数值画，亮暗两种；中间是标志。Google 的全彩“G”
 * 亮暗共用一份图；GitHub 的 Invertocat 亮色用黑、暗色用白，两份图都在页面里，按根元素的 `data-nb-appearance` 显示一份：
 * 明暗跟随系统随时会变（`host/theme.ts`），不用脚本换图。
 *
 * 外面一层是 nb-ui `IconButton`（焦点环、按下缩放、不可用的样子都用它的），里面的“按钮面”填满它的内容区。
 *
 * 开放情况（`meta`）回来之前、取不到时整行不画：先画再撤会让下面的东西先下后上（B4 审查第 16 条）。回来后有开放的上游时，
 * 这一行从零高展开、淡入；没有就一直不出现。
 */

import type {SocialProvider} from "@notnotype/nb-site-identity-contract/constants";
import {IconButton} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import githubDark from "../assets/brands/github-invertocat-white.svg";
import githubLight from "../assets/brands/github-invertocat-black.svg";
import googleMark from "../assets/brands/google-g.svg";
import {useSiteText} from "../text";

const props = withDefaults(defineProps<{
    /** 图标的读屏名字与悬停提示按它写：“用 … 登录”或“用 … 注册”。 */
    intent: "login" | "register";
    /**
     * 各上游是否开放（`meta`）。没开放的那枚不画；两个都没开放时整行（连同“或”）不画。还不知道（`meta` 在取或取不到）时给 `undefined`：
     * 整行也不画。
     */
    providers?: Readonly<Record<SocialProvider, boolean>>;
    /** 整行不可点（注册关闭、倒数、发起中）。 */
    disabled?: boolean;
}>(), {providers: undefined, disabled: false});

const emit = defineEmits<{start: [provider: SocialProvider]}>();

const t = useSiteText();

/** 画的先后照定稿：GitHub 在左，Google 在右。 */
const ORDER = ["github", "google"] as const satisfies readonly SocialProvider[];

/** 每个上游的标志：亮暗各一份（Invertocat 黑与白），或共用一份（Google 的全彩“G”只有一种）。 */
const MARKS = {
    github: {light: githubLight, dark: githubDark},
    google: {light: googleMark, dark: googleMark},
} as const satisfies Record<SocialProvider, {light: string; dark: string}>;

/** 亮暗用不同的图：两张都画，样式按明暗显示一张。 */
function themed(provider: SocialProvider): boolean {
    return MARKS[provider].light !== MARKS[provider].dark;
}

const shown = computed(() => (props.providers === undefined ? [] : ORDER.filter((provider) => props.providers?.[provider] === true)));

function label(provider: SocialProvider): string {
    return t(`social.${props.intent}.${provider}`);
}
</script>

<template>
    <!-- 外层一直在：展开靠它的一行从 0fr 过渡到 1fr。里面的内容只在有开放的上游时画。 -->
    <div class="social" :class="{'is-open': shown.length > 0}" data-site-social-row>
        <div class="social__clip">
            <div v-if="shown.length > 0" data-site-social>
                <p class="social-or">{{ t("social.or") }}</p>
                <div class="social-buttons">
                    <IconButton
                        v-for="provider in shown"
                        :key="provider"
                        size="lg"
                        class="social-button"
                        :title="label(provider)"
                        :disabled="props.disabled"
                        :data-site-social-provider="provider"
                        @click="emit('start', provider)"
                    >
                        <span class="social-face" :class="`social-face--${provider}`" aria-hidden="true">
                            <img class="social-mark" :class="{'social-mark--light': themed(provider)}" :src="MARKS[provider].light" alt="" draggable="false">
                            <img v-if="themed(provider)" class="social-mark social-mark--dark" :src="MARKS[provider].dark" alt="" draggable="false">
                        </span>
                    </IconButton>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * 展开：一行从 0fr 到 1fr（不用量内容的高度），同时淡入；时长用 nb-ui 的动效变量，减弱动效时它们是 0，直接出现。
 * 裁切层要 `overflow: hidden` 才收得到零高，焦点环与悬停那一圈会伸出按钮外几像素：裁切层左右与下方多留 6px 的内边距、再用同样的负外边距
 * 抵掉，收起时仍是零高，展开后那一圈不被裁掉。
 */
.social {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition: grid-template-rows var(--motion-base) var(--ease-layout), opacity var(--motion-base) var(--ease-layout);
}

.social.is-open {
    grid-template-rows: 1fr;
    opacity: 1;
}

.social__clip {
    min-height: 0;
    margin: 0 -6px -6px;
    padding: 0 6px 6px;
    overflow: hidden;
}

.social-or {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0 14px;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.social-or::before,
.social-or::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--border-color);
}

.social-buttons {
    display: flex;
    justify-content: center;
    gap: 16px;
}

/*
 * 按钮面填满 `IconButton` 的内容区（38px 减去两侧 1px 的透明边框）。Google 规范的按钮是 40×40（4px 圆角、1px 描边），按比例缩到这里；
 * 两枚画同样的圆角、底与描边，看上去是同一种按钮。
 */
.social-face {
    --social-face-size: 36px;
    position: relative;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: var(--social-face-size);
    height: var(--social-face-size);
    border-radius: calc(var(--social-face-size) * 4 / 40);
    transition: box-shadow var(--motion-fast) var(--ease-layout);
}

/* 悬停在品牌的面外面加一圈淡色，不改面本身（两家都不许改标志的颜色）。 */
.social-button:not(:disabled):hover .social-face {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-main) 12%, transparent);
}

/*
 * Google 规范里亮暗两种按钮的底与描边（`assets/brands/README.md`），GitHub 的面照抄。
 * 暗色写成 `:root[...] .类`，不用 `:global(...)`：Vue 的 scoped 样式只保留 `:global()` 里的部分、丢掉后面的选择器，
 * 规则会落到根元素上；scoped 只给最后一段加作用域属性，前面写根元素的属性照样生效。
 */
.social-face {
    border: 1px solid #747775;
    background: #ffffff;
}

:root[data-nb-appearance="dark"] .social-face {
    border-color: #8e918f;
    background: #131314;
}

/* 标志占按钮面的一半高（规范里 40px 的按钮配 20px 的“G”）；Invertocat 与“G”同高。 */
.social-mark {
    height: calc(var(--social-face-size) / 2);
}

.social-mark--dark {
    display: none;
}

:root[data-nb-appearance="dark"] .social-mark--light {
    display: none;
}

:root[data-nb-appearance="dark"] .social-mark--dark {
    display: block;
}

@media (prefers-reduced-motion: reduce) {
    .social,
    .social-face {
        transition: none;
    }
}
</style>
