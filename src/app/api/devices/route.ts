import { authed, json } from "@/server/http";
import { listDevices } from "@/server/devices";

export const GET = authed(async (_req, user) => json({ devices: await listDevices(user.id) }));
