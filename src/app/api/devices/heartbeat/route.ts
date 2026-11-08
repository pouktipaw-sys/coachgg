import { deviceOnly, json, readJson } from "@/server/http";
import { deviceHeartbeat } from "@/server/devices";

export const POST = deviceOnly(async (req, device) => json(await deviceHeartbeat(device, await readJson(req))));
