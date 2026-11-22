import { describe, expect, it } from "vitest";
import { CHAMPIONS, canonicalChampion, searchChampions } from "@/lib/champions";

describe("autocomplétion des champions", () => {
  it("liste complète, sans doublon", () => {
    expect(CHAMPIONS.length).toBeGreaterThan(165);
    expect(new Set(CHAMPIONS).size).toBe(CHAMPIONS.length);
  });
  it("propose dès la première lettre, ceux qui commencent par le texte d'abord", () => {
    expect(searchChampions("")).toEqual([]);
    expect(searchChampions("a").length).toBe(8);
    expect(searchChampions("ah")[0]).toBe("Ahri");
    expect(searchChampions("ya")[0]).toBe("Yasuo");
    expect(searchChampions("zed")).toEqual(["Zed"]);
  });
  it("ignore casse, accents et ponctuation ; reconnaît les mots du nom et les surnoms", () => {
    expect(searchChampions("kaisa")).toContain("Kai'Sa");
    expect(searchChampions("KHA")).toContain("Kha'Zix");
    expect(searchChampions("sin")[0]).toBe("Lee Sin");
    expect(searchChampions("mf")[0]).toBe("Miss Fortune");
    expect(searchChampions("j4")[0]).toBe("Jarvan IV");
  });
  it("exclut les champions déjà choisis", () => {
    expect(searchChampions("ah", 8, ["Ahri"])).not.toContain("Ahri");
  });
  it("normalise la saisie exacte, garde la saisie libre sinon", () => {
    expect(canonicalChampion("kaisa")).toBe("Kai'Sa");
    expect(canonicalChampion("dr mundo")).toBe("Dr. Mundo");
    expect(canonicalChampion("tf")).toBe("Twisted Fate");
    expect(canonicalChampion("NouveauChamp ")).toBe("NouveauChamp");
  });
});
