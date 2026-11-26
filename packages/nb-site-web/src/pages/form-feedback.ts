/**
 * 稿纸页表单共用的失败反馈（t10 计划 3.1“状态行与表单错误”；审定 D9）：状态行上的一条原因、标红的字段、`rate_limited` 的倒数。
 * 登录、注册、同意三页都照这一种做法：提交之后才知道的错，对应字段标红并得到焦点，原因写在卡片里固定位置的状态行（`FormStatus`），
 * 不在字段下插字；按码分支，不按文案。
 *
 * 标红经 nb-ui `Field` 的 `error`（或勾选框的 `invalid`）：给的是状态行上的同一句话，读屏读字段时连原因一起读，看得见的只有状态行这一处。
 * 时间取注入的时钟（`host/clock.ts`），组件测试手动推进。在 `setup` 里调用：卸载时停掉倒数。
 */

import type {TextRef} from "@notnotype/nb-ui/text";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, onBeforeUnmount, shallowRef} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import {RETRY_AFTER_FALLBACK_SECONDS} from "../http/core";
import type {Failure} from "../http/core";
import {codeText, failureText} from "../http/failure-text";
import type {SiteClock} from "../host/clock";
import {siteRef} from "../text";

/** 状态行上的一条：`reason` 是哪件事（失败码，或页面自己判出的），`action` 是跟在原因后面的链接。 */
export interface StatusEntry {
    readonly reason: string;
    readonly text: TextRef;
    readonly action?: "register";
}

export interface FormFeedback<Field extends string> {
    readonly status: ShallowRef<StatusEntry | undefined>;
    /** 正在按 `Retry-After` 倒数：这段时间里提交与发起都不可用。 */
    readonly waiting: ComputedRef<boolean>;
    /** 状态行上看得见的字；倒数时每秒一变。 */
    readonly statusText: ComputedRef<string>;
    /** 给读屏的固定说法（`FormStatus` 的 `spoken`）；倒数时是一句不带秒数的话，别的时候空着。 */
    readonly statusSpoken: ComputedRef<string>;
    /** 标红的字段给 `Field` 的 `error`：状态行上的那句话；没标红时是空串。 */
    fieldError(field: Field): string;
    isInvalid(field: Field): boolean;
    /**
     * 标红这些字段，焦点给第一个（表单里 `name` 是它的那个输入框）。`focus: false` 只标红：离开一个字段时查出的不合规则，
     * 焦点已经去了下一个字段，不拉回来。
     */
    mark(fields: readonly Field[], options?: {readonly focus?: boolean}): Promise<void>;
    /** 撤掉标红；原因留在状态行。 */
    unmark(): void;
    /** 提交之前清掉上一次的原因与标红：再错同一个码时状态行淡出又淡入，看得出这次提交确实有了回答。 */
    reset(): void;
    /**
     * 把一次接口失败写上状态行，`rate_limited` 另开始倒数。统一处理已经接管的（会话没了、同意门槛）回 `false`、什么都不写：
     * 它会把人带走。哪些字段标红由页面按码决定。
     */
    showFailure(failure: Failure): boolean;
}

export function useFormFeedback<Field extends string>(form: Readonly<Ref<HTMLFormElement | null>>, clock: SiteClock): FormFeedback<Field> {
    const port = useText();
    const status = shallowRef<StatusEntry>();
    const invalid = shallowRef<ReadonlySet<Field>>(new Set());

    // `rate_limited` 的倒数：到 `retryAt` 之前提交按钮不可用，状态行每秒改一次秒数。
    const retryAt = shallowRef<number>();
    const now = shallowRef(clock.now());
    let stopTicking: (() => void) | undefined;

    const waitSeconds = computed(() => (retryAt.value === undefined ? 0 : Math.max(0, Math.ceil((retryAt.value - now.value) / 1000))));
    const waiting = computed(() => retryAt.value !== undefined);

    const statusText = computed(() => {
        const current = status.value;
        if (current === undefined) return "";
        if (current.reason === "rate_limited") return port.t(codeText("identity", "rate_limited", {seconds: waitSeconds.value}));
        return port.t(current.text);
    });

    // 倒数时看得见的字每秒一变，读屏只听一句不带秒数的；字段的 `error` 也给这句，读字段时不读过时的秒数。
    const statusSpoken = computed(() => (status.value?.reason === "rate_limited" ? port.t(siteRef("form.rateLimitedSpoken")) : ""));

    function stopCountdown(): void {
        stopTicking?.();
        stopTicking = undefined;
    }

    function startCountdown(seconds: number): void {
        stopCountdown();
        now.value = clock.now();
        // 至少等一秒：`Retry-After: 0` 时按钮也先不可用一下，免得连点又撞上同一次限流。
        const until = now.value + Math.max(1, seconds) * 1000;
        retryAt.value = until;
        stopTicking = clock.every(1000, () => {
            now.value = clock.now();
            if (now.value < until) return;
            stopCountdown();
            retryAt.value = undefined;
            if (status.value?.reason === "rate_limited") status.value = undefined;
        });
    }

    onBeforeUnmount(stopCountdown);

    return {
        status,
        waiting,
        statusText,
        statusSpoken,
        fieldError: (field) => (invalid.value.has(field) ? statusSpoken.value || statusText.value : ""),
        isInvalid: (field) => invalid.value.has(field),
        async mark(fields, options) {
            invalid.value = new Set(fields);
            const first = fields[0];
            if (first === undefined || options?.focus === false) return;
            // 标红要等这一轮渲染之后才落到控件上，所以聚焦放在 `nextTick`。
            await nextTick();
            form.value?.querySelector<HTMLInputElement>(`input[name="${first}"]`)?.focus();
        },
        unmark() {
            if (invalid.value.size > 0) invalid.value = new Set();
        },
        reset() {
            status.value = undefined;
            invalid.value = new Set();
        },
        showFailure(failure) {
            if (failure.kind === "code" && failure.handled === true) return false;
            status.value = {reason: failure.kind === "code" ? failure.code : failure.kind, text: failureText("identity", failure)};
            if (failure.kind === "code" && failure.code === "rate_limited") startCountdown(failure.retryAfterSeconds ?? RETRY_AFTER_FALLBACK_SECONDS);
            return true;
        },
    };
}
