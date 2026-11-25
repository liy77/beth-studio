// Completar pasta no LocationBar (Tab). Funções puras — tests/pathComplete.test.ts.

/** Separador dominante do caminho (UNC/Windows → `\`, senão `/`). */
export function pathSep(p: string): "/" | "\\" {
  if (p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p) || (p.includes("\\") && !p.startsWith("/"))) return "\\";
  return "/";
}

/** Troca `~` / `~/…` pela pasta do usuário. */
export function expandHome(p: string, home: string): string {
  const h = home.replace(/[\\/]+$/, "");
  if (!h) return p;
  if (p === "~") return h;
  if (p.startsWith("~/") || p.startsWith("~\\")) return h + p.slice(1);
  return p;
}

/** Pasta a listar + prefixo do nome incompleto. */
export function splitDirPrefix(raw: string, sep: "/" | "\\" = pathSep(raw)): { dir: string; prefix: string } {
  const p = raw;
  if (!p) return { dir: sep === "/" ? "/" : ".", prefix: "" };
  if (p.endsWith("/") || p.endsWith("\\")) {
    const dir = p.replace(/[\\/]+$/, "") || (sep === "/" ? "/" : p.slice(0, 3));
    return { dir, prefix: "" };
  }
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return { dir: ".", prefix: p };
  if (i === 0) return { dir: "/", prefix: p.slice(1) }; // "/Use" → dir "/", prefix "Use"
  // "C:\Use" → i=2 após "C:"
  if (/^[A-Za-z]:$/.test(p.slice(0, i))) return { dir: p.slice(0, i + 1), prefix: p.slice(i + 1) };
  return { dir: p.slice(0, i), prefix: p.slice(i + 1) };
}

/** Prefixo comum (case-insensitive no match, preserva maiúsculas do 1º). */
export function commonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  const lower = names.map((n) => n.toLowerCase());
  let end = lower[0].length;
  for (let i = 1; i < lower.length; i++) {
    let j = 0;
    while (j < end && j < lower[i].length && lower[0][j] === lower[i][j]) j++;
    end = j;
    if (end === 0) return "";
  }
  return names[0].slice(0, end);
}

/** Junta dir + nome com o separador certo (e `/` final se for pasta). */
export function joinDirName(dir: string, name: string, sep: "/" | "\\", asDir = true): string {
  let base = dir;
  if (base === ".") base = "";
  if (!base) return asDir ? name + sep : name;
  if (base === "/") return `/${name}${asDir ? "/" : ""}`;
  if (/^[A-Za-z]:\\?$/.test(base)) {
    const root = base.endsWith("\\") || base.endsWith("/") ? base : base + sep;
    return root + name + (asDir ? sep : "");
  }
  const trimmed = base.replace(/[\\/]+$/, "");
  return trimmed + sep + name + (asDir ? sep : "");
}

/**
 * Aplica Tab: filtra pastas pelo prefixo e completa até o maior prefixo comum.
 * `names` = só pastas (já filtradas is_dir). Retorna null se nada casa.
 */
export function applyTabComplete(
  value: string,
  names: string[],
  opts?: { home?: string },
): { next: string; matches: string[] } | null {
  const home = opts?.home ?? "";
  const expanded = expandHome(value, home);
  const sep = pathSep(expanded.includes("\\") ? expanded : value || expanded);
  const { dir, prefix } = splitDirPrefix(expanded, sep);
  const pre = prefix.toLowerCase();
  const matches = names
    .filter((n) => n.toLowerCase().startsWith(pre))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (matches.length === 0) return null;

  let out: string;
  if (matches.length === 1) {
    out = joinDirName(dir, matches[0], sep, true);
  } else {
    const done = commonPrefix(matches);
    if (done.length <= prefix.length) return { next: value, matches };
    out = joinDirName(dir, done, sep, false);
  }

  if (value.startsWith("~") && home) {
    const h = home.replace(/[\\/]+$/, "");
    if (out === h || out.startsWith(h + "/") || out.startsWith(h + "\\")) {
      out = "~" + out.slice(h.length);
    }
  }
  return { next: out, matches };
}
