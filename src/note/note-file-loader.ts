import { Question } from "src/data/data-structures/card/questions/question";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { ISRNoteTFile } from "src/data/data-structures/file/note-file";
import { SRSettings } from "src/data/settings";
import { Note } from "src/note/note";
import { NoteQuestionParser } from "src/note/note-question-parser";
import { TextDirection } from "src/utils/strings";

export class NoteFileLoader {
    fileText: string;
    fixesMade: boolean;
    noteTopicPath: TopicPath;
    noteFile: ISRNoteTFile;
    settings: SRSettings;

    constructor(settings: SRSettings) {
        this.settings = settings;
    }

    async load(
        noteFile: ISRNoteTFile,
        defaultTextDirection: TextDirection,
        folderTopicPath: TopicPath,
    ): Promise<Note | null> {
        this.noteFile = noteFile;

        const questionParser: NoteQuestionParser = new NoteQuestionParser(this.settings);

        const onlyKeepQuestionsWithTopicPath: boolean = true;
        const questionList: Question[] = await questionParser.createQuestionList(
            noteFile,
            defaultTextDirection,
            folderTopicPath,
            onlyKeepQuestionsWithTopicPath,
        );

        const result: Note = new Note(noteFile, questionList);
        // 复习队列中的 Question 会引用此 Note。首次同步前必须保留解析时的原文，
        // 否则刷新器无法建立新旧卡片身份映射，并会把未编辑的卡片误判为失效。
        result.sourceText = questionParser.noteText;
        return result;
    }
}
