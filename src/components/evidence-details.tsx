"use client";
import type { SceneBuffer } from "@/lib/playback";
export function EvidenceDetails({
  buffer,
  claimIds,
}: {
  buffer: SceneBuffer;
  claimIds?: string[];
}) {
  const evidence = buffer.focus?.evidence;
  if (!evidence) return null;
  const claims = claimIds?.length
    ? buffer.evidenceClaims.filter((claim) => claimIds.includes(claim.id))
    : buffer.evidenceClaims;
  return (
    <details className="evidence-details">
      <summary>Supporting passages</summary>
      <p>
        Automatic checks compare the story with saved source passages.
        Historical interpretation may still need review.
      </p>
      {claims.map((claim) => (
        <section key={claim.id}>
          <p>
            <strong>{claim.text}</strong>
            {claim.certainty !== "established" && (
              <small> · {claim.certainty}</small>
            )}
          </p>
          {claim.passageIds.map((id) => {
            const passage = evidence.passages.find((p) => p.id === id);
            const source = buffer.focus!.sources.find(
              (s) => s.id === passage?.sourceId,
            );
            return passage && source ? (
              <blockquote key={id}>
                <p>{passage.text}</p>
                <cite>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title} ↗
                  </a>
                </cite>
              </blockquote>
            ) : null;
          })}
        </section>
      ))}
    </details>
  );
}
