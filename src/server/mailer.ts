// Envoi d'emails : NON IMPLÉMENTÉ en V1.
// En développement, le contenu est écrit dans les logs du serveur pour pouvoir
// tester la récupération de compte. En production, aucun email n'est envoyé :
// un fournisseur SMTP/API doit être branché ici (voir docs/CONFIGURATION.md).
import { env } from "@/lib/env";

export async function sendMail(msg: { to: string; subject: string; text: string }) {
  if (!env.isProd) {
    console.log(`[mailer:console — DEV UNIQUEMENT] À: ${msg.to} | ${msg.subject}\n${msg.text}`);
    return { delivered: false, driver: "console" as const };
  }
  console.warn("[mailer] aucun fournisseur email configuré : message non envoyé.");
  return { delivered: false, driver: "none" as const };
}
