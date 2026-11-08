import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Nouveau mot de passe" };

export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="reset" />
    </Suspense>
  );
}
