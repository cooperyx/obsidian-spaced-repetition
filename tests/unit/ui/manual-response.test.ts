/**
 * ResponseSectionComponent 依赖 Obsidian 扩展的 HTMLElement 方法；这里用 jsdom 的真实元素
 * 补齐最小接口，使测试覆盖按钮展示和回调接线，而不模拟调度实现。
 */
function installObsidianDomHelpers(): void {
    Object.assign(HTMLElement.prototype, {
        createDiv(this: HTMLElement, options: { cls?: string } = {}) {
            const element = this.ownerDocument.createElement("div");
            if (options.cls) element.classList.add(...options.cls.split(" "));
            this.appendChild(element);
            return element;
        },
        createSpan(this: HTMLElement, options: { cls?: string } = {}) {
            const element = this.ownerDocument.createElement("span");
            if (options.cls) element.classList.add(...options.cls.split(" "));
            this.appendChild(element);
            return element;
        },
        setText(this: HTMLElement, text: string) {
            this.textContent = text;
        },
        addClass(this: HTMLElement, className: string) {
            this.classList.add(className);
        },
        removeClass(this: HTMLElement, className: string) {
            this.classList.remove(className);
        },
        addClasses(this: HTMLElement, classNames: string[]) {
            this.classList.add(...classNames);
        },
        toggleClass(this: HTMLElement, className: string, value?: boolean) {
            this.classList.toggle(className, value);
        },
    });
}

jest.mock(
    "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section.css",
    () => ({}),
);

jest.mock("obsidian", () => ({
    moment: { locale: () => "en" },
    Notice: jest.fn(),
    Platform: { isMobile: false },
    ButtonComponent: class {
        public buttonEl: HTMLButtonElement;

        constructor(container: HTMLElement) {
            this.buttonEl = container.ownerDocument.createElement("button");
            container.appendChild(this.buttonEl);
        }

        public setClass(className: string): this {
            this.buttonEl.classList.add(className);
            return this;
        }

        public setIcon(): this {
            return this;
        }

        public setTooltip(): this {
            return this;
        }

        public setButtonText(text: string): this {
            this.buttonEl.textContent = text;
            return this;
        }

        public onClick(callback: (event: MouseEvent) => void | Promise<void>): this {
            this.buttonEl.addEventListener("click", callback);
            return this;
        }

        public setDisabled(disabled: boolean): this {
            this.buttonEl.disabled = disabled;
            return this;
        }
    },
}));

import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import ResponseSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section";

interface ResponseSectionContext {
    component: ResponseSectionComponent;
    processReview: jest.MockedFunction<(response: ReviewResponse) => Promise<void>>;
    manualReview: jest.MockedFunction<(days: number) => Promise<void>>;
}

function createSettings(manualReviewDays = DEFAULT_SETTINGS.manualReviewDays): SRSettings {
    return {
        ...DEFAULT_SETTINGS,
        manualReviewDays: [...manualReviewDays],
        showIntervalInReviewButtons: false,
    };
}

function createResponseSection(settings = createSettings()): ResponseSectionContext {
    const processReview = jest.fn(async (_response: ReviewResponse): Promise<void> => {});
    const manualReview = jest.fn(async (_days: number): Promise<void> => {});
    const component = new ResponseSectionComponent(
        document.body.createDiv(),
        settings,
        jest.fn(),
        processReview,
        manualReview,
    );
    return { component, processReview, manualReview };
}

function dayLabels(component: ResponseSectionComponent): string[] {
    return Array.from(component.responseEl.querySelectorAll(".sr-day-button")).map(
        (button) => button.querySelector(".sr-small-text")?.textContent ?? "",
    );
}

function visibleRatingButtons(component: ResponseSectionComponent): HTMLButtonElement[] {
    return Array.from(
        component.responseEl.querySelectorAll<HTMLButtonElement>(".sr-response-button"),
    ).filter((button) => !button.classList.contains("sr-is-hidden"));
}

describe("ResponseSectionComponent 手动天数按钮", () => {
    beforeEach(() => {
        installObsidianDomHelpers();
        document.body.replaceChildren();
    });

    test("默认显示 Again 加十个日期按钮，并把每个天数交给手动排期", () => {
        const { component, manualReview } = createResponseSection();

        component.showRatingButtons(FlashcardReviewMode.Review, createSettings(), () => null);

        expect(visibleRatingButtons(component)).toHaveLength(11);
        expect(dayLabels(component)).toEqual([
            "1天",
            "2天",
            "3天",
            "5天",
            "7天",
            "10天",
            "14天",
            "30天",
            "60天",
            "90天",
        ]);

        component.responseEl
            .querySelectorAll<HTMLButtonElement>(".sr-day-button")
            .forEach((button) => {
                button.click();
            });
        expect(manualReview.mock.calls.map(([days]) => days)).toEqual([
            1, 2, 3, 5, 7, 10, 14, 30, 60, 90,
        ]);
    });

    test("Again 只提交 Again 枚举", () => {
        const { component, processReview } = createResponseSection();

        component.showRatingButtons(FlashcardReviewMode.Review, createSettings(), () => null);
        component.againButton.buttonEl.click();

        expect(processReview).toHaveBeenCalledTimes(1);
        expect(processReview).toHaveBeenCalledWith(ReviewResponse.Again);
    });

    test("隐藏评分区且禁用按钮时不会发生用户可触发的提交", () => {
        const { component, processReview, manualReview } = createResponseSection();

        component.showRatingButtons(FlashcardReviewMode.Review, createSettings(), () => null);
        component.hideAllButtons();
        expect(component.responseEl.classList.contains("sr-is-hidden")).toBe(true);
        expect(processReview).not.toHaveBeenCalled();
        expect(manualReview).not.toHaveBeenCalled();

        component.showRatingButtons(FlashcardReviewMode.Review, createSettings(), () => null);
        component.setDisabled(true);
        expect(component.againButton.buttonEl.disabled).toBe(true);
        component.againButton.buttonEl.click();
        expect(processReview).not.toHaveBeenCalled();
    });

    test("再次展示时按新配置重绘日期按钮", () => {
        const { component, manualReview } = createResponseSection();

        component.showRatingButtons(
            FlashcardReviewMode.Review,
            createSettings([1, 3, 7]),
            () => null,
        );
        component.showRatingButtons(
            FlashcardReviewMode.Review,
            createSettings([4, 11]),
            () => null,
        );

        expect(dayLabels(component)).toEqual(["4天", "11天"]);
        component.responseEl
            .querySelectorAll<HTMLButtonElement>(".sr-day-button")
            .forEach((button) => {
                button.click();
            });
        expect(manualReview.mock.calls.map(([days]) => days)).toEqual([4, 11]);
    });

    test("Cram 只保留 Again 与完成，完成不走手动日计划", () => {
        const { component, processReview, manualReview } = createResponseSection();

        component.showRatingButtons(FlashcardReviewMode.Cram, createSettings(), () => null);

        expect(visibleRatingButtons(component)).toHaveLength(2);
        expect(dayLabels(component)).toEqual([]);
        component.againButton.buttonEl.click();
        component.responseEl.querySelector<HTMLButtonElement>(".sr-bg-green")?.click();
        expect(processReview.mock.calls.map(([response]) => response)).toEqual([
            ReviewResponse.Again,
            ReviewResponse.Easy,
        ]);
        expect(manualReview).not.toHaveBeenCalled();
    });
});
