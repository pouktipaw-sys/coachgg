import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CoachGG", template: "%s · CoachGG" },
  description: "Coaching League of Legends après match : statistiques, vidéo annotée et progression entre amis.",
};

export const viewport: Viewport = { themeColor: "#0a0d14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
