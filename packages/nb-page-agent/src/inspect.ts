/**
 * 一次调用里对元素的查询（看不看得见、角色、名字、身份），按元素缓存。只在一次调用里用：页面随时在变，跨调用的缓存会过时。
 */

import {KEY_ATTRIBUTE, TARGET_ATTRIBUTE} from "./api";
import {collapse, composedParent} from "./dom";
import type {Identity} from "./refs";
import {nameOf, roleOf} from "./snapshot/describe";
import {enter, intersect, isEmptyBox, rootContext} from "./snapshot/walk";
import type {Entered} from "./snapshot/walk";

/** 身份里的名字至多存这么长：只用来比对，太长的名字截掉后仍能区分绝大多数元素。 */
const IDENTITY_NAME_CHARS = 512;

export class Inspector {
    readonly document: Document;
    readonly #entered = new Map<Element, Entered | null>();
    readonly #names = new Map<Element, string>();
    readonly #roles = new Map<Element, string | null>();

    constructor(document: Document) {
        this.document = document;
    }

    /** 遍历时已经算过的结果交给这里，后面查身份不再重放祖先链。 */
    remember(element: Element, entered: Entered | null): void {
        this.#entered.set(element, entered);
    }

    /** 元素的 `enter` 结果；它或祖先不画出来时为 null。 */
    entered(element: Element): Entered | null {
        if (this.#entered.has(element)) return this.#entered.get(element)!;
        const parent = composedParent(element);
        let result: Entered | null;
        if (parent === null) {
            result = enter(element, rootContext(this.document));
        } else {
            const parentEntered = this.entered(parent);
            result = parentEntered?.child ? enter(element, parentEntered.child) : null;
        }
        this.#entered.set(element, result);
        return result;
    }

    /** 画出来了：没被隐藏，也没被不滚动的裁剪框裁成零面积；滚出滚动容器的仍算（高亮会先把它滚进视野）。 */
    isRendered(element: Element): boolean {
        const entered = this.entered(element);
        if (entered === null || entered.visibilityHidden) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            // display: contents 的元素自己没有框，看它的子元素。
            return [...element.children].some((child) => this.isRendered(child));
        }
        return !isEmptyBox(intersect(rect, entered.clips.hard));
    }

    role(element: Element): string | null {
        if (!this.#roles.has(element)) this.#roles.set(element, roleOf(element));
        return this.#roles.get(element)!;
    }

    name(element: Element): string {
        let name = this.#names.get(element);
        if (name === undefined) {
            name = nameOf(element);
            this.#names.set(element, name);
        }
        return name;
    }

    /** 元素现在的身份；它不画出来时没有层可言，为 null。 */
    identity(element: Element): Identity | null {
        const entered = this.entered(element);
        if (entered === null) return null;
        return this.identityWith(element, entered.layer);
    }

    identityWith(element: Element, layer: Element | null): Identity {
        return {
            role: this.role(element) ?? "",
            name: collapse(this.name(element)).slice(0, IDENTITY_NAME_CHARS),
            target: element.getAttribute(TARGET_ATTRIBUTE),
            key: element.getAttribute(KEY_ATTRIBUTE),
            layer: layer === null ? null : new WeakRef(layer),
            layerRole: layer === null ? null : this.role(layer),
            layerName: layer === null ? null : this.name(layer),
        };
    }
}
