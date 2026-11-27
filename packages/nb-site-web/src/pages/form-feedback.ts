/**
 * 稿纸页表单共用的失败反馈（t10 计划 3.1“状态行与表单错误”；审定 D9）：状态行上的一条原因、标红的字段、`rate_limited` 的倒数。
 * 登录、注册、同意三页都照这一种做法：提交之后才知道的错，对应字段标红并得到焦点，原因写在卡片里固定位置的状态行（`FormStatus`），
 * 不在字段下插字；按码分支，不按文案。
 *
 * 标红经 nb-ui `Field` 的 `error`（或勾选框的 `invalid`）：给的是状态行上的同一句话，读屏读字段时连原因一起读，看得见的只有状态行这一处。
 * 时间取注入的时钟（`host/clock.ts`），组件测试手动推进。在 `setup` 里调用：卸载时停掉倒数。
 *
 * 状态行上有两类原因：提交之后服务端给的（`showFailure`），与页面自己查出的规则说明（`showRule`，离开一个字段时或发起之前查）。
 * 两类撤掉的时机不同：规则说明在他改了被说的那一项时就撤，服务端给的原因留到下一次提交。哪一条是规则说明由 `StatusEntry.rule` 记着，
 * 页面不用从 `reason` 里认。
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

/**
 * 状态行上的一条：`reason` 是哪件事（失败码，或页面自己判出的），`action` 是跟在原因后面的链接。`tone` 缺省是失败；
 * `success` 是账号页每一节保存成功之后的那一句（计划 3.12），由 `showSuccess` 写，到时自己清掉。
 */
export interface StatusEntry {
    readonly reason: string;
    readonly text: TextRef;
    readonly action?: "register";
    readonly tone?: "success";
    /** 规则说明（`showRule` 写的）说的是哪几项；他改了其中一项就撤掉这一条。 */
    readonly rule?: readonly string[];
    /** 原因前面的一句（批量操作做到哪了，例如“结束了 1 个，2 个没结束”），与原因连成一句；倒数照常。 */
    readonly lead?: TextRef;
}

/** 一项的规则：合规则回 `undefined`，否则回说明规则的那句话。 */
export type FieldRule = () => TextRef | undefined;

export interface FormFeedbackOptions<Field extends string> {
    /** 离开字段时要查的规则（`onLeave`）；没列的项离开时不查。 */
    readonly rules?: Partial<Record<Field, FieldRule>>;
}

/** 超过这么多秒的等待按分钟写（`Retry-After` 可以长到一小时，四位数的秒每秒一变没有意义）。 */
const MINUTES_ABOVE_SECONDS = 60;

/** 成功的那一句在状态行上留多久（计划 3.12：“已保存”3 秒后清空）。 */
export const SUCCESS_STATUS_MS = 3_000;

export interface FormFeedback<Field extends string> {
    readonly status: ShallowRef<StatusEntry | undefined>;
    /** 正在按 `Retry-After` 倒数：这段时间里提交与发起都不可用。 */
    readonly waiting: ComputedRef<boolean>;
    /** 状态行上看得见的字；倒数时一分钟以内每秒一变，更长的按分钟写、每分钟一变。 */
    readonly statusText: ComputedRef<string>;
    /** 给读屏的固定说法（`FormStatus` 的 `spoken`）；倒数时是一句不带秒数的话，别的时候空着。 */
    readonly statusSpoken: ComputedRef<string>;
    /**
     * 不会随倒数变的那句：倒数时是 `statusSpoken`，别的时候是 `statusText`。给只有一串字、看得见与读屏不能分开的地方（nb-ui `Dialog`
     * 的 `status` 是 polite 的 live region）：用 `statusText` 的话读屏每秒播报一遍。
     */
    readonly statusSteady: ComputedRef<string>;
    /** 标红的字段给 `Field` 的 `error`：状态行上的那句话；没标红时是空串。 */
    fieldError(field: Field): string;
    isInvalid(field: Field): boolean;
    /**
     * 标红这些字段，焦点给第一个（表单里 `name` 是它的那个输入框或多行输入框）。`focus: false` 只标红：离开一个字段时查出的不合规则，
     * 焦点已经去了下一个字段，不拉回来。
     */
    mark(fields: readonly Field[], options?: {readonly focus?: boolean}): Promise<void>;
    /** 撤掉标红；原因留在状态行。 */
    unmark(): void;
    /**
     * 写一条规则说明：状态行写 `text`、标红这些项。缺省不聚焦（离开字段时查出的，焦点已经去了下一项）；发起之前查出的给
     * `focus: true`，焦点给第一项。
     */
    showRule(fields: readonly Field[], text: TextRef, options?: {readonly focus?: boolean}): void;
    /**
     * 表单上冒上来的 `input`、`change`：他改了一项。状态行上是服务端给的原因时，标红过时了、撤掉，原因留到下次提交；是规则说明时，
     * 改的是它说的那一项才连同标红一起撤。只接他的输入事件，不 `watch` 字段的值：页面自己写回的值（还原草稿、撤掉勾选）不该撤掉刚标上的红。
     */
    onEdited(event: Event): void;
    /** 表单上冒上来的 `focusout`：离开一个填了字的字段时查它的规则（`options.rules`），不合就 `showRule`。没填的不说，提交按钮本来就不可用。 */
    onLeave(event: FocusEvent): void;
    /** 提交之前清掉上一次的原因与标红：再错同一个码时状态行淡出又淡入，看得出这次提交确实有了回答。 */
    reset(): void;
    /**
     * 把一次接口失败写上状态行，`rate_limited` 另开始倒数。统一处理已经接管的（会话没了、同意门槛）回 `false`、什么都不写：
     * 它会把人带走。哪些字段标红由页面按码决定。`lead` 写在原因前面（`StatusEntry.lead`）。
     */
    showFailure(failure: Failure, options?: {readonly lead?: TextRef}): boolean;
    /** 写一句成功的话（`tone: "success"`），`SUCCESS_STATUS_MS` 之后清掉；这期间换成了别的一条时不清别的。 */
    showSuccess(reason: string, text: TextRef): void;
}

/**
 * `form` 是放这些字段的元素（稿纸页是表单，账号页是一节），标红后按 `name` 在它里面找输入框给焦点。
 */
export function useFormFeedback<Field extends string>(
    form: Readonly<Ref<HTMLElement | null>>,
    clock: SiteClock,
    options: FormFeedbackOptions<Field> = {},
): FormFeedback<Field> {
    const port = useText();
    const status = shallowRef<StatusEntry>();
    const invalid = shallowRef<ReadonlySet<Field>>(new Set());

    // `rate_limited` 的倒数：到 `retryAt` 之前提交按钮不可用。计时每秒一次（要知道什么时候到点）；按分钟写时字只在分钟数变了才变。
    const retryAt = shallowRef<number>();
    const now = shallowRef(clock.now());
    let stopTicking: (() => void) | undefined;

    const waitSeconds = computed(() => (retryAt.value === undefined ? 0 : Math.max(0, Math.ceil((retryAt.value - now.value) / 1000))));
    const waiting = computed(() => retryAt.value !== undefined);

    function withLead(reason: string): string {
        const lead = status.value?.lead;
        return lead === undefined ? reason : port.t(siteRef("form.leadReason", {lead: port.t(lead), reason}));
    }

    const statusText = computed(() => {
        const current = status.value;
        if (current === undefined) return "";
        if (current.reason !== "rate_limited") return withLead(port.t(current.text));
        const seconds = waitSeconds.value;
        if (seconds > MINUTES_ABOVE_SECONDS) return withLead(port.t(siteRef("form.rateLimitedMinutes", {minutes: Math.ceil(seconds / 60)})));
        return withLead(port.t(codeText("identity", "rate_limited", {seconds})));
    });

    // 倒数时看得见的字会变，读屏只听一句不带秒数的；字段的 `error` 也给这句，读字段时不读过时的数。
    const statusSpoken = computed(() => (status.value?.reason === "rate_limited" ? withLead(port.t(siteRef("form.rateLimitedSpoken"))) : ""));
    const statusSteady = computed(() => statusSpoken.value || statusText.value);

    function stopCountdown(): void {
        stopTicking?.();
        stopTicking = undefined;
    }

    // 成功那一句的清除：时钟只有按间隔重复的计时，到点第一次就停掉。
    let stopSuccessTimer: (() => void) | undefined;

    function stopSuccess(): void {
        stopSuccessTimer?.();
        stopSuccessTimer = undefined;
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

    onBeforeUnmount(() => {
        stopCountdown();
        stopSuccess();
    });

    async function mark(fields: readonly Field[], markOptions?: {readonly focus?: boolean}): Promise<void> {
        invalid.value = new Set(fields);
        const first = fields[0];
        if (first === undefined || markOptions?.focus === false) return;
        // 标红要等这一轮渲染之后才落到控件上，所以聚焦放在 `nextTick`。
        await nextTick();
        form.value?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`input[name="${first}"], textarea[name="${first}"]`)?.focus();
    }

    function unmark(): void {
        if (invalid.value.size > 0) invalid.value = new Set();
    }

    function showRule(fields: readonly Field[], text: TextRef, ruleOptions?: {readonly focus?: boolean}): void {
        status.value = {reason: "rule", text, rule: fields};
        void mark(fields, {focus: ruleOptions?.focus === true});
    }

    /** 事件来自表单里哪一项（输入框、多行输入框、勾选框的 `name`）。 */
    function fieldNameOf(event: Event): string | undefined {
        const target = event.target;
        return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.name : undefined;
    }

    return {
        status,
        waiting,
        statusText,
        statusSpoken,
        statusSteady,
        fieldError: (field) => (invalid.value.has(field) ? statusSpoken.value || statusText.value : ""),
        isInvalid: (field) => invalid.value.has(field),
        mark,
        unmark,
        showRule,
        onEdited(event) {
            const rule = status.value?.rule;
            if (rule === undefined) {
                unmark();
                return;
            }
            // 规则说明与它的标红同进退：改的是别的项时两样都留着，状态行上的话仍说得通。
            const name = fieldNameOf(event);
            if (name === undefined || !rule.includes(name)) return;
            status.value = undefined;
            unmark();
        },
        onLeave(event) {
            const name = fieldNameOf(event);
            const rules = options.rules;
            if (name === undefined || name === "" || rules === undefined || !Object.hasOwn(rules, name)) return;
            if ((event.target as HTMLInputElement | HTMLTextAreaElement).value === "") return;
            const field = name as Field;
            const text = rules[field]?.();
            if (text !== undefined) showRule([field], text);
        },
        reset() {
            status.value = undefined;
            invalid.value = new Set();
        },
        showFailure(failure, failureOptions) {
            if (failure.kind === "code" && failure.handled === true) return false;
            const lead = failureOptions?.lead;
            status.value = {reason: failure.kind === "code" ? failure.code : failure.kind, text: failureText("identity", failure), ...(lead === undefined ? {} : {lead})};
            if (failure.kind === "code" && failure.code === "rate_limited") startCountdown(failure.retryAfterSeconds ?? RETRY_AFTER_FALLBACK_SECONDS);
            return true;
        },
        showSuccess(reason, text) {
            stopSuccess();
            const entry: StatusEntry = {reason, text, tone: "success"};
            status.value = entry;
            stopSuccessTimer = clock.every(SUCCESS_STATUS_MS, () => {
                stopSuccess();
                if (status.value === entry) status.value = undefined;
            });
        },
    };
}
