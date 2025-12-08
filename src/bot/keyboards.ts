import { InlineKeyboard } from "gramio";

export const confirmKeyboard = (queryId: string) =>
  new InlineKeyboard()
    .text("Подтвердить", JSON.stringify({ action: "confirm", id: queryId }))
    .text("Изменить", JSON.stringify({ action: "edit", id: queryId }))
    .row()
    .text("Отмена", JSON.stringify({ action: "cancel", id: queryId }));

export const subscriptionKeyboard = (subscriptionId: number) =>
  new InlineKeyboard()
    .text("Отключить", JSON.stringify({ action: "disable", id: subscriptionId }));

export const backKeyboard = () =>
  new InlineKeyboard().text("Назад", JSON.stringify({ action: "back" }));

// Groups selection keyboard
export function groupsKeyboard(
  groups: { id: number; title: string }[],
  selectedIds: Set<number>
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const group of groups) {
    const isSelected = selectedIds.has(group.id);
    const label = isSelected ? `✅ ${group.title}` : group.title;
    kb.text(label, JSON.stringify({ action: "toggle_group", id: group.id }));
    kb.row();
  }

  kb.text("Выбрать все", JSON.stringify({ action: "select_all_groups" }));
  kb.text("Снять все", JSON.stringify({ action: "deselect_all_groups" }));
  kb.row();

  const hasSelected = selectedIds.size > 0;
  if (hasSelected) {
    kb.text(`Готово (${selectedIds.size})`, JSON.stringify({ action: "confirm_groups" }));
  } else {
    kb.text("Пропустить", JSON.stringify({ action: "skip_groups" }));
  }
  kb.row();
  kb.text("Отмена", JSON.stringify({ action: "cancel" }));

  return kb;
}
