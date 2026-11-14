import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: ["fixtures/**", "**/CHANGELOG.md", "package-lock.json"],
});
