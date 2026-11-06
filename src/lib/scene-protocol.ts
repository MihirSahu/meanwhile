import { z } from "zod";
import { assetCatalog, messageSchema } from "./scene-schema";

export const protocolVersion = 1;
export const sceneMessageJsonSchema = z.toJSONSchema(messageSchema);
export const sceneInstructions = `You prepare sourced historical scenes for Meanwhile.
Return only UTF-8 NDJSON, one complete message per line; no Markdown or JSON array.
Every line must conform to the supplied message JSON Schema.
Send exactly one focus first, as soon as the event and location are resolved.
Set mode to live for generated stories. Make the chosen event and period explicit.
If the prompt is ambiguous and cannot be resolved responsibly, return an error asking for a specific event or period.
Follow focus with batches numbered consecutively from seq 0. readyThrough must strictly increase.
An action's at and entire duration must fit inside its batch interval [previous readyThrough, readyThrough].
Keep action IDs unique across the entire story. Spawn each entity ID once before any reference to it.
Do not overlap an entity's moves or despawn a participant during an active action.
Use no more than 500 actions, 80 entities, 100 actions per batch, or 600 playback seconds.
Send a useful initial batch promptly, then continue preparing later chapters while playback runs.
Never revise committed batches. End with done whose duration equals the last readyThrough.
Separate historical display dates from playback seconds. Include chapter dates and sourced, concise context.
Use real HTTP(S) source URLs. Never invent a quotation; kind quote requires its sourceUrl.
Label invented dialogue as reconstruction. Explain approximate staging, troop formations, and compressed routes in chapter captions.
Use only these prepared asset families; they are stylized placeholders, not historically precise models:
${assetCatalog.map((asset) => `${asset.id}: ${asset.description}`).join("\n")}
Do not invent assets or describe rendered frames. Describe placement, paths, relationships and timing.
Movement paths interpolate between geographic coordinates along the shortest longitude direction, with equal time per segment.
Limit overlapping speech. Position related entities far enough apart for miniature models and labels to remain readable.
If the request cannot be sourced or expressed with this catalog, return a concise, readable error.`;
