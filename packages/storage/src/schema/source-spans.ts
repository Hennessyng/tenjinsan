import { foreignKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { sourceBlocks } from "./source.ts"

export const sourceSpans = sqliteTable(
  "source_spans",
  {
    id: text("id").primaryKey(),
    normalizationRevisionId: text("normalization_revision_id").notNull(),
    blockId: text("block_id").notNull(),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.normalizationRevisionId, table.blockId],
      foreignColumns: [sourceBlocks.normalizationRevisionId, sourceBlocks.blockId],
    }).onDelete("restrict"),
  ],
)
