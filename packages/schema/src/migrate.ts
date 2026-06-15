// packages/schema/src/migrate.ts
//
// Version migration registry for `Project.schema` (a semver string).
// Each migration takes a project document at version `from` and returns one
// at the next version. `migrateProject` walks forward from the document's
// recorded version to CURRENT_SCHEMA_VERSION, applying migrations in order.
//
// P1: no migrations exist yet (1.0.0 is the first schema version), so the
// registry is empty and migrateProject is a passthrough (after validating the
// version is not newer than what this build understands).

import type { Json } from "./schemas";

export const CURRENT_SCHEMA_VERSION = "1.0.0";

/**
 * A migration step: (doc at version `from`) -> (doc at the next version).
 * Operates on loosely-typed JSON since older versions may not satisfy the
 * current ProjectSchema.
 */
export type Migration = (doc: Record<string, Json>) => Record<string, Json>;

/** Keyed by the version a migration upgrades *from*. */
const migrations = new Map<string, Migration>();

export class UnknownSchemaVersionError extends Error {
  constructor(version: string) {
    super(
      `project schema version "${version}" is newer than this build supports (current: ${CURRENT_SCHEMA_VERSION})`
    );
    this.name = "UnknownSchemaVersionError";
  }
}

/**
 * Applies forward migrations to bring `doc` up to CURRENT_SCHEMA_VERSION.
 * Accepts `unknown` since callers typically pass a raw deserialized JSON
 * document (from disk/API) that hasn't been validated yet — validate the
 * returned value against ProjectSchema afterwards. Throws if `doc.schema`
 * is not a known version and not the current version (i.e. it is from a
 * future build this code doesn't understand).
 */
export function migrateProject(doc: unknown): Record<string, Json> {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error("migrateProject: expected a JSON object");
  }

  let current = doc as Record<string, Json>;
  let version = typeof current.schema === "string" ? current.schema : CURRENT_SCHEMA_VERSION;

  while (version !== CURRENT_SCHEMA_VERSION) {
    const migration = migrations.get(version);
    if (!migration) {
      throw new UnknownSchemaVersionError(version);
    }
    current = migration(current);
    version = typeof current.schema === "string" ? current.schema : CURRENT_SCHEMA_VERSION;
  }

  return current;
}
