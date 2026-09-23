// Evaluate an export_descr_buildings alias the way its `requires` line reads.
// Aliases are boolean expressions over building checks and other aliases, e.g.
// RIS:
//   alias gov_tier_1  requires building_present_min_level governmentA gov1 or …
//   alias aor_tier_1  requires gov_tier_1 and not colony_tier_2
// The recruit evaluators used to know only aliases that are an OR of building
// checks; a compound one (aor_tier_*) was never tested and passed silently.
//
// Operators as the EDB writes them: `or` between branches, `and` inside one,
// `not` before a term — no brackets appear in alias bodies.
//
// ctx: {
//   hasMinLevel(chain, level|null) -> bool   built chain at >= level (null: any)
//   hasTag(tag) -> bool                      region hidden_resource
//   isPlayer: bool                           whose view (default true)
// }
// Returns true/false, or null when a term cannot be judged here (the caller
// keeps its old behaviour for that alias).
export function evalAlias(name, exprs, ctx, depth = 0) {
  const expr = exprs && exprs[name];
  if (typeof expr !== "string" || depth > 12) return null;
  let unknown = false;
  const term = (t) => {
    const s = t.trim();
    let m;
    if (exprs[s] != null) {
      const v = evalAlias(s, exprs, ctx, depth + 1);
      if (v == null) unknown = true;
      return !!v;
    }
    if ((m = s.match(/^building_present_min_level\s+(\S+)\s+(\S+)$/))) return ctx.hasMinLevel(m[1], m[2]);
    if ((m = s.match(/^building_present\s+(\S+)$/))) return ctx.hasMinLevel(m[1], null);
    if ((m = s.match(/^hidden_resource\s+(\S+)$/))) return ctx.hasTag ? ctx.hasTag(m[1].toLowerCase()) : (unknown = true, false);
    if (s === "is_player") return ctx.isPlayer !== false;
    unknown = true; // queued checks, no_building_tagged, …
    return false;
  };
  const value = expr.split(/\s+or\s+/).some((branch) =>
    branch.split(/\s+and\s+/).every((t) => {
      const m = t.trim().match(/^not\s+(.+)$/);
      return m ? !term(m[1]) : term(t);
    }));
  return unknown ? null : value;
}

// Every alias a recruit line's `requires` names, with its `not`, judged:
// false as soon as one fails. Aliases it cannot judge are skipped (left to the
// caller's older checks).
export function aliasesAllow(requires, exprs, ctx) {
  if (!requires || !exprs) return true;
  for (const m of requires.matchAll(/(\bnot\s+)?\b([a-z][a-z0-9_]*)\b/g)) {
    if (exprs[m[2]] == null) continue;
    const v = evalAlias(m[2], exprs, ctx);
    if (v == null) continue;
    if (m[1] ? v : !v) return false;
  }
  return true;
}

