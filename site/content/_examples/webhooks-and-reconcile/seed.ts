// What the vendor lists for the same morning: the message the `email_sent`
// payload announces, the reply the `reply_received` payload announces, and a
// second sent message that no webhook announced.
import type { MemoryData } from "outbound-sdk/memory";

export const seed: MemoryData = {
  campaigns: [{ id: "01a1d77b-a332-7a01-8e03-6f1a3f4d7599" }],
  messages: [
    {
      campaignId: "01a1d77b-a332-7a01-8e03-6f1a3f4d7599",
      direction: "out",
      id: "01a1d77b-a37a-7316-9165-874e4863045b",
      sentAt: "2026-11-14T00:36:06.650Z",
    },
    {
      campaignId: "01a1d77b-a332-7a01-8e03-6f1a3f4d7599",
      direction: "in",
      id: "01a1d77b-a37a-7316-9165-874e4863045c",
      sentAt: "2026-11-14T00:36:06.650Z",
    },
    {
      campaignId: "01a1d77b-a332-7a01-8e03-6f1a3f4d7599",
      direction: "out",
      id: "msg_no_webhook",
      sentAt: "2026-11-14T02:00:00.000Z",
    },
  ],
};
