import { describe, test, expect } from "bun:test";
import {
  confirmKeyboard,
  subscriptionKeyboard,
  backKeyboard,
  groupsKeyboard,
} from "./keyboards.ts";

describe("confirmKeyboard", () => {
  test("creates keyboard with confirm, edit and cancel buttons", () => {
    const keyboard = confirmKeyboard("test_query_id");

    // InlineKeyboard has a .toJSON() method that returns the keyboard structure
    const json = keyboard.toJSON();

    expect(json.inline_keyboard).toBeDefined();
    expect(json.inline_keyboard.length).toBe(2); // Two rows

    // First row: Confirm and Edit
    const firstRow = json.inline_keyboard[0]!;
    expect(firstRow.length).toBe(2);
    expect(firstRow[0]!.text).toBe("Подтвердить");
    expect(firstRow[1]!.text).toBe("Изменить");

    // Second row: Cancel
    const secondRow = json.inline_keyboard[1]!;
    expect(secondRow.length).toBe(1);
    expect(secondRow[0]!.text).toBe("Отмена");
  });

  test("includes query ID in callback data", () => {
    const queryId = "user123_1234567890";
    const keyboard = confirmKeyboard(queryId);
    const json = keyboard.toJSON();

    const confirmButton = json.inline_keyboard[0]![0]!;
    const confirmData = JSON.parse((confirmButton as { callback_data: string }).callback_data);

    expect(confirmData.action).toBe("confirm");
    expect(confirmData.id).toBe(queryId);
  });

  test("all buttons have valid JSON callback data", () => {
    const keyboard = confirmKeyboard("test_id");
    const json = keyboard.toJSON();

    for (const row of json.inline_keyboard) {
      for (const button of row) {
        expect(() => JSON.parse((button as { callback_data: string }).callback_data)).not.toThrow();
      }
    }
  });
});

describe("subscriptionKeyboard", () => {
  test("creates keyboard with disable button", () => {
    const keyboard = subscriptionKeyboard(42);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard.length).toBe(1);
    expect(json.inline_keyboard[0]!.length).toBe(1);
    expect(json.inline_keyboard[0]![0]!.text).toBe("Отключить");
  });

  test("includes subscription ID in callback data", () => {
    const subscriptionId = 123;
    const keyboard = subscriptionKeyboard(subscriptionId);
    const json = keyboard.toJSON();

    const disableButton = json.inline_keyboard[0]![0]!;
    const data = JSON.parse((disableButton as { callback_data: string }).callback_data);

    expect(data.action).toBe("disable");
    expect(data.id).toBe(subscriptionId);
  });
});

describe("backKeyboard", () => {
  test("creates keyboard with back button", () => {
    const keyboard = backKeyboard();
    const json = keyboard.toJSON();

    expect(json.inline_keyboard.length).toBe(1);
    expect(json.inline_keyboard[0]!.length).toBe(1);
    expect(json.inline_keyboard[0]![0]!.text).toBe("Назад");
  });

  test("has back action in callback data", () => {
    const keyboard = backKeyboard();
    const json = keyboard.toJSON();

    const data = JSON.parse((json.inline_keyboard[0]![0]! as { callback_data: string }).callback_data);
    expect(data.action).toBe("back");
  });
});

describe("groupsKeyboard", () => {
  test("creates buttons for each group", () => {
    const groups = [
      { id: 1, title: "Group 1" },
      { id: 2, title: "Group 2" },
      { id: 3, title: "Group 3" },
    ];
    const keyboard = groupsKeyboard(groups, new Set());
    const json = keyboard.toJSON();

    // Should have: 3 group buttons + select all/deselect all row + skip row + cancel row
    expect(json.inline_keyboard.length).toBe(6); // 3 groups + 3 control rows
  });

  test("marks selected groups with checkmark", () => {
    const groups = [
      { id: 1, title: "Group 1" },
      { id: 2, title: "Group 2" },
    ];
    const selectedIds = new Set([1]);
    const keyboard = groupsKeyboard(groups, selectedIds);
    const json = keyboard.toJSON();

    // First group should have checkmark
    expect(json.inline_keyboard[0]![0]!.text).toBe("✅ Group 1");
    // Second group should not
    expect(json.inline_keyboard[1]![0]!.text).toBe("Group 2");
  });

  test("includes toggle_group action with group ID", () => {
    const groups = [{ id: 42, title: "Test Group" }];
    const keyboard = groupsKeyboard(groups, new Set());
    const json = keyboard.toJSON();

    const data = JSON.parse((json.inline_keyboard[0]![0]! as { callback_data: string }).callback_data);
    expect(data.action).toBe("toggle_group");
    expect(data.id).toBe(42);
  });

  test("has select all and deselect all buttons", () => {
    const groups = [{ id: 1, title: "Group" }];
    const keyboard = groupsKeyboard(groups, new Set());
    const json = keyboard.toJSON();

    // Find the row with select/deselect all buttons
    const controlRow = json.inline_keyboard.find(
      (row) =>
        row.some((btn) => btn.text === "Выбрать все") &&
        row.some((btn) => btn.text === "Снять все")
    );

    expect(controlRow).toBeDefined();
    expect(controlRow!.length).toBe(2);
  });

  test("shows 'Готово' when groups selected", () => {
    const groups = [{ id: 1, title: "Group" }];
    const selectedIds = new Set([1]);
    const keyboard = groupsKeyboard(groups, selectedIds);
    const json = keyboard.toJSON();

    // Find confirm button
    const confirmButton = json.inline_keyboard
      .flat()
      .find((btn) => btn.text?.includes("Готово"));

    expect(confirmButton).toBeDefined();
    expect(confirmButton!.text).toBe("Готово (1)");

    const data = JSON.parse((confirmButton as { callback_data: string }).callback_data);
    expect(data.action).toBe("confirm_groups");
  });

  test("shows 'Пропустить' when no groups selected", () => {
    const groups = [{ id: 1, title: "Group" }];
    const keyboard = groupsKeyboard(groups, new Set());
    const json = keyboard.toJSON();

    // Find skip button
    const skipButton = json.inline_keyboard
      .flat()
      .find((btn) => btn.text === "Пропустить");

    expect(skipButton).toBeDefined();

    const data = JSON.parse((skipButton as { callback_data: string }).callback_data);
    expect(data.action).toBe("skip_groups");
  });

  test("has cancel button", () => {
    const groups = [{ id: 1, title: "Group" }];
    const keyboard = groupsKeyboard(groups, new Set());
    const json = keyboard.toJSON();

    // Find cancel button
    const cancelButton = json.inline_keyboard
      .flat()
      .find((btn) => btn.text === "Отмена");

    expect(cancelButton).toBeDefined();

    const data = JSON.parse((cancelButton as { callback_data: string }).callback_data);
    expect(data.action).toBe("cancel");
  });

  test("handles empty groups list", () => {
    const keyboard = groupsKeyboard([], new Set());
    const json = keyboard.toJSON();

    // Should still have control buttons even with no groups
    expect(json.inline_keyboard.length).toBeGreaterThan(0);
  });

  test("handles many groups", () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      title: `Group ${i + 1}`,
    }));
    const keyboard = groupsKeyboard(groups, new Set([1, 5, 10]));
    const json = keyboard.toJSON();

    // Count selected groups in buttons
    const selectedButtons = json.inline_keyboard
      .flat()
      .filter((btn: any) => btn.text?.startsWith("✅"));

    expect(selectedButtons.length).toBe(3);
  });

  test("updates count in Готово button based on selection", () => {
    const groups = [
      { id: 1, title: "G1" },
      { id: 2, title: "G2" },
      { id: 3, title: "G3" },
    ];
    const selectedIds = new Set([1, 2, 3]);
    const keyboard = groupsKeyboard(groups, selectedIds);
    const json = keyboard.toJSON();

    const confirmButton = json.inline_keyboard
      .flat()
      .find((btn) => btn.text?.includes("Готово"));

    expect(confirmButton!.text).toBe("Готово (3)");
  });
});
