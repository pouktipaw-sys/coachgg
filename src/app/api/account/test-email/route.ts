// Email de test envoyé à l'adresse du compte : vérifie la configuration SMTP depuis l'interface.
import { authed } from "@/server/http";
import { HttpError } from "@/server/errors";
import { sendMail } from "@/server/mailer";

const last = new Map<string, number>(); // 1 envoi par minute et par compte

export const POST = authed(async (_req, user) => {
  const now = Date.now();
  if (now - (last.get(user.id) ?? 0) < 60_000) throw new HttpError(429, "too_many", "Attends une minute avant de renvoyer un email de test.");
  last.set(user.id, now);
  const r = await sendMail({
    to: user.email,
    subject: "CoachGG — email de test",
    text: "Si tu lis ce message, l'envoi d'emails de CoachGG fonctionne : invitations et liens de réinitialisation arriveront ici.",
  });
  if (r.driver === "smtp" && !r.delivered)
    throw new HttpError(502, "smtp_failed", "Le serveur SMTP a refusé l'envoi : vérifie SMTP_URL (adresse, mot de passe d'application, port) dans .env.");
  if (r.driver === "console") return Response.json({ delivered: false, message: "Aucun SMTP configuré : le message a été écrit dans la console du serveur (dev uniquement)." });
  if (r.driver === "none") throw new HttpError(503, "not_configured", "Aucun SMTP configuré (SMTP_URL) : aucun email ne peut être envoyé.");
  return Response.json({ delivered: true });
});
