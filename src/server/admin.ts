import { forbidden } from "./errors";
import type { SafeUser } from "./auth/session";

export function requireAdmin(user: SafeUser) {
  if (user.role !== "ADMIN") throw forbidden("Réservé aux administrateurs.");
}
