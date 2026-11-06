import type {
  Geo,
  SceneAction,
  SceneFocus,
  SceneMessage,
} from "./scene-schema";

export const demos = [
  {
    prompt: "The First Sino-Japanese War",
    label: "Sino-Japanese War",
    period: "1894–1895",
    region: "East Asia",
    icon: "flag",
  },
  {
    prompt: "Trade along the Silk Road",
    label: "The Silk Road",
    period: "c. 1300",
    region: "Across Eurasia",
    icon: "route",
  },
];

const warSource =
  "https://www.britannica.com/event/First-Sino-Japanese-War-1894-1895";
const treatySource = "https://www.jacar.go.jp/english/jacarbl-fsjwar-e/";
const silkSource = "https://en.unesco.org/silkroad/about-silk-roads";
const geo = (lat: number, lon: number): Geo => ({ lat, lon });

export function makeDemo(prompt: string): SceneMessage[] {
  const silk = /\bsilk[\s-]*roads?\b/i.test(prompt);
  if (!silk && !/\bsino[\s-]*japanese\b/i.test(prompt)) {
    throw new Error(
      "This demo includes the First Sino-Japanese War and the Silk Road. Try either story, or connect a scene provider for other prompts.",
    );
  }
  if (!silk && /1937|second/i.test(prompt))
    throw new Error(
      "The demo covers the First Sino-Japanese War (1894–1895). The second war needs a connected scene provider.",
    );
  const focus: SceneFocus = silk
    ? {
        type: "focus",
        title: "Trade along the Silk Road",
        period: "c. 1300",
        location: "Across Eurasia",
        center: geo(36, 77),
        distance: 5.4,
        sources: [{ title: "UNESCO · About the Silk Roads", url: silkSource }],
        mode: "demo",
      }
    : {
        type: "focus",
        title: "The First Sino-Japanese War",
        period: "1894–1895",
        location: "China, Korea & Japan",
        center: geo(36, 127),
        distance: 4.2,
        sources: [
          { title: "Encyclopaedia Britannica", url: warSource },
          { title: "British Library / JACAR archives", url: treatySource },
        ],
        mode: "demo",
      };
  let n = 0;
  const id = () => `a${n++}`;
  const spawn = (
    at: number,
    entityId: string,
    asset: Extract<SceneAction, { type: "spawn" }>["asset"],
    position: Geo,
    palette: "clay" | "indigo" | "sage" | "gold",
    label: string,
    scale = 1,
  ): SceneAction => ({
    type: "spawn",
    id: id(),
    at,
    entityId,
    asset,
    position,
    palette,
    label,
    scale,
  });
  const chapter = (
    at: number,
    date: string,
    title: string,
    caption: string,
  ): SceneAction => ({ type: "chapter", id: id(), at, date, title, caption });
  const move = (
    at: number,
    entityId: string,
    path: Geo[],
    duration: number,
  ): SceneAction => ({ type: "move", id: id(), at, entityId, path, duration });
  const speech = (
    at: number,
    entityId: string,
    text: string,
    duration: number,
    kind: "narration" | "reconstruction" = "narration",
  ): SceneAction => ({
    type: "speech",
    id: id(),
    at,
    entityId,
    text,
    duration,
    kind,
  });
  const batch = (
    seq: number,
    readyThrough: number,
    actions: SceneAction[],
  ): SceneMessage => ({ type: "batch", seq, readyThrough, actions });
  if (silk)
    return [
      focus,
      batch(0, 10, [
        chapter(
          0,
          "c. 1300",
          "A world connected by trade",
          "The Silk Roads were a network of routes. This representative journey illustrates exchange, rather than a documented single expedition.",
        ),
        spawn(0, "xian", "city", geo(34.3, 108.9), "clay", "Chang’an / Xi’an"),
        spawn(1, "samarkand", "city", geo(39.7, 67), "gold", "Samarkand"),
        spawn(2, "istanbul", "city", geo(41, 29), "sage", "Constantinople"),
        spawn(
          3,
          "merchant",
          "horse",
          geo(34.3, 108.9),
          "clay",
          "A traveling merchant",
          1.5,
        ),
        speech(
          4,
          "merchant",
          "Our journey carries goods, stories, and ideas between distant cities.",
          5,
          "reconstruction",
        ),
      ]),
      batch(1, 24, [
        chapter(
          10,
          "A representative journey",
          "Across mountains and deserts",
          "Caravans traveled in stages. Goods often changed hands many times before reaching their final destination.",
        ),
        move(
          10,
          "merchant",
          [geo(34.3, 108.9), geo(36.1, 103.8), geo(40.1, 94.7), geo(39.5, 76)],
          14,
        ),
      ]),
      batch(2, 38, [
        chapter(
          24,
          "Central Asia",
          "A meeting place of cultures",
          "Oasis cities linked regional trading networks. Exchange included skills, beliefs, and technologies as well as merchandise.",
        ),
        move(24, "merchant", [geo(39.5, 76), geo(40, 72), geo(39.7, 67)], 10),
        speech(
          28,
          "samarkand",
          "A crossroads for travelers and goods from many regions.",
          8,
        ),
      ]),
      batch(3, 54, [
        chapter(
          38,
          "Westward connections",
          "Routes become a network",
          "No single road connected every place. The animated path is a schematic illustration of wider connections across Eurasia.",
        ),
        move(
          38,
          "merchant",
          [
            geo(39.7, 67),
            geo(37.6, 61.8),
            geo(35.7, 51.4),
            geo(38.4, 42),
            geo(41, 29),
          ],
          16,
        ),
      ]),
      batch(4, 64, [
        chapter(
          54,
          "Across Eurasia",
          "More than a journey",
          "Trade connected distant communities over centuries. Replay the route, or ask about another moment in history.",
        ),
        speech(
          55,
          "merchant",
          "The goods continue onward. So do the stories.",
          8,
          "reconstruction",
        ),
      ]),
      { type: "done", duration: 64 },
    ];
  return [
    focus,
    batch(0, 12, [
      chapter(
        0,
        "Summer 1894",
        "Two powers, one peninsula",
        "Rival influence in Korea brings Qing China and Japan into conflict. The figures and routes are schematic, not exact troop positions.",
      ),
      spawn(0, "seoul", "city", geo(37.6, 127), "sage", "Seoul"),
      spawn(0.5, "qing", "infantry", geo(39.5, 125.2), "clay", "Qing forces"),
      spawn(
        1.2,
        "japan",
        "infantry",
        geo(35.7, 129.2),
        "indigo",
        "Japanese forces",
      ),
      spawn(
        2,
        "qing-guns",
        "cannon",
        geo(40, 123.8),
        "clay",
        "Field artillery",
      ),
      spawn(2.5, "port", "city", geo(34, 130.9), "gold", "Shimonoseki"),
      speech(
        4,
        "seoul",
        "Korea is at the center of a struggle for regional influence.",
        7,
      ),
    ]),
    batch(1, 25, [
      chapter(
        12,
        "August–September 1894",
        "War on land",
        "Japan’s army advances in Korea. The animation compresses the campaign into a few representative movements.",
      ),
      move(
        12,
        "japan",
        [geo(35.7, 129.2), geo(37.1, 127.3), geo(38.6, 125.7)],
        10,
      ),
      {
        type: "attack",
        id: id(),
        at: 22,
        entityId: "japan",
        targetId: "qing",
        duration: 3,
      },
    ]),
    batch(2, 40, [
      chapter(
        25,
        "September 1894",
        "The war moves to sea",
        "A major naval battle near the mouth of the Yalu River helps establish Japanese naval superiority.",
      ),
      spawn(
        25,
        "beiyang",
        "steamship",
        geo(38.4, 122.5),
        "clay",
        "Beiyang Fleet",
        1.3,
      ),
      spawn(
        26,
        "fleet",
        "steamship",
        geo(35.5, 125),
        "indigo",
        "Japanese fleet",
        1.3,
      ),
      move(27, "fleet", [geo(35.5, 125), geo(37.6, 124)], 7),
      {
        type: "attack",
        id: id(),
        at: 34,
        entityId: "fleet",
        targetId: "beiyang",
        duration: 5,
      },
      move(35, "qing", [geo(39.5, 125.2), geo(40.2, 123.6)], 5),
    ]),
    batch(3, 52, [
      chapter(
        40,
        "Late 1894–early 1895",
        "The balance shifts",
        "Japanese victories on land and sea place mounting pressure on Qing China. Peace negotiations follow.",
      ),
      move(
        40,
        "japan",
        [geo(38.6, 125.7), geo(40.1, 124.4), geo(39.3, 121.6)],
        10,
      ),
      speech(
        43,
        "qing",
        "The campaign has shifted from Korea toward Chinese territory.",
        8,
      ),
    ]),
    batch(4, 66, [
      chapter(
        52,
        "April 1895",
        "At the negotiating table",
        "Li Hongzhang and Itō Hirobumi are central figures in the peace negotiations at Shimonoseki. These are narrated summaries, not quotations.",
      ),
      spawn(52, "li", "officer", geo(33.7, 130.3), "clay", "Li Hongzhang", 1.6),
      spawn(
        53,
        "ito",
        "officer",
        geo(34.3, 131.5),
        "indigo",
        "Itō Hirobumi",
        1.6,
      ),
      speech(
        55,
        "li",
        "Li Hongzhang represents Qing China in the peace negotiations.",
        5,
      ),
      speech(
        61,
        "ito",
        "Itō Hirobumi represents Japan in the negotiations.",
        5,
      ),
    ]),
    batch(5, 76, [
      chapter(
        66,
        "17 April 1895",
        "A new regional order",
        "The Treaty of Shimonoseki ends the war. China recognizes Korea’s independence and cedes Taiwan and other territories; later intervention changes some terms.",
      ),
      speech(
        67,
        "port",
        "The treaty ends the war, with consequences that extend well beyond this moment.",
        8,
      ),
    ]),
    { type: "done", duration: 76 },
  ];
}
