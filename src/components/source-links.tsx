import type { SceneFocus } from "@/lib/scene-schema";

export function SourceLinks({
  sources,
  ids,
  fallback = false,
}: {
  sources: SceneFocus["sources"];
  ids?: string[];
  fallback?: boolean;
}) {
  const selected = sources
    .map((source, index) => ({ ...source, index }))
    .filter((source) =>
      ids ? Boolean(source.id && ids.includes(source.id)) : fallback,
    );
  if (!selected.length) return null;
  return (
    <span className="source-citations" aria-label="Supporting sources">
      {selected.map((source) => (
        <a
          key={source.url}
          style={{ pointerEvents: "auto" }}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          title={source.title}
          aria-label={`Source ${source.index + 1}: ${source.title}`}
        >
          [{source.index + 1}]
        </a>
      ))}
    </span>
  );
}
