/**
 * Одноразовый скрипт: добавляет группу "Сербская барахолка" всем пользователям без групп
 * Запуск: bun scripts/add-default-group.ts
 */

import { Database } from "bun:sqlite";

const db = new Database("data.db");

// 1. Найти группу "Сербская барахолка"
const group = db
  .prepare<{ group_id: number; group_title: string }, [string]>(
    `SELECT DISTINCT group_id, group_title FROM user_groups WHERE group_title LIKE ?`
  )
  .get("%Сербская Барахолка%");

if (!group) {
  console.error("Группа 'Сербская барахолка' не найдена в БД");
  console.log("Существующие группы:");
  const allGroups = db
    .prepare<{ group_id: number; group_title: string }, []>(
      `SELECT DISTINCT group_id, group_title FROM user_groups ORDER BY group_title`
    )
    .all();
  for (const g of allGroups) {
    console.log(`  - ${g.group_title} (${g.group_id})`);
  }
  process.exit(1);
}

console.log(`Найдена группа: "${group.group_title}" (ID: ${group.group_id})`);

// 2. Найти пользователей без групп
const usersWithoutGroups = db
  .prepare<{ id: number; telegram_id: number; first_name: string | null }, []>(
    `SELECT u.id, u.telegram_id, u.first_name FROM users u
     WHERE NOT EXISTS (
       SELECT 1 FROM user_groups ug WHERE ug.user_id = u.id
     )`
  )
  .all();

if (usersWithoutGroups.length === 0) {
  console.log("Все пользователи уже имеют хотя бы одну группу");
  process.exit(0);
}

console.log(`Найдено ${usersWithoutGroups.length} пользователей без групп:`);
for (const u of usersWithoutGroups) {
  console.log(`  - ${u.first_name || "Без имени"} (telegram: ${u.telegram_id})`);
}

// 3. Добавить группу всем этим пользователям
const insertStmt = db.prepare<void, [number, number, string]>(
  `INSERT OR IGNORE INTO user_groups (user_id, group_id, group_title) VALUES (?, ?, ?)`
);

let added = 0;
for (const user of usersWithoutGroups) {
  insertStmt.run(user.id, group.group_id, group.group_title);
  added++;
  console.log(`Добавлена группа для ${user.first_name || user.telegram_id}`);
}

console.log(`\nГотово! Добавлено ${added} записей.`);
