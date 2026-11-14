// HeyReach's voice reads: the voices a workspace can send voice notes with,
// its uploaded clips and its ElevenLabs connection. Every one answers 403
// VOICE_NOTES_NOT_ENABLED when the workspace has no voice notes.

import { defineNative } from "../internal/native.ts";

const DOCS = "https://docs.heyreach.io/hey-reach-api/voice";

export const VOICE_NATIVE = defineNative({
  elevenLabsConnection: {
    description:
      "The workspace's ElevenLabs connection: whether a key is connected, its status, the last four characters of the key, the last library sync and how many imported voices it offers. The key itself is never returned.",
    docs: `${DOCS}/get-eleven-labs-connection`,
    method: "GET",
    path: "/voice/GetElevenLabsConnection",
  },
  elevenLabsVoices: {
    description:
      "The ElevenLabs voices imported into the workspace, ordered by name, as the last library sync stored them.",
    docs: `${DOCS}/get-eleven-labs-voices`,
    method: "GET",
    params: {
      limit: {
        description: "How many voices to return, 1 to 500. Defaults to 100.",
        in: "query",
        type: "number",
      },
      offset: {
        description: "How many voices to skip. Defaults to 0.",
        in: "query",
        type: "number",
      },
      search: {
        description: "Case-insensitive match on the voice name.",
        in: "query",
        type: "string",
      },
    },
    path: "/voice/GetElevenLabsVoices",
  },
  senderVoice: {
    description:
      "The voice assigned to one LinkedIn account. Answers 404 SENDER_VOICE_NOT_ASSIGNED when the account has none.",
    docs: `${DOCS}/get-sender-voice`,
    method: "GET",
    params: {
      accountId: {
        description: "The LinkedIn account's id.",
        in: "path",
        type: "number",
      },
    },
    path: "/voice/GetSenderVoice/{accountId}",
  },
  staticClip: {
    description:
      "One uploaded voice clip: its duration, its transcript and why a transcript is absent. Metadata only; the audio is not returned.",
    docs: `${DOCS}/get-static-clip`,
    method: "GET",
    params: {
      clipId: {
        description: "The clip's id, as staticClips lists it.",
        in: "path",
        type: "number",
      },
    },
    path: "/voice/GetStaticClip/{clipId}",
  },
  staticClips: {
    description:
      "The workspace's uploaded voice clips, newest first, with duration and transcript. Metadata only.",
    docs: `${DOCS}/get-static-clips`,
    method: "GET",
    params: {
      limit: {
        description: "How many clips to return, 1 to 100. Defaults to 50.",
        in: "query",
        type: "number",
      },
      offset: {
        description: "How many clips to skip. Defaults to 0.",
        in: "query",
        type: "number",
      },
    },
    path: "/voice/GetStaticClips",
  },
  voiceUsage: {
    description:
      "Where one voice is in use: the LinkedIn accounts it is assigned to and whether any of them is in a running campaign.",
    docs: `${DOCS}/get-voice-usage`,
    method: "GET",
    params: {
      id: {
        description: "The voice's id, as voices lists it.",
        in: "path",
        type: "number",
      },
      kind: {
        description: "PREDEFINED or CUSTOM. Defaults to CUSTOM.",
        in: "query",
        type: "string",
      },
    },
    path: "/voice/GetVoiceUsage/{id}",
  },
  voices: {
    description:
      "The workspace's voice library: every predefined voice and the workspace's own cloned voices, each with the LinkedIn accounts it is assigned to.",
    docs: `${DOCS}/get-voices`,
    method: "GET",
    params: {
      gender: {
        description: "Only voices of this gender: MALE or FEMALE.",
        in: "query",
        type: "string",
      },
    },
    path: "/voice/GetVoices",
  },
});
