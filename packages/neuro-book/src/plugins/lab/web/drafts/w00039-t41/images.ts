/** t41 草稿原来借了 Lyra 的头像与贴纸当立绘、服装图；入库时换成 Lab 的样本图，不跨插件引素材。 */
import {SAMPLE_IMAGES} from "../../fixtures/canon-images";

const pick = (path: string): string => SAMPLE_IMAGES[path] ?? "";

export const portraitSrc = pick("插图/星瑕-立绘.png");
export const imageHome = pick("插图/星瑕-便服.png");
export const imageUniform = pick("插图/星瑕-学院制服.png");
export const imageDress = pick("插图/星瑾-立绘.png");
export const imageShy = pick("插图/星瑾-立绘.png");
export const imageIdea = pick("插图/星瑕-学院制服.png");
export const imageThink = pick("插图/星瑕-便服.png");
