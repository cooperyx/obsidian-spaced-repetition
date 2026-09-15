import { DataStore } from "src/data/data-store/base/data-store";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { NoteParser } from "src/note/note-parser";
import { replaceQuestionSource } from "src/note/replace-question-source";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "./helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "./helpers/unit-test-setup";

class ProcessableUnitTestSRFile extends UnitTestSRFile {
    async process(update: (content: string) => string): Promise<string> {
        // 模拟编辑器在原子更新回调执行前完成另一轮保存。
        this.content += "\r\n外部编辑";
        const result = update(this.content);
        this.content = result;
        return result;
    }
}

describe("replaceQuestionSource", () => {
    test("保留 CRLF、字面 $ 字符和其他相同卡片内容", () => {
        const source =
            "标题\r\n#flashcards A$1::B$2\r\n中间的 $& 内容\r\n#flashcards A$1::B$2\r\n结尾";
        const result = replaceQuestionSource(
            source,
            "#flashcards A$1::B$2",
            "#flashcards C$3::D$4",
            3,
        );

        expect(result).toEqual(
            "标题\r\n#flashcards A$1::B$2\r\n中间的 $& 内容\r\n#flashcards C$3::D$4\r\n结尾",
        );
    });

    test("原子写入期间原文变动时抛错且不覆盖外部编辑", async () => {
        unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
        const source = "#flashcards 问题::答案\r\n<!--SR:!2023-09-10,4,270-->";
        const file = new ProcessableUnitTestSRFile(source, "atomic-write-test");
        const note = await new NoteParser(DEFAULT_SETTINGS).parse(
            file,
            TextDirection.Ltr,
            TopicPath.emptyPath,
        );
        const question = note.questionList[0];
        question.cards[0].scheduleInfo = RepItemScheduleInfoOsr.fromDueDateStr(
            "2023-09-21",
            15,
            290,
        );

        await expect(DataStore.getInstance().writeSchedule(question)).rejects.toThrow(
            "原文正在保存",
        );
        expect(file.content).toEqual(`${source}\r\n外部编辑`);
    });
});
