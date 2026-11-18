// One run at a time: live runs share the vendors' rate limits, and three
// threads on Instantly's email lane slowed every call.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export class LockedError extends Error {
  constructor(pid: string) {
    super(`another eval run (pid ${pid}) holds the lock`);
    this.name = "LockedError";
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

/** Takes the lock in `dir`, or throws LockedError. A lock whose process is gone is taken over. */
export const takeLock = (dir: string): (() => void) => {
  const file = path.join(dir, ".lock");
  mkdirSync(dir, { recursive: true });

  try {
    writeFileSync(file, String(process.pid), { flag: "wx" });
  } catch {
    const holder = readFileSync(file, "utf-8").trim();

    if (alive(Number(holder))) {
      throw new LockedError(holder);
    }

    writeFileSync(file, String(process.pid));
  }

  return () => {
    rmSync(file, { force: true });
  };
};
