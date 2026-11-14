import { compareRates, rate, wilson } from "outbound-sdk/insights";

// The same 20% reply rate, on 10 sends and on 1,000.
console.log("2 of 10:", rate(2, 10), wilson(2, 10));

console.log("200 of 1,000:", rate(200, 1000), wilson(200, 1000));

// 40 replies from 500 sends against 20 from 500, and 10 from 400 against 6.
console.log(
  "8% against 4%:",
  compareRates({ successes: 40, trials: 500 }, { successes: 20, trials: 500 })
);

console.log(
  "2.5% against 1.5%:",
  compareRates({ successes: 10, trials: 400 }, { successes: 6, trials: 400 })
);

// A count the vendor does not report gives no rate and no interval.
console.log("unknown count:", rate(null, 500), wilson(null, 500));
