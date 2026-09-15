import { clampFloatingWindowPosition } from "src/ui/obsidian-ui-components/modals/floating-window";

describe("clampFloatingWindowPosition", () => {
    test("keeps every part of a normally sized review window in the viewport", () => {
        expect(
            clampFloatingWindowPosition(
                { x: 1_100, y: -50 },
                { width: 500, height: 400 },
                { width: 1_280, height: 900 },
            ),
        ).toEqual({ x: 780, y: 0 });
    });

    test("pins an oversized review window to the viewport origin", () => {
        expect(
            clampFloatingWindowPosition(
                { x: 100, y: 100 },
                { width: 1_500, height: 1_000 },
                { width: 1_280, height: 900 },
            ),
        ).toEqual({ x: 0, y: 0 });
    });
});
