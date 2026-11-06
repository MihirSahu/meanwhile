/** Only catch requests with no event identity. Specific names/dates go to research. */
export function historicalClarification(prompt: string): string | null {
  const words = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const subject = words.replace(
    /^(?:(?:please|can|could|would|you|show|tell|me|about|explain|describe|visualize)\s+)+/,
    "",
  );
  const event =
    /^(?:(?:the|a|that|this) )?(civil war|war|revolution|battle|event|journey)$/.exec(
      subject,
    )?.[1];
  if (event)
    return `Which ${event} and historical period would you like to explore?`;
  if (
    /\b(?:there|here|then|that time|this time|that place)\b/.test(subject) &&
    /^(?:(?:what|was|happening|happened|there|here|then|at|in|during|that|this|the|time|place|moment)\s*)+$/.test(
      subject,
    )
  )
    return "Which place, event and historical period would you like to explore?";
  return null;
}
