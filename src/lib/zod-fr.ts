// Messages de validation zod en français (zod 4 fournit les traductions).
// Importé une fois côté serveur ; sans effet sur les messages personnalisés.
import { z } from "zod";

z.config(z.locales.fr());
