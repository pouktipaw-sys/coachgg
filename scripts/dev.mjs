// Lance le serveur web et le worker ensemble en développement : npm run dev:all
// Les outils sont lancés directement avec Node (pas via « npx ») : fonctionne
// aussi sous Windows, où « npx » est un script .cmd que spawn ne peut pas exécuter.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const bin = (p) => fileURLToPath(new URL(`../node_modules/${p}`, import.meta.url));
const run = (file, args) => spawn(process.execPath, [bin(file), ...args], { stdio: "inherit" });

const procs = [
  run("next/dist/bin/next", ["dev", "-p", process.env.PORT ?? "3000"]),
  run("tsx/dist/cli.mjs", ["watch", "src/worker/index.ts"]),
];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  procs.forEach((p) => p.exitCode == null && p.kill());
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) =>
  p.on("exit", (code) => {
    if (code && !stopping) {
      console.error(`[dev] un processus s'est arrêté (code ${code})`);
      stop();
      process.exit(code);
    }
  }),
);
