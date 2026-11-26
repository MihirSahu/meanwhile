import { createHash } from "node:crypto";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { loadBuffer } from "cheerio";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";
import type { EvidencePassage } from "../evidence-schema";
import type { EvidenceSource, ResearchBundle } from "./scene-provider";

export type SourceDocument = {
  text: string;
  finalUrl: string;
  documentHash: string;
  retrievedAt: string;
};
export type SourceReader = (
  url: string,
  signal: AbortSignal,
) => Promise<SourceDocument>;
export type SourceCheck = {
  sourceId: string;
  status: "readable" | "unavailable";
  reason: string | null;
  finalUrl: string | null;
  documentHash: string | null;
  retrievedAt: string;
};
export const normalizeSourceText = (text: string) =>
  text.replace(/\s+/g, " ").trim();
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function sourceUrl(raw: string) {
  const url = new URL(raw),
    host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    host === "localhost" ||
    /\.(?:localhost|local|internal|test|invalid)$/.test(host) ||
    (!host.includes(".") && !isIP(host)) ||
    (isIP(host) && !publicAddress(host))
  )
    throw new Error("blocked_address");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("utm_") || ["gclid", "fbclid"].includes(key))
      url.searchParams.delete(key);
  return url;
}
// Resolve and validate inside the socket lookup: no DNS-check/fetch race.
const dispatcher = new Agent({
  maxOrigins: 64,
  connections: 2,
  connect: {
    lookup(host, options, callback) {
      lookup(host, { all: true, verbatim: true }, (error, addresses) => {
        const done = callback as (...args: any[]) => void;
        if (
          error ||
          !addresses.length ||
          addresses.some((item) => !publicAddress(item.address))
        ) {
          done(new Error("blocked_address"));
          return;
        }
        if (options.all) done(null, addresses);
        else done(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});
export function extractSourceText(bytes: Uint8Array, contentType: string) {
  if (/^text\/plain\b/i.test(contentType))
    return normalizeSourceText(new TextDecoder().decode(bytes));
  if (!/^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType))
    throw new Error("unsupported_document");
  const $ = loadBuffer(Buffer.from(bytes));
  $(
    "script,style,noscript,nav,header,footer,form,svg,aside,.sidebar,.menu,.navigation,[role=navigation],[aria-hidden=true]",
  ).remove();
  $("br,p,div,li,h1,h2,h3,h4,section,article,tr").append(" ");
  const main = $(
    "main,article,[role=main],#main-content,.region-content,.entry-content",
  ).first();
  return normalizeSourceText((main.length ? main : $("body")).text());
}
export async function readSourceDocument(
  raw: string,
  signal: AbortSignal,
): Promise<SourceDocument> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(9000)]);
  let url = sourceUrl(raw);
  for (let redirects = 0; redirects <= 3; redirects++) {
    deadline.throwIfAborted();
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: deadline,
      dispatcher,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain",
        "User-Agent": "Meanwhile/0.1 (historical source verification)",
      },
    } as RequestInit & { dispatcher: Agent });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("redirect_limit");
      url = sourceUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("source_unavailable");
    }
    if (
      !/^(?:text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      await response.body.cancel();
      throw new Error("unsupported_document");
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1_500_000) throw new Error("document_too_large");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const text = extractSourceText(
      Buffer.concat(chunks),
      response.headers.get("content-type") ?? "",
    );
    if (
      text.length < 160 ||
      /^(?:access denied|just a moment|verify you are human)/i.test(text)
    )
      throw new Error("unreadable_document");
    const normalized = text.slice(0, 160_000);
    return {
      text: normalized,
      finalUrl: url.href,
      documentHash: createHash("sha256").update(normalized).digest("hex"),
      retrievedAt: new Date().toISOString(),
    };
  }
  throw new Error("redirect_limit");
}
/** Select intact sentence windows; offsets always address the saved normalized document. */
export function selectPassages(
  document: SourceDocument,
  sourceId: string,
  query: string,
): Omit<EvidencePassage, "id">[] {
  const tokens = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []),
  ].filter(
    (word) =>
      !/^(?:show|scene|historical|history|story|about|sources|source|schematic|chapter|evidence|research|requested)$/.test(
        word,
      ),
  );
  const candidates: { start: number; end: number; score: number }[] = [];
  for (const match of document.text.matchAll(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)) {
    const start = match.index!,
      sentence = match[0];
    for (let offset = 0; offset < sentence.length; offset += 1000) {
      const limit = Math.min(start + offset + 1100, document.text.length);
      const sentenceBoundary = Math.max(
        document.text.lastIndexOf(". ", limit),
        document.text.lastIndexOf("? ", limit),
        document.text.lastIndexOf("! ", limit),
      );
      const boundary =
        sentenceBoundary >= start + offset + 200
          ? sentenceBoundary + 1
          : document.text.lastIndexOf(" ", limit);
      const end =
          limit === document.text.length
            ? limit
            : Math.max(start + offset + 50, boundary),
        text = document.text.slice(start + offset, end),
        lower = text.toLowerCase();
      if (text.trim().length < 50) continue;
      candidates.push({
        start: start + offset,
        end,
        score:
          tokens.reduce(
            (score, word) =>
              score + (lower.includes(word) ? (/\d/.test(word) ? 4 : 1) : 0),
            0,
          ) + (/\b\d{3,4}\b/.test(text) ? 1 : 0),
      });
    }
  }
  const selected: typeof candidates = [];
  for (const candidate of candidates.sort(
    (a, b) => b.score - a.score || a.start - b.start,
  )) {
    if (
      selected.some(
        (other) =>
          Math.max(
            0,
            Math.min(candidate.end, other.end) -
              Math.max(candidate.start, other.start),
          ) >
          0.25 *
            Math.min(candidate.end - candidate.start, other.end - other.start),
      )
    )
      continue;
    selected.push(candidate);
    if (selected.length === 5) break;
  }
  selected.sort((a, b) => a.start - b.start);
  return selected.map(({ start, end }) => ({
    sourceId,
    text: document.text.slice(start, end),
    start,
    end,
    documentHash: document.documentHash,
    retrievedAt: document.retrievedAt,
  }));
}

/** Reserve excerpt space for the core parts of an overview, rather than
 * letting one repeated phase in the brief occupy every available window. */
export function selectCoveragePassages(document: SourceDocument, sourceId: string, query: string, brief: string) {
  const primary = selectPassages(document, sourceId, `${query} ${brief.slice(0, 6000)}`);
  const pools = [primary, ...[
    "origin cause background grievance purpose",
    "leader leadership commander government participant",
    "development milestone campaign battle reform journey stage",
    "outcome defeat victory armistice settlement treaty return aftermath",
  ].map((facet) => {
    const score = (text: string) => facet.split(" ").reduce((sum, word) =>
      sum + Number(text.toLowerCase().includes(word)), 0);
    return selectPassages(document, sourceId, `${query} ${facet}`)
      .sort((a, b) => score(b.text) - score(a.text) || a.start - b.start);
  })];
  const selected: typeof primary = [];
  // Different facets can need adjacent sentences sharing introductory context.
  // Reject near-duplicates, without excluding a cause/battle merely because
  // its window overlaps a neighboring leadership passage.
  const distinct = (candidate: typeof primary[number]) => !selected.some((other) =>
    Math.max(0, Math.min(candidate.end, other.end) - Math.max(candidate.start, other.start)) >
      0.8 * Math.min(candidate.end - candidate.start, other.end - other.start),
  );
  for (const pool of pools) {
    const next = pool.find(distinct);
    if (next) selected.push(next);
  }
  for (const candidate of primary) {
    if (selected.length === 5) break;
    if (distinct(candidate)) selected.push(candidate);
  }
  return selected.sort((a, b) => a.start - b.start);
}
export async function retrieveResearchPassages(
  brief: ResearchBundle,
  query: string,
  signal: AbortSignal,
  reader: SourceReader = readSourceDocument,
  focused = false,
): Promise<ResearchBundle> {
  const passages: EvidencePassage[] = [],
    sourceChecks: SourceCheck[] = [];
  // Bound source concurrency while keeping ID assignment deterministic.
  const results: (SourceDocument | Error)[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, brief.sources.length) }, async () => {
      while (next < brief.sources.length) {
        const index = next++;
        try {
          results[index] = await reader(brief.sources[index].url, signal);
        } catch (error) {
          signal.throwIfAborted();
          results[index] =
            error instanceof Error ? error : new Error("source_unavailable");
        }
      }
    }),
  );
  for (const [index, source] of brief.sources.entries()) {
    const result = results[index];
    if (result instanceof Error) {
      sourceChecks.push({
        sourceId: source.id,
        status: "unavailable",
        reason:
          /^(?:blocked_address|unsupported_document|redirect_limit|document_too_large|unreadable_document)$/.test(
            result.message,
          )
            ? result.message
            : "source_unavailable",
        finalUrl: null,
        documentHash: null,
        retrievedAt: new Date().toISOString(),
      });
      continue;
    }
    const selected = focused ? selectPassages(result, source.id, query)
      : selectCoveragePassages(result, source.id, query, brief.text);
    sourceChecks.push({
      sourceId: source.id,
      status: selected.length ? "readable" : "unavailable",
      reason: selected.length ? null : "unreadable_document",
      finalUrl: result.finalUrl,
      documentHash: result.documentHash,
      retrievedAt: result.retrievedAt,
    });
    for (const passage of selected)
      passages.push({ id: `p${passages.length + 1}`, ...passage });
  }
  return { ...brief, passages, sourceChecks };
}
