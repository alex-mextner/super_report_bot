import { describe, test, expect } from "bun:test";
import {
  confirmKeyboard,
  subscriptionKeyboard,
  backKeyboard,
  groupPickerKeyboard,
  inviteLinkKeyboard,
  pendingGroupsKeyboard,
  nextRequestId,
} from "./keyboards.ts";
import type { PendingGroup } from "../types.ts";

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

describe("nextRequestId", () => {
  test("returns incrementing IDs", () => {
    const id1 = nextRequestId();
    const id2 = nextRequestId();
    expect(id2).toBe(id1 + 2); // +2 because we reserve pairs
  });

  test("returns positive integers", () => {
    const id = nextRequestId();
    expect(id).toBeGreaterThan(0);
    expect(Number.isInteger(id)).toBe(true);
  });
});

describe("groupPickerKeyboard", () => {
  test("creates reply keyboard with requestChat buttons", () => {
    const keyboard = groupPickerKeyboard(1);
    const json = keyboard.toJSON();

    expect(json.keyboard).toBeDefined();
    expect(json.one_time_keyboard).toBe(true);
    expect(json.resize_keyboard).toBe(true);
  });

  test("has group and channel selection buttons", () => {
    const keyboard = groupPickerKeyboard(1);
    const json = keyboard.toJSON();

    // First row: group button
    expect(json.keyboard[0]![0]!.text).toBe("Выбрать группу");
    expect(json.keyboard[0]![0]!.request_chat).toBeDefined();
    expect(json.keyboard[0]![0]!.request_chat!.chat_is_channel).toBe(false);

    // Second row: channel button
    expect(json.keyboard[1]![0]!.text).toBe("Выбрать канал");
    expect(json.keyboard[1]![0]!.request_chat).toBeDefined();
    expect(json.keyboard[1]![0]!.request_chat!.chat_is_channel).toBe(true);
  });

  test("has Готово button", () => {
    const keyboard = groupPickerKeyboard(1);
    const json = keyboard.toJSON();

    // Third row: Готово
    expect(json.keyboard[2]![0]!.text).toBe("Готово");
  });

  test("uses provided requestId for group and requestId+1 for channel", () => {
    const requestId = 42;
    const keyboard = groupPickerKeyboard(requestId);
    const json = keyboard.toJSON();

    expect(json.keyboard[0]![0]!.request_chat!.request_id).toBe(requestId);
    expect(json.keyboard[1]![0]!.request_chat!.request_id).toBe(requestId + 1);
  });
});

describe("inviteLinkKeyboard", () => {
  test("creates inline keyboard with skip and cancel buttons", () => {
    const keyboard = inviteLinkKeyboard();
    const json = keyboard.toJSON();

    expect(json.inline_keyboard).toBeDefined();
    expect(json.inline_keyboard.length).toBe(2); // Two rows
  });

  test("has skip_invite_link action", () => {
    const keyboard = inviteLinkKeyboard();
    const json = keyboard.toJSON();

    const skipButton = json.inline_keyboard[0]![0]!;
    expect(skipButton.text).toBe("Пропустить");

    const data = JSON.parse((skipButton as { callback_data: string }).callback_data);
    expect(data.action).toBe("skip_invite_link");
  });

  test("has cancel action", () => {
    const keyboard = inviteLinkKeyboard();
    const json = keyboard.toJSON();

    const cancelButton = json.inline_keyboard[1]![0]!;
    expect(cancelButton.text).toBe("Отмена");

    const data = JSON.parse((cancelButton as { callback_data: string }).callback_data);
    expect(data.action).toBe("cancel");
  });
});

describe("pendingGroupsKeyboard", () => {
  test("creates buttons for each pending group", () => {
    const groups: PendingGroup[] = [
      { id: 1, title: "Group 1", needsInviteLink: false, isChannel: false },
      { id: 2, title: "Channel 1", needsInviteLink: false, isChannel: true },
    ];
    const keyboard = pendingGroupsKeyboard(groups);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard.length).toBe(2);
  });

  test("shows group icon for groups and channel icon for channels", () => {
    const groups: PendingGroup[] = [
      { id: 1, title: "My Group", needsInviteLink: false, isChannel: false },
      { id: 2, title: "My Channel", needsInviteLink: false, isChannel: true },
    ];
    const keyboard = pendingGroupsKeyboard(groups);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard[0]![0]!.text).toContain("👥");
    expect(json.inline_keyboard[0]![0]!.text).toContain("My Group");

    expect(json.inline_keyboard[1]![0]!.text).toContain("📢");
    expect(json.inline_keyboard[1]![0]!.text).toContain("My Channel");
  });

  test("has remove_pending action with group ID", () => {
    const groups: PendingGroup[] = [
      { id: 42, title: "Test Group", needsInviteLink: false, isChannel: false },
    ];
    const keyboard = pendingGroupsKeyboard(groups);
    const json = keyboard.toJSON();

    const data = JSON.parse((json.inline_keyboard[0]![0]! as { callback_data: string }).callback_data);
    expect(data.action).toBe("remove_pending");
    expect(data.id).toBe(42);
  });

  test("handles empty groups list", () => {
    const keyboard = pendingGroupsKeyboard([]);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard.length).toBe(0);
  });

  test("uses group ID as fallback when title is undefined", () => {
    const groups: PendingGroup[] = [
      { id: 123, needsInviteLink: false, isChannel: false },
    ];
    const keyboard = pendingGroupsKeyboard(groups);
    const json = keyboard.toJSON();

    expect(json.inline_keyboard[0]![0]!.text).toContain("123");
  });
});
