// descr_strat tokens every parser must read the same way (2026-09-21).
//
// The engine takes a settlement's region as ONE whitespace-delimited token.
// RIS has 133 hyphenated regions (Paelignia-Marsica, Qart-Khadasht…); a parser
// that spells the token \w+ cuts them at the hyphen, the lookup keyed by the
// full name misses, and nothing errors — Carthage lost its treasury that way in
// the Python suite (0.16.20) and Army Setup lost the recruit pool of every
// hyphenated settlement here. Use these; do not re-spell the pattern.
"use strict";

// Matches a (possibly indented) `region <Name>` line; group 1 is the name.
const REGION_LINE_RE = /^\s*region\s+(\S+)/;

module.exports = { REGION_LINE_RE };
