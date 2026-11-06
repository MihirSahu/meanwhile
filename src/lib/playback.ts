import { checkedClaimLedger, type EvidenceClaim } from "./evidence-schema";
import {
  actionEnd,
  messageSchema,
  type Geo,
  type SceneAction,
  type SceneFocus,
  type SpawnAction,
} from "./scene-schema";

/** The event log is authoritative. Animation libraries never own its clock. */
export class SceneBuffer {
  focus: SceneFocus | null = null;
  actions: SceneAction[] = [];
  readyThrough = 0;
  complete = false;
  evidenceClaims: EvidenceClaim[] = [];
  private sequence = 0;

  ingest(input: unknown) {
    const message = messageSchema.parse(input);
    if (message.type === "error") throw new Error(message.message);
    if (this.complete) throw new Error("The scene is already complete.");
    if (message.type === "focus") {
      if (this.focus) throw new Error("A scene can have only one focus.");
      const sourceIds = message.sources.flatMap((source) =>
        source.id ? [source.id] : [],
      );
      if (new Set(sourceIds).size !== sourceIds.length)
        throw new Error("Source IDs must be unique.");
      if (message.evidence)
        this.evidenceClaims = checkedClaimLedger(
          [],
          message.evidence.claims,
          message.evidence.passages,
          sourceIds,
        );
      this.focus = message;
      return;
    }
    if (!this.focus)
      throw new Error("The first message must set the scene focus.");
    if (message.type === "done") {
      if (message.duration === 0 || message.duration !== this.readyThrough)
        throw new Error(
          "The final duration must match a nonempty committed timeline.",
        );
      this.complete = true;
      return;
    }
    if (message.seq !== this.sequence)
      throw new Error("An action batch is missing or duplicated.");
    if (message.readyThrough <= this.readyThrough)
      throw new Error("The ready boundary must advance.");
    if (message.evidence && !this.focus.evidence)
      throw new Error("Batch claims need a focus passage registry.");
    const ledger = this.focus.evidence
      ? checkedClaimLedger(
          this.evidenceClaims,
          message.evidence?.claims ?? [],
          this.focus.evidence.passages,
          this.focus.sources.flatMap((s) => (s.id ? [s.id] : [])),
        )
      : this.evidenceClaims;
    const added = [...message.actions].sort((a, b) => a.at - b.at);
    const combined = [...this.actions, ...added];
    if (combined.length > 500)
      throw new Error("This scene has too many actions.");
    const ids = new Set(this.actions.map((action) => action.id));
    const spawns = new Map<string, SpawnAction>(
      this.actions
        .filter((a): a is SpawnAction => a.type === "spawn")
        .map((a) => [a.entityId, a]),
    );
    const despawns = new Set(
      this.actions.filter((a) => a.type === "despawn").map((a) => a.entityId),
    );
    for (const action of added) {
      if (
        action.claimIds?.length &&
        (!this.focus.evidence ||
          action.claimIds.some((id) => !ledger.some((c) => c.id === id)))
      )
        throw new Error("An action references an unavailable evidence claim.");
      if (
        this.focus.evidence &&
        (action.type === "chapter" ||
          (action.type === "speech" && action.kind === "narration"))
      ) {
        if (!action.claimIds?.length)
          throw new Error("Factual actions need evidence claim IDs.");
        const passageIds = new Set(
          ledger
            .filter((c) => action.claimIds!.includes(c.id))
            .flatMap((c) => c.passageIds),
        );
        const sources = [
          ...new Set(
            this.focus.evidence.passages
              .filter((p) => passageIds.has(p.id))
              .map((p) => p.sourceId),
          ),
        ];
        if (
          !action.sourceIds ||
          sources.length !== action.sourceIds.length ||
          sources.some((id) => !action.sourceIds!.includes(id))
        )
          throw new Error(
            "Citations must match the supporting claim passages.",
          );
      }
      if (ids.has(action.id)) throw new Error("Action IDs must be unique.");
      ids.add(action.id);
      if (
        "sourceIds" in action &&
        action.sourceIds?.some(
          (id) => !this.focus!.sources.some((source) => source.id === id),
        )
      )
        throw new Error("An action references an unavailable source.");
      if (
        action.at < this.readyThrough ||
        action.at >= message.readyThrough ||
        actionEnd(action) > message.readyThrough
      )
        throw new Error("An action crosses a committed batch boundary.");
      if (action.type === "spawn") {
        if (spawns.has(action.entityId))
          throw new Error("An entity cannot be spawned twice.");
        spawns.set(action.entityId, action);
        if (spawns.size > 80)
          throw new Error("This scene has too many entities.");
      } else if ("entityId" in action) {
        if (!spawns.has(action.entityId) || despawns.has(action.entityId))
          throw new Error("An action references an unavailable entity.");
        if (
          action.type === "attack" &&
          (!spawns.has(action.targetId) || despawns.has(action.targetId))
        )
          throw new Error("The attack target is unavailable.");
        if (
          action.type === "speech" &&
          action.kind === "quote" &&
          !action.sourceUrl
        )
          throw new Error("A quotation needs a source.");
        if (
          action.type === "move" &&
          combined.some(
            (other) =>
              other !== action &&
              other.type === "move" &&
              other.entityId === action.entityId &&
              other.at < actionEnd(action) &&
              action.at < actionEnd(other),
          )
        )
          throw new Error("An entity has overlapping movement actions.");
        if (action.type === "despawn") {
          if (
            combined.some(
              (other) =>
                other.at <= action.at &&
                actionEnd(other) > action.at &&
                "entityId" in other &&
                (other.entityId === action.entityId ||
                  (other.type === "attack" &&
                    other.targetId === action.entityId)),
            )
          )
            throw new Error(
              "An entity cannot despawn during an active action.",
            );
          despawns.add(action.entityId);
        }
      }
    }
    this.evidenceClaims = ledger;
    this.actions = combined;
    this.readyThrough = message.readyThrough;
    this.sequence++;
  }
}

export function advanceClock(
  current: number,
  delta: number,
  speed: number,
  readyThrough: number,
) {
  return Math.min(
    readyThrough,
    current + Math.min(Math.max(delta, 0), 0.1) * speed,
  );
}

export function chapterAt(actions: SceneAction[], time: number) {
  return actions
    .filter(
      (a): a is Extract<SceneAction, { type: "chapter" }> =>
        a.type === "chapter" && a.at <= time,
    )
    .at(-1);
}

export function entityVisible(
  actions: SceneAction[],
  spawn: SpawnAction,
  time: number,
) {
  return (
    time >= spawn.at &&
    !actions.some(
      (a) =>
        a.type === "despawn" && a.entityId === spawn.entityId && a.at <= time,
    )
  );
}

/** Shared by entities and effects so seeking never depends on tween history. */
export function positionAt(
  actions: SceneAction[],
  spawn: SpawnAction,
  time: number,
): Geo {
  let position = spawn.position;
  for (const action of actions) {
    if (
      action.type !== "move" ||
      action.entityId !== spawn.entityId ||
      action.at > time
    )
      continue;
    const progress =
      Math.min(1, (time - action.at) / action.duration) *
      (action.path.length - 1);
    const index = Math.min(Math.floor(progress), action.path.length - 2);
    const from = action.path[index],
      to = action.path[index + 1],
      fraction = progress - index;
    const lonDelta = ((to.lon - from.lon + 540) % 360) - 180;
    position = {
      lat: from.lat + (to.lat - from.lat) * fraction,
      lon: ((from.lon + lonDelta * fraction + 540) % 360) - 180,
    };
  }
  return position;
}
