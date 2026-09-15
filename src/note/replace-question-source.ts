/**
 * 按完整源行替换一张卡片。优先使用已验证的行号；没有行号时只接受唯一匹配。
 * 保留其他行及其换行符，避免相同文字的卡片被替换到第一处。
 */
export function replaceQuestionSource(
    source: string,
    original: string,
    replacement: string,
    preferredLine?: number,
): string {
    const lines = source.split("\n");
    const target = original.replaceAll("\r\n", "\n").split("\n");
    const matches = (line: number): boolean =>
        line >= 0 &&
        line + target.length <= lines.length &&
        target.every((text, index) => lines[line + index].trim() === text.trim());
    let line = preferredLine;
    if (line === undefined || !matches(line)) {
        const candidates = lines.flatMap((_, index) => (matches(index) ? [index] : []));
        if (candidates.length !== 1) {
            throw new Error("卡片原文已改变或无法唯一定位，请等待同步后重试。");
        }
        line = candidates[0];
    }
    const start = lines.slice(0, line).reduce((offset, text) => offset + text.length + 1, 0);
    const end = start + lines.slice(line, line + target.length).join("\n").length;
    const newline = lines[line]?.endsWith("\r") ? "\r\n" : "\n";
    const trailingCR = source[end - 1] === "\r" ? "\r" : "";
    const text = replacement.replaceAll("\r\n", "\n").replaceAll("\n", newline);
    return source.slice(0, start) + text + trailingCR + source.slice(end);
}
