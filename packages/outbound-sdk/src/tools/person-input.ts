// The person fields every tool and insight that takes one person shares:
// `lead_ref`, `email` and `linkedin_url`, each holding only its own kind,
// and `person`, which takes any of the three. Exactly one is given. A value
// of the wrong kind is refused here, before any request.

import { z } from "zod";

import {
  leadRefParts,
  notAPerson,
  PERSON_FORMS,
  personKey,
} from "../internal/person.ts";

export const personFields = {
  email: z
    .string()
    .optional()
    .describe("The person's email address, for example jane@acme.com"),
  lead_ref: z
    .string()
    .optional()
    .describe(
      "A lead ref exactly as another tool returned it (provider:workspace:id), for example a reply's leadRef or a lead's ref. A ref's provider picks the tool it is read from"
    ),
  linkedin_url: z
    .string()
    .optional()
    .describe("The person's LinkedIn profile URL"),
  person: z
    .string()
    .optional()
    .describe(
      `Any of ${PERSON_FORMS}. Give exactly one of person, lead_ref, email and linkedin_url`
    ),
};

export interface PersonFields {
  readonly email?: string | undefined;
  readonly lead_ref?: string | undefined;
  readonly linkedin_url?: string | undefined;
  readonly person?: string | undefined;
}

const NAMES = ["lead_ref", "email", "linkedin_url", "person"] as const;

type Name = (typeof NAMES)[number];

/** Why a value does not belong in its field, or `null` when it does. */
const wrongKind = (name: Name, value: string): string | null => {
  const isRef = leadRefParts(value) !== null;
  const key = personKey(value);

  switch (name) {
    case "lead_ref": {
      return isRef
        ? null
        : `takes a lead ref as another tool returned it (provider:workspace:id); ${key === null ? notAPerson(value) : `pass "${value.trim()}" as ${key.startsWith("email:") ? "email" : "linkedin_url"} instead`}`;
    }

    case "email": {
      if (key?.startsWith("email:") === true) {
        return null;
      }

      return isRef
        ? `takes an email address; "${value.trim()}" is a lead ref, so pass it as lead_ref`
        : `takes an email address: ${notAPerson(value)}`;
    }

    case "linkedin_url": {
      if (key?.startsWith("linkedin:") === true) {
        return null;
      }

      return isRef
        ? `takes a LinkedIn profile URL; "${value.trim()}" is a lead ref, so pass it as lead_ref`
        : `takes a LinkedIn profile URL, for example https://www.linkedin.com/in/jane-doe; "${value.trim()}" is not one`;
    }

    default: {
      return isRef || key !== null ? null : notAPerson(value);
    }
  }
};

/** For `superRefine`: exactly one person field, holding its own kind. */
export const checkPerson = (
  values: PersonFields,
  context: z.RefinementCtx
): void => {
  const given = NAMES.filter((name) => values[name] !== undefined);

  if (given.length !== 1) {
    context.addIssue({
      code: "custom",
      message: `needs exactly one of lead_ref, email, linkedin_url or person (${PERSON_FORMS})${given.length > 1 ? `, but got ${given.join(" and ")}` : ""}`,
      path: [],
    });

    return;
  }

  const [name] = given;
  const value = name === undefined ? undefined : values[name];

  if (name === undefined || value === undefined) {
    return;
  }

  const problem = wrongKind(name, value);

  if (problem !== null) {
    context.addIssue({ code: "custom", message: problem, path: [name] });
  }
};

/** The one person field given. Call it on values `checkPerson` passed. */
export const personOf = (values: PersonFields): string =>
  values.lead_ref ?? values.email ?? values.linkedin_url ?? values.person ?? "";
