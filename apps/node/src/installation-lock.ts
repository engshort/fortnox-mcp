import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// Linux flock owns an open descriptor, so crashes release the lock automatically.
// The child exits when the parent pipe closes; no stale PID or timeout lease.
export async function installationLock(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const child = spawn(
    "flock",
    [
      "--exclusive",
      "--nonblock",
      "--",
      `${path}.lock`,
      process.execPath,
      "-e",
      "process.stdout.write('locked');process.stdin.resume()",
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Installation lock unavailable"));
    }, 5000);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Linux flock unavailable"));
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Installation is running or locked"));
    });
    child.stdout.once("data", (data) => {
      clearTimeout(timeout);
      if (String(data) === "locked") resolve();
      else {
        child.kill();
        reject(new Error("Installation lock unavailable"));
      }
    });
  });
  return async () => {
    child.stdin.end();
    await exited;
  };
}
