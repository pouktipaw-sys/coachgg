import { prisma } from "./db";

export async function notify(userId: string, n: { type: string; title: string; body?: string; link?: string }) {
  await prisma.notification.create({ data: { userId, ...n } });
}
