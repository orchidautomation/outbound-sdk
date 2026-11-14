// HeyReach's Organization Management reads. They span every workspace of an
// organization and need the organization API key in place of a workspace key:
// build the adapter with that key to use them. With a workspace key they
// answer 401. The Organization API has its own budget of 300 requests a
// minute, the `organization` lane.

import { defineNative } from "../internal/native.ts";
import type { NativeParam } from "../internal/native.ts";

const DOCS = "https://docs.heyreach.io/hey-reach-api/organization";

export const ORGANIZATION_LANE = "organization";

const NEEDS_KEY = "Needs the organization API key.";

const userFilters = {
  invitationStatus: {
    description:
      "Only users whose invitation has one of these statuses, as an array of names.",
    in: "body",
    type: "json",
  },
  limit: {
    description: "How many users to return.",
    in: "body",
    type: "number",
  },
  offset: {
    description: "How many users to skip.",
    in: "body",
    type: "number",
  },
  role: {
    description: "Only users with this role.",
    in: "body",
    type: "string",
  },
} as const satisfies Record<string, NativeParam>;

export const ORGANIZATION_NATIVE = defineNative({
  organizationLinkedInAccounts: {
    description: `LinkedIn accounts across every workspace of the organization, each with its workspace, connection state and count of active campaigns. ${NEEDS_KEY}`,
    docs: `${DOCS}/linked-in-accounts/get-linked-in-accounts`,
    lane: ORGANIZATION_LANE,
    method: "POST",
    params: {
      keyword: {
        description: "Search text.",
        in: "body",
        type: "string",
      },
      limit: {
        description: "How many accounts to return.",
        in: "body",
        type: "number",
      },
      offset: {
        description: "How many accounts to skip.",
        in: "body",
        type: "number",
      },
      workspaceIds: {
        description:
          "Only accounts in these workspaces, as an array of ids. Empty or left out means every workspace.",
        in: "body",
        type: "json",
      },
    },
    path: "/management/organizations/linkedin-accounts",
  },
  organizationUser: {
    description: `One user of the organization: name, email, roles and permissions. ${NEEDS_KEY}`,
    docs: `${DOCS}/workspace-users/get-user-by-id`,
    lane: ORGANIZATION_LANE,
    method: "GET",
    params: {
      userId: {
        description: "The user's id.",
        in: "path",
        type: "number",
      },
    },
    path: "/management/organizations/users/{userId}",
  },
  organizationUsers: {
    description: `Every existing and invited user of the organization, with roles, invitation state and permissions per workspace. ${NEEDS_KEY}`,
    docs: `${DOCS}/workspace-users/get-all-users`,
    lane: ORGANIZATION_LANE,
    method: "POST",
    params: userFilters,
    path: "/management/organizations/users",
  },
  organizationWorkspaces: {
    description: `The organization's workspaces, each with its name, seat limit and seats used. ${NEEDS_KEY}`,
    docs: `${DOCS}/workspaces/get-all-workspaces`,
    lane: ORGANIZATION_LANE,
    method: "GET",
    params: {
      Limit: {
        description: "How many workspaces to return.",
        in: "query",
        type: "number",
      },
      Offset: {
        description: "How many workspaces to skip.",
        in: "query",
        type: "number",
      },
    },
    path: "/management/organizations/workspaces",
  },
  workspaceUsers: {
    description: `The users of one workspace, with their role and permissions. ${NEEDS_KEY}`,
    docs: `${DOCS}/workspace-users/get-workspace-users`,
    lane: ORGANIZATION_LANE,
    method: "POST",
    params: {
      ...userFilters,
      workspaceId: {
        description: "The workspace's id.",
        in: "path",
        type: "number",
      },
    },
    path: "/management/organizations/users/workspaces/{workspaceId}",
  },
});
