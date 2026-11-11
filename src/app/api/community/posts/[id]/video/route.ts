// Vidéo d'un reel : le clip exporté uniquement (jamais la vidéo complète), membres connectés.
import { authed } from "@/server/http";
import { reelVideoKey } from "@/server/community";
import { serveVideo } from "@/server/storage/serve";

type P = { id: string };
export const GET = authed<P>(async (req, user, { id }) => serveVideo(req, await reelVideoKey(user.id, id)));
