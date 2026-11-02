import { sql } from "drizzle-orm";
import { mediaItemsTable } from "@workspace/db";

// Images pulled out of a game's asset tree (sprites, icons, UI, textures) are
// not the same kind of thing as a picture someone saved on purpose. They carry
// the GAME_ASSET tag so browsing surfaces can keep them apart, and so the
// classification is visible and reversible rather than a hidden query rule.
export const GAME_ASSET = "game-asset";

export const isGameAsset = sql`${GAME_ASSET} = any(${mediaItemsTable.tags})`;
export const isNotGameAsset = sql`not (${GAME_ASSET} = any(${mediaItemsTable.tags}))`;
