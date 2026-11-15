// The schema version and the two enums that code reading the data model
// checks inputs against. Kept apart from entities.ts so a module that needs
// only these, such as the insights, does not carry every entity's schema.

import { z } from "zod";

/** Bumped only for a breaking change to the shapes in entities.ts. */
export const SCHEMA_VERSION = 1 as const;

export const campaignStatusSchema = z.enum([
  "active",
  "archived",
  "completed",
  "draft",
  "paused",
  "unknown",
]);

export const replyCategorySchema = z.enum([
  "bounce",
  "negative",
  "neutral",
  "ooo",
  "positive",
  "unknown",
  "unsubscribe",
]);
