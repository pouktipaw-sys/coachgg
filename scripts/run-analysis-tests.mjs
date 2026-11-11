// Tests Python de l'analyseur, avec l'interpréteur du venv (Windows ou Unix).
import { spawnSync } from "node:child_process";
const py = process.platform === "win32" ? ".venv-analysis\\Scripts\\python.exe" : ".venv-analysis/bin/python";
const r = spawnSync(process.env.ANALYSIS_PYTHON || py, ["-m", "unittest", "discover", "-s", "analysis"], { stdio: "inherit" });
process.exit(r.status ?? 1);
