declare module "@mozilla/readability" {
    export class Readability {
        constructor(document: Document);
        parse(): {
            title?: string;
            excerpt?: string;
            content?: string;
        } | null;
    }
}

declare module "jsdom" {
    export class JSDOM {
        constructor(html: string, options?: {url?: string});
        window: {
            document: Document;
        };
    }
}

declare module "turndown" {
    export default class TurndownService {
        constructor(options?: {headingStyle?: string; codeBlockStyle?: string});
        use(plugin: unknown): void;
        addRule(name: string, rule: {
            filter(node: {nodeName: string; textContent?: string | null}): boolean;
            replacement(): string;
        }): void;
        turndown(html: string): string;
    }
}

declare module "turndown-plugin-gfm" {
    export const gfm: unknown;
}
