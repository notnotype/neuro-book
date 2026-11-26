<script setup lang="ts">
/**
 * 表单下面的社交图标（t09 第 7、10 条：登录页与注册页同一种画法；t10 计划 3.7；审定 D3）：一行“或”，下面 GitHub、Google 两枚图标。
 * 只发 `start`，发起请求、校验、跳转都是页面的事。
 *
 * 画法照两家的品牌规范（`assets/brands/README.md`）：Google 用素材包里整枚按钮的图（全彩“G”、规定的底与描边，亮暗各一份）；
 * GitHub 的 Invertocat 亮色用黑、暗色用白，套同样的底与描边。两种明暗的图都在页面里，按根元素的 `data-nb-appearance` 显示一份：
 * 明暗跟随系统随时会变（`host/theme.ts`），不用脚本换图。
 *
 * 外面一层是 nb-ui `IconButton`（焦点环、按下缩放、不可用的样子都用它的），里面的“按钮面”是品牌的图，填满它的内容区。
 */

import type {SocialProvider} from "@notnotype/nb-site-identity-contract/constants";
import {IconButton} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import githubDark from "../assets/brands/github-invertocat-white.svg";
import githubLight from "../assets/brands/github-invertocat-black.svg";
import googleDark from "../assets/brands/google-dark.svg";
import googleLight from "../assets/brands/google-light.svg";
import {useSiteText} from "../text";

const props = withDefaults(defineProps<{
    /** 图标的读屏名字与悬停提示按它写：“用 … 登录”或“用 … 注册”。 */
    intent: "login" | "register";
    /**
     * 各上游是否开放（`meta`）。没开放的那枚不画；两个都没开放时整行（连同“或”）不画，这是部署配置决定的，不是页面上会来回变的状态。
     * 还不知道（`meta` 在取或取不到）时给 `undefined`：两枚都画着占住位置，但不可点。
     */
    providers?: Readonly<Record<SocialProvider, boolean>>;
    /** 整行不可点（注册关闭、倒数、发起中）。 */
    disabled?: boolean;
}>(), {providers: undefined, disabled: false});

const emit = defineEmits<{start: [provider: SocialProvider]}>();

const t = useSiteText();

/** 画的先后照定稿：GitHub 在左，Google 在右。 */
const ORDER = ["github", "google"] as const satisfies readonly SocialProvider[];

const MARKS = {
    github: {light: githubLight, dark: githubDark},
    google: {light: googleLight, dark: googleDark},
} as const satisfies Record<SocialProvider, {light: string; dark: string}>;

const shown = computed(() => ORDER.filter((provider) => props.providers?.[provider] !== false));
const usable = computed(() => props.providers !== undefined && !props.disabled);

function label(provider: SocialProvider): string {
    return t(`social.${props.intent}.${provider}`);
}
</script>

<template>
    <div v-if="shown.length > 0" class="social" data-site-social>
        <p class="social-or">{{ t("social.or") }}</p>
        <div class="social-buttons">
            <IconButton
                v-for="provider in shown"
                :key="provider"
                size="lg"
                class="social-button"
                :title="label(provider)"
                :disabled="!usable"
                :data-site-social-provider="provider"
                @click="emit('start', provider)"
            >
                <span class="social-face" :class="`social-face--${provider}`" aria-hidden="true">
                    <img class="social-mark social-mark--light" :src="MARKS[provider].light" alt="" draggable="false">
                    <img class="social-mark social-mark--dark" :src="MARKS[provider].dark" alt="" draggable="false">
                </span>
            </IconButton>
        </div>
    </div>
</template>

<style scoped>
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
 * 按钮面填满 `IconButton` 的内容区（38px 减去两侧 1px 的透明边框）。Google 的图是 40×40 的整枚按钮（4px 圆角、1px 描边），
 * 按比例缩到这里；GitHub 的面照它画同样的圆角、底与描边，两枚看上去是同一种按钮。
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

.social-face--google .social-mark {
    width: 100%;
    height: 100%;
}

/*
 * Google 规范里亮暗两种按钮的底与描边（`assets/brands/README.md`），GitHub 的面照抄。
 * 暗色写成 `:root[...] .类`，不用 `:global(...)`：Vue 的 scoped 样式只保留 `:global()` 里的部分、丢掉后面的选择器，
 * 规则会落到根元素上；scoped 只给最后一段加作用域属性，前面写根元素的属性照样生效。
 */
.social-face--github {
    border: 1px solid #747775;
    background: #ffffff;
}

:root[data-nb-appearance="dark"] .social-face--github {
    border-color: #8e918f;
    background: #131314;
}

/* Invertocat 与 Google 的“G”同高：“G”占整枚按钮的一半。 */
.social-face--github .social-mark {
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
    .social-face {
        transition: none;
    }
}
</style>
