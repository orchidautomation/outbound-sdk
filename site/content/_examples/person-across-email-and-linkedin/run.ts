import { outbound } from "./agency.ts";
import { personBrief } from "./person.ts";
import { DANA, OMAR, OMAR_PROFILE } from "./seed.ts";

// The email tool holds Dana's address and her profile on one record, so her
// address reaches the LinkedIn campaign too.
console.log(await personBrief(outbound, DANA));

// No record holds both of Omar's identifiers. His address finds the email
// campaign only, and his profile finds the LinkedIn campaign only.
console.log(`\n${await personBrief(outbound, OMAR)}`);

console.log(`\n${await personBrief(outbound, OMAR_PROFILE)}`);
