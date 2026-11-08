import { deviceOnly, json } from "@/server/http";

export const GET = deviceOnly(async (_req, device) => json({ device: { id: device.id, name: device.name } }));
