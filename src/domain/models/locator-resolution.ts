export interface LocatorMatch<T> {
  readonly selector: string;
  readonly matches: readonly T[];
}

export type LocatorResolutionKind = "zero-match" | "ambiguous";

export class LocatorResolutionError extends Error {
  constructor(
    readonly diagnostic: {
      readonly kind: LocatorResolutionKind;
      readonly candidates: readonly string[];
      readonly matches: Readonly<Record<string, number>>;
    },
  ) {
    super(`locator resolution ${diagnostic.kind}: ${diagnostic.candidates.join(", ")}`);
    this.name = "LocatorResolutionError";
  }
}

// A semantic locator can have several discovery candidates. Keep their order deterministic and
// include the reviewed legacy selector last, so old storyboards remain usable without allowing a
// first-match DOM fallback.
export function orderedLocatorCandidates(
  candidates: readonly string[] | undefined,
  legacySelector: string,
): string[] {
  return [...new Set([...(candidates ?? []), legacySelector])].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export function resolveExactlyOne<T>(matches: readonly LocatorMatch<T>[]): { selector: string; value: T } {
  const counts = Object.fromEntries(matches.map(({ selector, matches: values }) => [selector, values.length]));
  const ambiguous = matches.find(({ matches: values }) => values.length > 1);
  if (ambiguous) {
    throw new LocatorResolutionError({
      kind: "ambiguous",
      candidates: matches.map(({ selector }) => selector),
      matches: counts,
    });
  }
  const resolved = matches.filter(({ matches: values }) => values.length === 1);
  const targets = new Set(resolved.map(({ matches: values }) => values[0]));
  if (targets.size > 1) {
    throw new LocatorResolutionError({ kind: "ambiguous", candidates: matches.map(({ selector }) => selector), matches: counts });
  }
  if (!resolved[0] || !resolved[0].matches[0]) {
    throw new LocatorResolutionError({
      kind: "zero-match",
      candidates: matches.map(({ selector }) => selector),
      matches: counts,
    });
  }
  return { selector: resolved[0].selector, value: resolved[0].matches[0] };
}
