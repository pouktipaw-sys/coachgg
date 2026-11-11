import { redirect } from "next/navigation";

// Les coéquipiers suivis sont désormais dans la page « Amis ».
export default function TeammatesPage() {
  redirect("/app/friends#suivis");
}
