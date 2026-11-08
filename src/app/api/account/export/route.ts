import { authed } from "@/server/http";
import { exportUserData } from "@/server/account";

export const GET = authed(async (_req, user) => {
  const data = await exportUserData(user.id);
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="coachgg-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
