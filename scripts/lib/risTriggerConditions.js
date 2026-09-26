/**
 * Trigger conditions in plain English, shared by the trait and retinue (ancillary) pages so a
 * condition reads the same on both.
 *
 *   const CR = makeConditionReader({ RIS, OUT, traitRef, ancRef });
 *   CR.render(["Trait GoodGeneral >= 2", "and FactionType seleucid", "and RandomPercent < 10"])
 *     -> { text: "has [Good General](…) at level 2 or higher · belongs to Seleucid Empire · 10% chance",
 *          hidden: false, unknown: [] }
 *
 * `traitRef(token)` returns a markdown link for a trait the player can see and null for a
 * hidden one; `ancRef(token)` a retinue member's name or link. Both are the caller's, so the
 * links are written from the caller's own folder.
 *
 * THE GRAMMAR, measured over both files (2026-09-26): the top level of every condition list is
 * a chain of `and`; parentheses hold only `or` groups; nothing nests; no `or` appears outside
 * parentheses. The parser below enforces exactly that shape and reports anything else as
 * unknown rather than guessing at a precedence.
 *
 * HIDDEN CLAUSES. A clause about a hidden trait (the mod's own `Hidden` flag), or a hidden
 * region marker with no page, is dropped and the row says "(plus hidden conditions)". An `or`
 * group with any hidden branch is dropped whole: removing one branch of an `or` would change
 * what the rest means.
 *
 * Every phrase maps one engine condition to its documented meaning; a condition this file does
 * not know is never paraphrased — it is returned in `unknown` so the caller can show the raw
 * text behind a fold.
 */
const fs = require("fs");
const path = require("path");

function makeConditionReader({ RIS, OUT, traitRef, ancRef }) {
  const loadText = (file, lower = true) => {
    const map = {};
    try {
      const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
      for (const m of t.matchAll(/\{([^}]+)\}([^\r\n]*)/g)) map[lower ? m[1].trim().toLowerCase() : m[1].trim()] = m[2].trim();
    } catch { /* tokens fall back to their humanised form */ }
    return map;
  };
  const readJson = (...f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, ...f), "utf8")); } catch { return {}; } };
  const CAMPAIGN = loadText("campaign_descriptions.txt");
  const BI = loadText("expanded_bi.txt");
  const BUILDINGS = loadText("export_buildings.txt");
  const SETTLEMENTS = loadText("imperial_campaign_regions_and_settlement_names.txt");
  const RESOURCES = loadText("resources.txt");
  const EVENTS = loadText("major_events.txt");
  const CULTURES = readJson("cultures", "index.json");
  const TAGS = readJson("tags", "index.json");

  const human = (s) => String(s).replace(/_/g, " ");
  const title = (s) => human(s).replace(/\b\w/g, (c) => c.toUpperCase());
  // Faction and culture keys are interchangeable in this engine's conditions, so each lookup
  // falls through to the other family before giving up.
  const factionName = (k) => {
    const l = String(k).toLowerCase();
    return CAMPAIGN[`imperial_campaign_${l}_title`] || BI[l] || (CULTURES[l] && CULTURES[l].name) || title(k);
  };
  const cultureName = (k) => {
    const l = String(k).toLowerCase();
    return (CULTURES[l] && CULTURES[l].name) || CAMPAIGN[`imperial_campaign_${l}_title`] || BI[l] || title(k);
  };
  const settlementName = (k) => SETTLEMENTS[String(k).toLowerCase()] || human(k);
  const buildingName = (k) => BUILDINGS[String(k).toLowerCase()] || human(k);
  const attrWord = (a) => human(a).replace(/([a-z])([A-Z])/g, "$1 $2");
  const anc = (k) => (ancRef ? ancRef(k) : human(k));

  // numbers
  const cmp = (op, n) => ({ ">": `above ${n}`, ">=": `${n} or more`, "<": `below ${n}`, "<=": `${n} or less`, "=": `exactly ${n}`, "!=": `anything but ${n}` }[op]);
  const pct = (op, n) => ({ ">": `over ${n}%`, ">=": `at least ${n}%`, "<": `under ${n}%`, "<=": `at most ${n}%`, "=": `exactly ${n}%`, "!=": `anything but ${n}%` }[op]);
  const NEG_OP = { ">": "<=", ">=": "<", "<": ">=", "<=": ">", "=": "!=" };
  const turn = (op, n) => ({ ">": `after turn ${n}`, ">=": `from turn ${n} on`, "<": `before turn ${n}`, "<=": `up to turn ${n}`, "=": `on turn ${n}`, "!=": `on any turn but ${n}` }[op]);

  // Level count per trait, so "= 1" on a one-level trait reads as simply "has it".
  const TRAIT_LEVELS = {};
  try {
    let cur = null;
    for (const raw of fs.readFileSync(path.join(RIS, "export_descr_character_traits.txt"), "latin1").split(/\r?\n/)) {
      const nc = raw.replace(/;.*$/, "");
      let m;
      if ((m = /^Trait\s+(\S+)/.exec(nc))) { cur = m[1]; TRAIT_LEVELS[cur] = 0; continue; }
      if (/^Trigger\s/.test(nc)) { cur = null; continue; }
      if (cur && /^\s*Level\s/.test(nc)) TRAIT_LEVELS[cur]++;
    }
  } catch { /* level counts unknown: levels are then always spelled out */ }

  // A trait level comparison. Conditions compare the trait's LEVEL (0 = not held). "less
  // than level N" and "at most level N" include not holding it at all, as the engine does.
  function traitLevel(who, tok, name, op, n) {
    const has = who ? `${who} has` : "has";
    const hasNot = who ? `${who} does not have` : "does not have";
    const max = TRAIT_LEVELS[tok] || 0;
    n = Number(n);
    if (op === "!=") return n === 0 ? `${has} ${name}` : max === 1 && n === 1 ? `${hasNot} ${name}` : `${hasNot} ${name} at exactly level ${n}`;
    if ((op === ">" && n === 0) || (op === ">=" && n <= 1) || (op === "=" && n === 1 && max === 1)) return `${has} ${name}`;
    if ((op === "=" && n === 0) || (op === "<" && n <= 1) || (op === "<=" && n === 0)) return `${hasNot} ${name}`;
    if (op === "=") return `${has} ${name} at level ${n}`;
    if (op === ">=") return `${has} ${name} at level ${n} or higher`;
    if (op === ">") return `${has} ${name} at level ${n + 1} or higher`;
    if (op === "<") return `${has} less than level ${n} of ${name}`;
    if (op === "<=") return `${has} at most level ${n} of ${name}`;
    return null;
  }

  // BattleSuccess grades how decisive the battle was (close < average < clear < crushing),
  // won or lost — WonBattle says which side it favoured.
  const BATTLE = new Set(["close", "average", "clear", "crushing"]);
  const battleResult = (op, v) => {
    if (!BATTLE.has(v)) return null;
    return {
      "=": `the outcome was ${v}`, ">=": `the outcome was ${v} or more decisive`, ">": `the outcome was more decisive than ${v}`,
      "<": `the outcome was less decisive than ${v}`, "<=": `the outcome was ${v} or less decisive`, "!=": `the outcome was not ${v}`,
    }[op] || null;
  };
  const CONFLICT = {
    Normal: "a field battle", Siege: "a siege assault", SallyBesieger: "a battle against a sally from a besieged town",
    FailedAmbush: "a failed ambush", SuccessfulAmbush: "a successful ambush",
  };
  const AGENT = { family: "a family member", diplomat: "a diplomat", spy: "a spy", assassin: "an assassin", admiral: "an admiral", merchant: "a merchant" };

  // Flags: [what it says, what `not` says].
  const FLAG = {
    IsGeneral: ["is a general", "is not a general"],
    IsAdmiral: ["is an admiral", "is not an admiral"],
    IsFactionLeader: ["is the faction leader", "is not the faction leader"],
    IsFactionHeir: ["is the faction heir", "is not the faction heir"],
    EndedInSettlement: ["ended the turn in a settlement", "ended the turn outside a settlement"],
    EndedInEnemyZOC: ["ended the turn in an enemy's zone of control", "did not end the turn in an enemy's zone of control"],
    WonBattle: ["won the battle", "did not win the battle"],
    WasAttacker: ["was the attacker", "was the defender"],
    GeneralFoughtInCombat: ["fought in person", "did not fight in person"],
    CharacterIsLocal: ["in his own faction's lands", "outside his own faction's lands"],
    InEnemyLands: ["in enemy lands", "not in enemy lands"],
    InBarbarianLands: ["in barbarian lands", "not in barbarian lands"],
    InUncivilisedLands: ["in uncivilised lands", "not in uncivilised lands"],
    AtSea: ["at sea", "not at sea"],
    IsUnderSiege: ["under siege", "not under siege"],
    IsBesieging: ["besieging a settlement", "not besieging"],
    GovernorInResidence: ["in residence as governor", "not in residence as governor"],
    MissionSucceeded: ["the mission succeeded", "the mission failed"],
    Routs: ["routed", "did not rout"],
    I_WithdrawsBeforeBattle: ["withdrew before battle", "did not withdraw before battle"],
    SettlementHasPlague: ["the settlement has plague", "the settlement is free of plague"],
    IsNightBattle: ["a night battle", "not a night battle"],
    NightBattlesEnabled: ["with night battles enabled", "with night battles disabled"],
    NoActionThisTurn: ["took no action this turn", "acted this turn"],
    BuildingQueueIdleDespiteCash: ["the building queue sits idle despite money in the treasury", "the building queue is in use"],
    RemasteredEducation: ["with the Remastered education setting on", "with the Remastered education setting off"],
  };

  // Hidden region markers the player never sees, rendered through the region-tag reference
  // where it covers them; "hidden" otherwise.
  function resourceClause(tok, neg) {
    const t = String(tok).toLowerCase();
    const ref = TAGS[t];
    let where = null;
    if (/^aor_/.test(t)) {
      const label = `${title(t.replace(/^aor_/, ""))} area of recruitment`;
      where = ref && ref.page ? `[${label}](../tags/${ref.page}#${ref.anchor})` : label;
      return neg ? `outside the ${where}` : `in the ${where}`;
    }
    if (ref && ref.page) {
      where = `[${ref.name || title(t)}](../tags/${ref.page}#${ref.anchor})`;
      return neg ? `not in a ${where} region` : `in a ${where} region`;
    }
    const good = RESOURCES[`smt_resource_${t}`];
    if (good) return neg ? `in a region without ${good}` : `in a region with ${good}`;
    return null;
  }

  // One atom -> { text } | { hidden: true } | null (unknown). `neg` is the leading `not`.
  function atom(words, neg) {
    const s = words.join(" ");
    let m;
    const o = (op) => (neg ? NEG_OP[op] : op);   // `not X > 5` reads as X <= 5
    if (FLAG[s]) return { text: FLAG[s][neg ? 1 : 0] };
    if ((m = /^(Trait|FatherTrait|FactionLeaderTrait)\s+(\S+)\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) {
      const ref = traitRef(m[2]);
      if (!ref) return { hidden: true };
      const who = { Trait: null, FatherTrait: "his father", FactionLeaderTrait: "the faction leader" }[m[1]];
      const op = neg ? NEG_OP[m[3]] : m[3];
      const t = traitLevel(who, m[2], ref, op, m[4]);
      return t ? { text: t } : null;
    }
    if ((m = /^FactionType\s+(\S+)$/.exec(s))) return { text: `${neg ? "does not belong" : "belongs"} to ${factionName(m[1])}`, list: neg ? null : ["belongs to", factionName(m[1])] };
    if ((m = /^CultureType\s+(\S+)$/.exec(s))) return { text: `${neg ? "not of" : "of"} ${cultureName(m[1])} culture`, list: neg ? null : ["of the culture:", cultureName(m[1])] };
    if ((m = /^IsFromFaction\s+fgroup_(\S+)$/.exec(s))) return { text: `${neg ? "not from" : "from"} a ${title(m[1])}-group faction` };
    if ((m = /^SettlementName\s+(\S+)$/.exec(s))) return { text: `${neg ? "not in" : "in"} ${settlementName(m[1])}`, list: neg ? null : ["in", settlementName(m[1])] };
    if ((m = /^I_SettlementOwner\s+(\S+)\s*=\s*(\S+)$/.exec(s))) return { text: `${settlementName(m[1])} is ${neg ? "not " : ""}held by ${factionName(m[2])}` };
    if ((m = /^RandomPercent\s*<\s*(\d+)$/.exec(s)) && !neg) return { text: `${m[1]}% chance` };
    if ((m = /^I_TurnNumber\s*(>=|<=|=|>|<)\s*(-?\d+)$/.exec(s))) {
      // `I_TurnNumber >= -1` is always true: the mod uses it as an always-on switch
      if (!neg && /^>/.test(m[1]) && Number(m[2]) < 0) return { text: "on any turn" };
      return { text: turn(o(m[1]), m[2]) };
    }
    if ((m = /^character_age\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) {
      const op = neg ? NEG_OP[m[1]] : m[1];
      if (op === "=") return { text: `aged ${m[2]}`, age: Number(m[2]) };
      return { text: op === "!=" ? `any age but ${m[2]}` : `age ${cmp(op, m[2])}` };
    }
    if ((m = /^AgentType\s*=\s*(\S+)$/.exec(s)) && AGENT[m[1]]) return { text: `is ${neg ? "not " : ""}${AGENT[m[1]]}` };
    if ((m = /^Attribute\s+(\S+)\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) {
      const op = neg ? NEG_OP[m[2]] : m[2];
      return { text: op === "!=" ? `${attrWord(m[1])} anything but ${m[3]}` : `${attrWord(m[1])} ${cmp(op, m[3])}` };
    }
    if ((m = /^RemainingMPPercentage\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) return { text: `${pct(o(m[1]), m[2])} of his movement left` };
    if ((m = /^PercentageEnemyKilled\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) return { text: `killed ${pct(o(m[1]), m[2])} of the enemy` };
    if ((m = /^PercentageOfArmyKilled\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) return { text: `lost ${pct(o(m[1]), m[2])} of his army` };
    if ((m = /^PercentageUnitCategory\s+(\w+)\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) return { text: `his army is ${pct(o(m[2]), m[3])} ${m[1]}` };
    if ((m = /^BattleOdds\s*(>=|<=|=|>|<)\s*([\d.]+)$/.exec(s))) return { text: `battle odds ${cmp(o(m[1]), m[2])} (his strength against the enemy's)` };
    if ((m = /^BattleSuccess\s*(>=|<=|=|>|<)\s*(\w+)$/.exec(s))) { const t = battleResult(neg ? NEG_OP[m[1]] : m[1], m[2]); return t ? { text: t } : null; }
    if ((m = /^GeneralHPLostRatioinBattle\s*(>=|<=|=|>|<)\s*([\d.]+)$/.exec(s))) return { text: `the general's hit-point loss ratio ${cmp(o(m[1]), m[2])}` };
    if ((m = /^GeneralNumKillsInBattle\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) return { text: `the general's own unit killed ${cmp(o(m[1]), m[2])} men` };
    if ((m = /^NumKilledGenerals\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) return { text: `generals killed: ${cmp(o(m[1]), m[2])}` };
    if ((m = /^DistanceCapital\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) return { text: `distance to the capital ${cmp(o(m[1]), m[2])}` };
    if ((m = /^Treasury\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) return { text: `treasury ${cmp(o(m[1]), Number(m[2]).toLocaleString("en-US"))}` };
    if ((m = /^I_NumberOfSettlements\s+(\S+)\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s))) {
      const op = neg ? NEG_OP[m[2]] : m[2];
      return { text: op === "!=" ? `${factionName(m[1])} does not hold exactly ${m[3]} settlements` : `${factionName(m[1])} holds ${cmp(op, m[3])} settlements` };
    }
    if ((m = /^SettlementOrderLevel\s+(\w+)\s*(>=|<=|=|>|<)\s*(\d+)$/.exec(s)) && !neg) return { text: `public order from ${m[1]} ${cmp(m[2], m[3])}` };
    if ((m = /^(SettlementBuildingExists|GovernorBuildingExists|SettlementBuildingFinished)\s*(>=|<=|=|>|<)\s*(\S+)$/.exec(s))) {
      const b = buildingName(m[3]);
      if (m[1] === "SettlementBuildingFinished") {
        if (neg) return null;
        return { text: m[2] === "=" ? `the building completed is ${b}` : m[2] === ">=" ? `the building completed is ${b} or a higher level` : null };
      }
      const where = m[1] === "GovernorBuildingExists" ? "the governed settlement" : "the settlement";
      const op = m[2];
      if (neg) {
        if (op === "=") return { text: `${where} does not have ${b}` };
        if (op === ">=") return { text: `${where} has nothing at or above ${b}` };
        if (op === ">") return { text: `${where} has nothing above ${b}` };
        return null;
      }
      return { text: {
        "=": `${where} has ${b}`, ">=": `${where} has ${b} or better`, ">": `${where} has something above ${b}`,
        "<": `${where} has less than ${b}`, "<=": `${where} has ${b} at most`,
      }[op] };
    }
    if ((m = /^HasResource\s+(\S+)$/.exec(s))) { const t = resourceClause(m[1], neg); return t ? { text: t } : { hidden: true }; }
    if ((m = /^DiplomaticStanceFromCharacter\s+(\S+)\s*=\s*(AtWar|Allied|Neutral|Protectorate|SuzerainOf)$/.exec(s))) {
      const st = { AtWar: "at war with", Allied: "allied with", Neutral: "neutral towards" }[m[2]];
      if (!st) return null;
      return { text: `his faction is ${neg ? "not " : ""}${st} ${factionName(m[1])}` };
    }
    if ((m = /^GeneralFoughtFaction\s+(\S+)$/.exec(s))) return { text: `${neg ? "did not fight" : "fought"} ${factionName(m[1])}` };
    if ((m = /^GeneralFoughtCulture\s+(\S+)$/.exec(s))) return { text: `${neg ? "did not fight" : "fought"} a faction of ${cultureName(m[1])} culture` };
    if ((m = /^TargetFactionType\s+(\S+)$/.exec(s))) return { text: `the target faction is ${neg ? "not " : ""}${factionName(m[1])}` };
    if ((m = /^TargetFactionCultureType\s+(\S+)$/.exec(s))) return { text: `the target faction is ${neg ? "not " : ""}of ${cultureName(m[1])} culture` };
    if ((m = /^I_ConflictType\s+(\w+)$/.exec(s)) && CONFLICT[m[1]]) return { text: `${neg ? "not " : ""}${CONFLICT[m[1]]}` };
    if ((m = /^MissionSuccessLevel\s*=\s*(\w+)$/.exec(s)) && !neg) return { text: `the mission was ${human(m[1])}` };
    if ((m = /^GovernorTaxLevel\s*(>=|<=|=|>|<)\s*tax_(\w+)$/.exec(s)) && !neg) {
      const lv = title(m[2]);
      return { text: { "=": `taxes set to ${lv}`, ">": `taxes above ${lv}`, ">=": `taxes at ${lv} or above`, "<": `taxes below ${lv}`, "<=": `taxes at ${lv} or below` }[m[1]] };
    }
    if ((m = /^GovernorLoyaltyLevel\s*(>=|<=|=|>|<)\s*loyalty_(\w+)$/.exec(s)) && !neg) {
      const lv = title(m[2]);
      return { text: { "=": `the city's mood is ${lv}`, ">": `the city's mood is above ${lv}`, ">=": `the city's mood is ${lv} or better`, "<": `the city's mood is below ${lv}`, "<=": `the city's mood is ${lv} or worse` }[m[1]] };
    }
    if ((m = /^HasOffice\s+(\S+)$/.exec(s))) return { text: `${neg ? "does not hold" : "holds"} the office of ${human(m[1])}` };
    if ((m = /^TrainedUnitCategory\s+(\w+)$/.exec(s)) && !neg) return { text: `the unit trained is ${m[1]}` };
    if ((m = /^HasAncillary\s+(\S+)$/.exec(s))) return { text: `${neg ? "does not have" : "has"} ${anc(m[1])} in his retinue` };
    if ((m = /^FactionwideAncillaryExists\s+(\S+)$/.exec(s))) return { text: neg ? `no one in his faction has ${anc(m[1])}` : `someone in his faction already has ${anc(m[1])}` };
    if ((m = /^WorldwideAncillaryExists\s+(\S+)$/.exec(s))) return { text: neg ? `no one in the world has ${anc(m[1])}` : `someone in the world already has ${anc(m[1])}` };
    if ((m = /^MajorEventActive\s+"([^"]+)"$/.exec(s))) {
      const k = m[1].toLowerCase();
      const name = EVENTS[`${k}_title`] || title(k);
      return { text: `${neg ? "unless" : "while"} the event "${name}" is active` };
    }
    if ((m = /^Toggled\s+(.+)$/.exec(s))) return { text: `with the "${m[1]}" setting ${neg ? "off" : "on"}` };
    return null;
  }

  // Parentheses stand alone as tokens; `and` separates top-level clauses, `or` separates the
  // branches of a parenthesised group, and a leading `not` negates one clause.
  function clauses(lines) {
    const toks = lines.join(" ").replace(/[()]/g, " $& ").split(/\s+/).filter(Boolean);
    const out = []; let i = 0; let ok = true;
    const readAtom = () => {
      let neg = false; const words = [];
      if (toks[i] === "not") { neg = true; i++; }
      while (i < toks.length && !["and", "or", "(", ")"].includes(toks[i])) words.push(toks[i++]);
      return { neg, words };
    };
    while (i < toks.length) {
      if (toks[i] === "and") { i++; continue; }
      if (toks[i] === "(") {
        i++; const alts = [];
        while (i < toks.length && toks[i] !== ")") {
          if (toks[i] === "or") { i++; continue; }
          if (toks[i] === "(" || toks[i] === "and") { ok = false; i++; continue; }
          alts.push(readAtom());
        }
        i++; out.push({ or: alts });
        continue;
      }
      if (toks[i] === "or" || toks[i] === ")") { ok = false; i++; continue; }
      out.push(readAtom());
    }
    return { ok, out };
  }

  const joinList = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

  // Consecutive ages collapse to a range ("aged 16 to 49"); anything else stays a list.
  function ageText(ages) {
    const a = [...ages].sort((x, y) => x - y);
    const run = a.every((v, k) => k === 0 || v === a[k - 1] + 1);
    return run && a.length > 2 ? `aged ${a[0]} to ${a[a.length - 1]}` : `aged ${joinList(a.map(String))}`;
  }

  /**
   * Render one trigger's condition lines. Returns { text, hidden, unknown } where `unknown` is
   * the raw text of every clause this reader does not know; `text` covers the rest.
   */
  function render(lines) {
    if (!lines || !lines.length) return { text: "", hidden: false, unknown: [] };
    const { ok, out } = clauses(lines);
    if (!ok) return { text: "", hidden: false, unknown: [lines.join(" ")] };
    const parts = []; const unknown = []; let hidden = false;
    for (const c of out) {
      if (!c.or) {
        const r = atom(c.words, c.neg);
        if (!r) { unknown.push(`${c.neg ? "not " : ""}${c.words.join(" ")}`); continue; }
        if (r.hidden) { hidden = true; continue; }
        parts.push(r.text);
        continue;
      }
      const rs = c.or.map((a) => atom(a.words, a.neg));
      if (rs.some((r) => !r)) { unknown.push(`( ${c.or.map((a) => `${a.neg ? "not " : ""}${a.words.join(" ")}`).join(" or ")} )`); continue; }
      if (rs.some((r) => r.hidden)) { hidden = true; continue; }
      if (rs.length === 1) { parts.push(rs[0].text); continue; }
      if (rs.every((r) => r.age != null)) { parts.push(ageText(rs.map((r) => r.age))); continue; }
      // "belongs to Rome, Carthage or Pontus" rather than the verb repeated per branch
      if (rs.every((r) => r.list && r.list[0] === rs[0].list[0])) {
        const head = rs[0].list[0];
        const names = uniqStr(rs.map((r) => r.list[1]));
        parts.push(head === "of the culture:" ? `of ${joinList(names)} culture` : `${head} ${joinList(names)}`);
        continue;
      }
      // branches can carry their own commas, so they are separated by "or" alone
      parts.push(`either ${rs.map((r) => r.text).join(" or ")}`);
    }
    return { text: parts.join(" · "), hidden, unknown };
  }
  const uniqStr = (a) => [...new Set(a)];

  return { render, factionName, cultureName, settlementName, buildingName };
}

module.exports = { makeConditionReader };
