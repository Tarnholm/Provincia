// Convert engine-internal character names to their in-game display form.
//
// descr_strat uses trailing uppercase letters (B, C, D...) to disambiguate
// when multiple characters share a first name — e.g. `AntigonosB` is the
// engine's ID for the second Antigonos. In-game the family tree shows
// "Antigonos II". Strip the suffix and convert to a roman numeral.

const ROMAN_FOR_SUFFIX = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function displayFirstName(firstName) {
  if (!firstName) return "?";
  const m = /^(.+?[a-z])([A-Z])$/.exec(firstName);
  if (!m) return firstName;
  const numeral = ROMAN_FOR_SUFFIX[m[2].charCodeAt(0) - "A".charCodeAt(0)] || m[2];
  return m[1] + " " + numeral;
}

// Format a character's full display name: roman-numeral firstName + lastName
// (underscores → spaces).
export function displayFullName(firstName, lastName) {
  const fn = displayFirstName(firstName);
  const ln = lastName ? " " + String(lastName).replace(/_/g, " ") : "";
  return fn + ln;
}
