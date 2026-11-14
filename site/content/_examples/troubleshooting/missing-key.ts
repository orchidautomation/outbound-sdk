import { OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

// The samples run with a placeholder key in the environment. Take it away
// to see what a missing key looks like.
delete process.env.INSTANTLY_API_KEY;

try {
  instantly();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

// A variable that is set but blank counts as missing.
process.env.INSTANTLY_API_KEY = "   ";

try {
  instantly();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}
