import {clsx} from "clsx";
import type {ClassValue} from "clsx";
import {twMerge} from "tailwind-merge";

/**
 * 合并类名，冲突的原子类后者胜出。
 *
 * 组件把自己的默认外观和调用方传进来的 class 拼在一起时，光靠拼接是不够的：
 * `w-full` 与 `w-[170px]` 特指度相同，谁生效取决于两条规则在最终样式表里的先后，
 * 而组件库的预编译 CSS 与宿主应用的原子类引擎不是同一张表，先后不由本包决定。
 * twMerge 在**类名层**就把前一个删掉，于是「调用方传的覆盖组件默认」成为确定行为。
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
