// Lance le serveur web et le worker ensemble en développement : npm run dev:all
import { spawn } from "node:child_process";

const procs = [
  spawn("npx", ["next", "dev", "-p", "3000"], { stdio: "inherit" }),
  spawn("npx", ["tsx", "watch", "src/worker/index.ts"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => {
  if (code) {
    console.error(`[dev] un processus s'est arrêté (code ${code})`);
    stop();
    process.exit(code);
  }
}));
