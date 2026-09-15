import type { ParsedQuestionInfo } from "src/parser";

/**
 * 根据保存前后的完整文本，重新找到正在复习的问题。
 *
 * 此函数不依赖编辑器或 Obsidian 状态。调用方应只在同一文件的保存事件中传入
 * 新解析出的问题列表；若返回 null，调用方必须把当前卡片视为失效，不能按数组下标
 * 或相同文本猜测另一张卡片。
 */
export function findUpdatedReviewQuestion(
    previousSource: string,
    currentQuestion: ParsedQuestionInfo,
    nextSource: string,
    nextQuestions: readonly ParsedQuestionInfo[],
): ParsedQuestionInfo | null {
    const oldSource = normalizeLineEndings(previousSource);
    const newSource = normalizeLineEndings(nextSource);
    const oldQuestionRange = getQuestionRange(oldSource, currentQuestion);
    if (!oldQuestionRange) return null;

    const candidateList = nextQuestions
        .map((question) => ({ question, range: getQuestionRange(newSource, question) }))
        .filter(
            (
                item,
            ): item is {
                question: ParsedQuestionInfo;
                range: TextRange;
            } => item.range !== null,
        );

    // 唯一 block ID 比文本和行号稳定得多：它允许整张卡片改写后仍可靠地重新关联。
    // 一旦发现同一 ID 在任一版本中重复，身份已不再可靠，绝不能退回到位置匹配。
    const blockIdList = getBlockIdList(currentQuestion.text);
    if (blockIdList.length > 0) {
        if (blockIdList.length !== 1) return null;

        const blockId = blockIdList[0];
        if (countBlockId(oldSource, blockId) !== 1 || countBlockId(newSource, blockId) !== 1) {
            return null;
        }
        const blockIdMatch = findUniqueCandidate(
            candidateList.filter(({ question }) => {
                const candidateBlockIdList = getBlockIdList(question.text);
                return candidateBlockIdList.length === 1 && candidateBlockIdList[0] === blockId;
            }),
        );
        if (blockIdMatch) return blockIdMatch.question;
        return null;
    }

    // 没有唯一 block ID 时，新增完整重复块必然导致身份歧义。删除完整块也不能
    // 判断留下的是哪一个旧对象；但仅改写某一重复块内部时仍可凭源范围可靠关联。
    const originalQuestionSource = oldSource.slice(oldQuestionRange.start, oldQuestionRange.end);
    const edit = findSingleEdit(oldSource, newSource);
    const oldOccurrenceRanges = findExactSourceBlockRanges(oldSource, originalQuestionSource);
    const newOccurrenceCount = findExactSourceBlockRanges(newSource, originalQuestionSource).length;
    if (newOccurrenceCount > oldOccurrenceRanges.length) {
        return null;
    }
    if (
        oldOccurrenceRanges.length > newOccurrenceCount &&
        !isSingleDuplicateBlockTextEdit(edit, oldOccurrenceRanges)
    ) {
        return null;
    }
    const isInsertion = edit.oldRange.start === edit.oldRange.end;

    // 未受编辑影响的问题必须精确映射到新的源范围。文本相同这一额外条件避免解析器
    // 因上下文变化把同一行重新解释为另一种卡片。
    if (
        oldQuestionRange.end < edit.oldRange.start ||
        (!isInsertion && oldQuestionRange.end === edit.oldRange.start)
    ) {
        return findUniqueQuestionAtRange(candidateList, currentQuestion, oldQuestionRange);
    }
    if (
        oldQuestionRange.start > edit.oldRange.end ||
        (!isInsertion && oldQuestionRange.start === edit.oldRange.end)
    ) {
        return findUniqueQuestionAtRange(
            candidateList,
            currentQuestion,
            shiftRange(oldQuestionRange, edit.delta),
        );
    }

    // 插入点刚好落在问题开头或结尾时，编辑可能是“在卡片前插入一整行”。先寻找
    // 原文本完整保留、仅整体平移后的候选；找不到时才把它视为当前卡片内容的编辑。
    if (isInsertion && oldQuestionRange.start === edit.oldRange.start) {
        const shiftedQuestion = findUniqueQuestionAtRange(
            candidateList,
            currentQuestion,
            shiftRange(oldQuestionRange, edit.delta),
        );
        if (shiftedQuestion) return shiftedQuestion;
    }
    if (isInsertion && oldQuestionRange.end === edit.oldRange.start) {
        const unchangedQuestion = findUniqueQuestionAtRange(
            candidateList,
            currentQuestion,
            oldQuestionRange,
        );
        if (unchangedQuestion) return unchangedQuestion;
    }

    // 当前问题被编辑时，候选必须覆盖整段新编辑内容，并保留至少一侧未修改的边界。
    // 这会拒绝“删除当前问题后，紧邻问题恰好移到原位置”的错误关联。
    const editedCandidateList = candidateList.filter(({ question, range }) => {
        if (question.cardType !== currentQuestion.cardType) return false;
        if (!containsRange(range, edit.newRange)) return false;

        const hasLeftAnchor =
            oldQuestionRange.start < edit.oldRange.start && range.start === oldQuestionRange.start;
        const hasRightAnchor =
            oldQuestionRange.end > edit.oldRange.end &&
            range.end === oldQuestionRange.end + edit.delta;
        if (hasLeftAnchor || hasRightAnchor) return true;

        // 整张卡片被一次替换时没有可复用的内部文本。仅当差异区严格等于旧卡片和
        // 新候选的完整范围时才接受；任一侧夹带其他块的改动都会返回 null。
        return rangesEqual(edit.oldRange, oldQuestionRange) && rangesEqual(edit.newRange, range);
    });

    return findUniqueCandidate(editedCandidateList)?.question ?? null;
}

interface TextRange {
    start: number;
    end: number;
}

interface SourceEdit {
    oldRange: TextRange;
    newRange: TextRange;
    delta: number;
}

function normalizeLineEndings(text: string): string {
    return text.replaceAll(/\r\n|\r/g, "\n");
}

function getQuestionRange(source: string, question: ParsedQuestionInfo): TextRange | null {
    if (
        !Number.isInteger(question.firstLineNum) ||
        !Number.isInteger(question.lastLineNum) ||
        question.firstLineNum < 0 ||
        question.lastLineNum < question.firstLineNum
    ) {
        return null;
    }

    const lines = source.split("\n");
    if (question.lastLineNum >= lines.length) return null;

    let start = 0;
    for (let lineNumber = 0; lineNumber < question.firstLineNum; lineNumber++) {
        start += lines[lineNumber].length + 1;
    }

    let end = start;
    for (let lineNumber = question.firstLineNum; lineNumber <= question.lastLineNum; lineNumber++) {
        end += lines[lineNumber].length;
        if (lineNumber < question.lastLineNum) end++;
    }
    return { start, end };
}

function findSingleEdit(oldSource: string, newSource: string): SourceEdit {
    let prefixLength = 0;
    const sharedLength = Math.min(oldSource.length, newSource.length);
    while (prefixLength < sharedLength && oldSource[prefixLength] === newSource[prefixLength]) {
        prefixLength++;
    }

    let suffixLength = 0;
    while (
        suffixLength < oldSource.length - prefixLength &&
        suffixLength < newSource.length - prefixLength &&
        oldSource[oldSource.length - suffixLength - 1] ===
            newSource[newSource.length - suffixLength - 1]
    ) {
        suffixLength++;
    }

    const oldRange = { start: prefixLength, end: oldSource.length - suffixLength };
    const newRange = { start: prefixLength, end: newSource.length - suffixLength };
    return {
        oldRange,
        newRange,
        delta: newRange.end - newRange.start - (oldRange.end - oldRange.start),
    };
}

function getBlockIdList(text: string): string[] {
    return Array.from(text.matchAll(/(?:^|\s)(\^[a-zA-Z0-9-]+)(?=\s|$)/g)).map((match) => match[1]);
}

function countBlockId(source: string, blockId: string): number {
    return getBlockIdList(source).filter((item) => item === blockId).length;
}

/** 按完整行（多行卡则按完整行序列）匹配，避免把更长行中的子串误算为重复。 */
function findExactSourceBlockRanges(source: string, block: string): TextRange[] {
    if (block.length === 0) return [];

    const sourceLines = source.split("\n");
    const blockLines = block.split("\n");
    const ranges: TextRange[] = [];
    let sourceOffset = 0;
    for (let sourceLine = 0; sourceLine <= sourceLines.length - blockLines.length; sourceLine++) {
        if (blockLines.every((line, index) => sourceLines[sourceLine + index] === line)) {
            ranges.push({ start: sourceOffset, end: sourceOffset + block.length });
        }
        sourceOffset += sourceLines[sourceLine].length + 1;
    }
    return ranges;
}

/**
 * 差异必须完全落在唯一一个旧重复块内。若整个旧块被删且新差异为空，留下的副本
 * 没有可辨识身份；其他局部增删改则仍是该块本身的内容编辑。
 */
function isSingleDuplicateBlockTextEdit(
    edit: SourceEdit,
    oldOccurrenceRanges: TextRange[],
): boolean {
    const containingRanges = oldOccurrenceRanges.filter((range) =>
        containsRange(range, edit.oldRange),
    );
    if (containingRanges.length !== 1) return false;

    return (
        !rangesEqual(edit.oldRange, containingRanges[0]) ||
        edit.newRange.start !== edit.newRange.end
    );
}

function findUniqueQuestionAtRange(
    candidateList: readonly Candidate[],
    currentQuestion: ParsedQuestionInfo,
    expectedRange: TextRange,
): ParsedQuestionInfo | null {
    return (
        findUniqueCandidate(
            candidateList.filter(
                ({ question, range }) =>
                    question.cardType === currentQuestion.cardType &&
                    question.text === currentQuestion.text &&
                    rangesEqual(range, expectedRange),
            ),
        )?.question ?? null
    );
}

interface Candidate {
    question: ParsedQuestionInfo;
    range: TextRange;
}

function findUniqueCandidate(candidateList: readonly Candidate[]): Candidate | null {
    return candidateList.length === 1 ? candidateList[0] : null;
}

function shiftRange(range: TextRange, delta: number): TextRange {
    return { start: range.start + delta, end: range.end + delta };
}

function containsRange(container: TextRange, contained: TextRange): boolean {
    return container.start <= contained.start && container.end >= contained.end;
}

function rangesEqual(left: TextRange, right: TextRange): boolean {
    return left.start === right.start && left.end === right.end;
}
