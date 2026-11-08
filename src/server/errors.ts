export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Ressource") => new HttpError(404, "not_found", `${what} introuvable.`);
export const forbidden = (msg = "Accès refusé.") => new HttpError(403, "forbidden", msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "bad_request", msg, details);
export const unauthorized = () => new HttpError(401, "unauthorized", "Connexion requise.");
