/**
 * 编码 RFC 5987 filename* 参数值。
 *
 * encodeURIComponent 不会转义 !'()*，但这些字符不属于 filename* 的稳定 attr-char 子集。
 */
export function encodeRfc5987Filename(filename: string): string {
    return encodeURIComponent(filename).replace(
        /[!'()*]/gu,
        (character) => `%${character.codePointAt(0)!.toString(16).toUpperCase()}`,
    );
}
