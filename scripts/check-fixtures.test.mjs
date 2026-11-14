import assert from "node:assert/strict";
import { test } from "node:test";

import { findProblems } from "./check-fixtures.mjs";

const problems = (value) =>
  findProblems("fixtures/acme/sample.json", JSON.stringify(value));

test("accepts placeholder people and reserved domains", () => {
  assert.deepEqual(
    problems({
      email: "person1@example.com",
      from: "outreach@mail.example.org",
      linkedin: "https://www.linkedin.com/in/example-person-1",
      other: "ops@vendor.test",
      password: "[redacted]",
      smtp_password: "",
    }),
    []
  );
});

test("rejects an email address at a real domain", () => {
  assert.match(
    problems({ email: "jane.doe@acme.io" })[0],
    /real domain \(acme\.io\)/u
  );
  assert.match(problems({ email: "x@notexample.com" })[0], /real domain/u);
});

test("rejects a real LinkedIn profile", () => {
  assert.match(
    problems({ profileUrl: "https://www.linkedin.com/in/jane-doe-12345/" })[0],
    /LinkedIn profile "jane-doe-12345"/u
  );
});

test("rejects keys, tokens and filled credential fields", () => {
  assert.match(
    problems({
      token:
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
    })[0],
    /JSON Web Token/u
  );
  assert.match(
    problems({ key: "sk_live_abcdefghijklmnop1234" })[0],
    /an API key/u
  );
  assert.match(
    problems({ header: "Bearer abcdefghijklmnopqrstuvwxyz012345" })[0],
    /bearer token/u
  );
  assert.match(
    problems({ secret: "whsec_abcdefghijklmnopqrstuv" })[0],
    /webhook signing secret/u
  );
  assert.match(
    problems({ smtp_password: "hunter2hunter2" })[0],
    /credential field/u
  );
});
