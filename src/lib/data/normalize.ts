// Name normalisation for franchises and venues so history joins across renames.

const TEAM_ALIASES: Record<string, string> = {
  "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
  "Delhi Daredevils": "Delhi Capitals",
  "Kings XI Punjab": "Punjab Kings",
  "Rising Pune Supergiants": "Rising Pune Supergiant",
};

export function canonicalTeam(name: string): string {
  return TEAM_ALIASES[name] ?? name;
}

const TEAM_ABBR: Record<string, string> = {
  "Chennai Super Kings": "CSK",
  "Mumbai Indians": "MI",
  "Royal Challengers Bengaluru": "RCB",
  "Kolkata Knight Riders": "KKR",
  "Delhi Capitals": "DC",
  "Punjab Kings": "PBKS",
  "Rajasthan Royals": "RR",
  "Sunrisers Hyderabad": "SRH",
  "Gujarat Titans": "GT",
  "Lucknow Super Giants": "LSG",
  "Deccan Chargers": "DCG",
  "Pune Warriors": "PWI",
  "Gujarat Lions": "GL",
  "Rising Pune Supergiant": "RPS",
  "Kochi Tuskers Kerala": "KTK",
  "Gujarat Giants": "GG",
  "UP Warriorz": "UPW",
};

export function teamAbbr(name: string): string {
  const c = canonicalTeam(name);
  return (
    TEAM_ABBR[c] ??
    c
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 4)
  );
}

const VENUE_ALIASES: Record<string, string> = {
  "punjab cricket association is bindra stadium": "punjab cricket association stadium",
  "feroz shah kotla": "arun jaitley stadium",
  "sardar patel stadium": "narendra modi stadium",
  "m chinnaswamy stadium": "m chinnaswamy stadium",
  "mchinnaswamy stadium": "m chinnaswamy stadium",
  "dr dy patil sports academy": "dy patil stadium",
  "brabourne stadium": "brabourne stadium",
  "rajiv gandhi international stadium": "rajiv gandhi intl stadium",
  "rajiv gandhi intl cricket stadium": "rajiv gandhi intl stadium",
  "maharashtra cricket association stadium": "mca stadium pune",
  "subrata roy sahara stadium": "mca stadium pune",
  "bharat ratna shri atal bihari vajpayee ekana cricket stadium": "ekana stadium",
  "eden gardens": "eden gardens",
  "wankhede stadium": "wankhede stadium",
  "ma chidambaram stadium": "ma chidambaram stadium",
};

/** Canonical venue key: text before the first comma, lower-case, punctuation removed, then aliases. */
export function venueKey(venue: string): string {
  const base = venue
    .split(",")[0]
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\bstadium\b/, "stadium")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^ma chidambaram stadium chepauk.*/, "ma chidambaram stadium");
  return VENUE_ALIASES[base] ?? base;
}
