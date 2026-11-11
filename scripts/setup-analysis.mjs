// Installe l'environnement Python de l'analyse (Windows, macOS, Linux) : npm run setup:analysis
// Crée .venv-analysis puis installe analysis/requirements.txt (OpenCV, NumPy, Pillow).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const win = process.platform === "win32";
const venvPython = win ? ".venv-analysis\\Scripts\\python.exe" : ".venv-analysis/bin/python";

function works(cmd, args) {
  const r = spawnSync(cmd, [...args, "-c", "import sys; assert sys.version_info >= (3, 10)"], { stdio: "ignore" });
  return r.status === 0;
}
function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\nÉchec de : ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(venvPython)) {
  const candidates = win ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
  const found = candidates.find(([c, a]) => works(c, a));
  if (!found) {
    console.error(
      "Python 3.10 ou plus est introuvable.\n" +
        (win ? "Installez-le avec : winget install Python.Python.3.12  (puis rouvrez le terminal)\n" : "Installez python3 et python3-venv.\n"),
    );
    process.exit(1);
  }
  run(found[0], [...found[1], "-m", "venv", ".venv-analysis"]);
}
run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
run(venvPython, ["-m", "pip", "install", "-r", "analysis/requirements.txt"]);
run(venvPython, ["-c", "import cv2, numpy, PIL; print('Analyse prête : OpenCV', cv2.__version__)"]);
console.log("\nRelancez l'analyse depuis la page de la vidéo (pas besoin de redémarrer le serveur).");
