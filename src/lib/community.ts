// Libellés partagés serveur/navigateur de l'espace communauté.
export type CommunityKind = "CLIP" | "EXPLOIT" | "QUESTION" | "DISCUSSION";
export const KIND_LABEL: Record<CommunityKind, string> = { CLIP: "🎬 Reel", EXPLOIT: "🏆 Exploit", QUESTION: "❓ Conseil demandé", DISCUSSION: "💬 Discussion" };
