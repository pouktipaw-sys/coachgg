import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://coachgg:coachgg@localhost:5432/coachgg_test";
  if (!/test/.test(url)) throw new Error("Refus : la base de test doit contenir « test » dans son nom.");
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
  // Fixtures vidéo réelles générées avec FFmpeg (si absentes).
  const dir = path.resolve(__dirname, "../fixtures/generated");
  mkdirSync(dir, { recursive: true });
  const run = (cmd: string) => execSync(cmd, { stdio: "pipe", cwd: dir });
  if (!existsSync(path.join(dir, "sample.mp4")))
    run("ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 -t 20 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest sample.mp4");
  if (!existsSync(path.join(dir, "sample.webm")))
    run("ffmpeg -loglevel error -y -f lavfi -i testsrc=size=640x360:rate=25 -t 6 -c:v libvpx-vp9 -b:v 300k sample.webm");
  if (!existsSync(path.join(dir, "corrupt.mp4"))) run("sh -c \"(printf '\\000\\000\\000\\030ftypisom'; head -c 50000 /dev/urandom) > corrupt.mp4\"");
}
