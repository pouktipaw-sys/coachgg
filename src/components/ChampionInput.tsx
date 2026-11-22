"use client";
// Saisie de champion avec autocomplétion : la liste apparaît dès la première lettre.
// Clavier : ↑/↓ pour choisir, Entrée ou Tab pour valider, Échap pour fermer. La saisie libre reste possible.
import { useId, useRef, useState } from "react";
import { canonicalChampion, searchChampions } from "@/lib/champions";

type Props = {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  /** Appelé quand un champion est choisi dans la liste (en plus de onChange). */
  onPick?: (v: string) => void;
  name?: string;
  id?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  "aria-label"?: string;
  exclude?: readonly string[];
  /** Vide le champ après un choix (saisie multiple). */
  clearOnPick?: boolean;
  onKeyDownExtra?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

export function ChampionInput(p: Props) {
  const [inner, setInner] = useState(p.defaultValue ?? "");
  const value = p.value ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const items = open ? searchChampions(value, 8, p.exclude) : [];

  const set = (v: string) => {
    if (p.value === undefined) setInner(v);
    p.onChange?.(v);
  };
  const pick = (c: string) => {
    set(p.clearOnPick ? "" : c);
    p.onPick?.(c);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        id={p.id}
        name={p.name}
        className={p.className ?? "input"}
        placeholder={p.placeholder}
        required={p.required}
        aria-label={p["aria-label"]}
        autoComplete="off"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => value && setOpen(true)}
        onBlur={() => {
          // Laisse le temps au clic sur une suggestion ; normalise « kaisa » → « Kai'Sa ».
          blurTimer.current = setTimeout(() => {
            setOpen(false);
            if (!p.clearOnPick && value) {
              const c = canonicalChampion(value);
              if (c !== value) set(c);
            }
          }, 120);
        }}
        onKeyDown={(e) => {
          if (items.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + items.length) % items.length);
              return;
            }
            if (e.key === "Enter" || (e.key === "Tab" && value)) {
              e.preventDefault();
              pick(items[Math.min(active, items.length - 1)]!);
              return;
            }
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
          }
          p.onKeyDownExtra?.(e);
        }}
      />
      {items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-panel py-1 text-sm shadow-xl">
          {items.map((c, i) => (
            <li
              key={c}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === active ? "bg-accent/20 text-text" : "text-muted hover:bg-white/5"}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // garde le focus dans le champ
                if (blurTimer.current) clearTimeout(blurTimer.current);
                pick(c);
              }}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/20 text-[10px] font-bold text-accent-2">{c.slice(0, 2).toUpperCase()}</span>
              <Highlight text={c} query={value} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (!query.trim() || i < 0) return <span>{text}</span>;
  const n = query.trim().length;
  return (
    <span>
      {text.slice(0, i)}
      <strong className="text-text">{text.slice(i, i + n)}</strong>
      {text.slice(i + n)}
    </span>
  );
}

/** Plusieurs champions (pastilles) : la valeur envoyée est « A, B, C » dans un champ caché `name`. */
export function ChampionMultiInput({ name, id, defaultValue = [], max = 5 }: { name: string; id?: string; defaultValue?: string[]; max?: number }) {
  const [list, setList] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState("");
  const add = (c: string) => {
    const v = canonicalChampion(c);
    if (!v || list.length >= max || list.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setList([...list, v]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={list.join(", ")} />
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs text-accent-2">
              {c}
              <button type="button" aria-label={`Retirer ${c}`} className="text-muted hover:text-loss" onClick={() => setList(list.filter((x) => x !== c))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {list.length < max ? (
        <ChampionInput
          id={id}
          value={draft}
          onChange={setDraft}
          onPick={add}
          clearOnPick
          exclude={list}
          placeholder={list.length ? "Ajouter un autre champion…" : "Tape un champion (ex. Ahri)…"}
          aria-label="Ajouter un champion préféré"
          onKeyDownExtra={(e) => {
            if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && list.length) setList(list.slice(0, -1));
          }}
        />
      ) : (
        <p className="text-xs text-muted">{max} champions maximum.</p>
      )}
    </div>
  );
}
