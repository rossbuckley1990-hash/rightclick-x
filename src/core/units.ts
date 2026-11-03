// A finite dimensional vocabulary, not a natural-language truth detector.
// Inferred/declared units constrain routing; only an independent observation
// establishes that the provider actually implements those semantics.
export const UNITS = {
  kg: { dimension: "mass", aliases: ["kg", "kilogram", "kilograms"] },
  lb: { dimension: "mass", aliases: ["lb", "lbs", "pound", "pounds"] },
  m: { dimension: "length", aliases: ["m", "meter", "meters", "metre", "metres"] },
  ft: { dimension: "length", aliases: ["ft", "foot", "feet"] },
  l: { dimension: "volume", aliases: ["l", "liter", "liters", "litre", "litres"] },
  gal: { dimension: "volume", aliases: ["gal", "gallon", "gallons"] }, // US/imperial is unresolved
  celsius: { dimension: "temperature", aliases: ["c", "celsius"] },
  fahrenheit: { dimension: "temperature", aliases: ["f", "fahrenheit"] },
  kelvin: { dimension: "temperature", aliases: ["k", "kelvin"] },
  s: { dimension: "duration", aliases: ["s", "seconds", "second"] },
  ms: { dimension: "duration", aliases: ["ms", "milliseconds", "millisecond"] },
  mb: { dimension: "storage", aliases: ["mb", "megabyte", "megabytes"] },
  mib: { dimension: "storage", aliases: ["mib", "mebibyte", "mebibytes"] },
  kmh: { dimension: "speed", aliases: ["kmh", "kph"] },
  mph: { dimension: "speed", aliases: ["mph"] },
  percent: { dimension: "ratio", aliases: ["percent", "percentage", "pct"] },
  bps: { dimension: "ratio", aliases: ["bps"] },
} as const;

export function unitType(unit: keyof typeof UNITS): string {
  return `quantity:${UNITS[unit].dimension}:${unit}`;
}

export function knownUnitType(type: string): boolean {
  return Object.keys(UNITS).some(unit => unit !== "gal" && unitType(unit as keyof typeof UNITS) === type);
}

/** Name tokens preserve declarations, never certify them or guess conversions. */
export function inferUnitType(name: string, description = ""): string | undefined {
  const tokenize = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const named = tokenize(name);
  const declared = tokenize(description);
  const units = Object.entries(UNITS).filter(([, u]) => u.aliases.some(a => named.includes(a) || (a.length > 2 && declared.includes(a))));
  if (units.length) {
    const dimensions = new Set(units.map(([, u]) => u.dimension));
    if (units.length !== 1) return `quantity:${dimensions.size === 1 ? units[0][1].dimension : "unknown"}:unknown`;
    return unitType(units[0][0] as keyof typeof UNITS);
  }
  // A gross/net basis is consequential even when currency and scale are absent.
  if (named.includes("gross") || named.includes("net")) return "quantity:money:unknown:unknown";
  return undefined;
}

export interface SemanticEvidence {
  type: string;
  provenance: "caller" | "declared" | "inferred" | "independently-observed";
  /** Independent observation identifier, not provider prose. */
  observation?: string;
}

export function establishedSemantics(evidence: SemanticEvidence): boolean {
  return evidence.provenance === "independently-observed" && typeof evidence.observation === "string" && evidence.observation.length > 0;
}
