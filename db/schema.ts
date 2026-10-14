import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const profiles = sqliteTable('profiles', {
  telegramId: text('telegram_id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar'),
  document: text('document'),
  revision: integer('revision').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull().default(0),
});
