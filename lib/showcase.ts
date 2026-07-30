export type ShowcasePage = {
  label: string;
  narration?: string;
  dialogue?: string;
  position: "top" | "middle" | "bottom";
  bubbleSide: "left" | "right";
};

export type ShowcaseStory = {
  slug: string;
  title: string;
  kicker: string;
  status: "Public-domain classic" | "PanelForge original";
  image: string;
  description: string;
  genres: string[];
  palette: string;
  pages: ShowcasePage[];
};

export const showcaseStories: ShowcaseStory[] = [
  {
    slug: "journey-to-the-west",
    title: "Journey to the West",
    kicker: "The gate above the clouds",
    status: "Public-domain classic",
    image: "/library/journey-west-strip.webp",
    description:
      "A mythic preview of the Monkey King carrying his challenge to Heaven’s own doorstep.",
    genres: ["Mythic adventure", "Action", "Fantasy"],
    palette: "#43d9d0",
    pages: [
      {
        label: "The cloud road",
        narration:
          "At the edge of Heaven, even thunder stepped aside for the Monkey King.",
        position: "top",
        bubbleSide: "right",
      },
      {
        label: "The golden staff",
        dialogue: "One staff. One gate. Let us see which bends first.",
        position: "middle",
        bubbleSide: "left",
      },
      {
        label: "Heaven answers",
        narration:
          "The guards descended before his grin had time to fade.",
        position: "bottom",
        bubbleSide: "right",
      },
    ],
  },
  {
    slug: "romance-of-the-three-kingdoms",
    title: "Romance of the Three Kingdoms",
    kicker: "Before the river fortress",
    status: "Public-domain classic",
    image: "/library/three-kingdoms-strip.webp",
    description:
      "Strategy, sworn brotherhood, and a dawn march toward a fortress that could decide an age.",
    genres: ["Historical epic", "Strategy", "War"],
    palette: "#ff9f64",
    pages: [
      {
        label: "The river line",
        narration:
          "By sunrise, ten thousand banners had gathered before the river wall.",
        position: "top",
        bubbleSide: "left",
      },
      {
        label: "The first move",
        dialogue:
          "A map is only a battlefield that has not begun to bleed.",
        position: "middle",
        bubbleSide: "right",
      },
      {
        label: "The oath rides",
        narration:
          "Three riders waited for the signal—and for history to remember their names.",
        position: "bottom",
        bubbleSide: "left",
      },
    ],
  },
  {
    slug: "water-margin",
    title: "Water Margin",
    kicker: "Lanterns in the marsh",
    status: "Public-domain classic",
    image: "/library/water-margin-strip.webp",
    description:
      "Outlaws cross a rain-black marsh to choose whether tonight ends in brotherhood or betrayal.",
    genres: ["Outlaw saga", "Action", "Drama"],
    palette: "#53b9d7",
    pages: [
      {
        label: "Liangshan in rain",
        narration:
          "The marsh swallowed every sound except oars, rain, and men refusing to kneel.",
        position: "top",
        bubbleSide: "right",
      },
      {
        label: "Steel and wine",
        dialogue: "Drink after the gates open. Draw steel until they do.",
        position: "middle",
        bubbleSide: "left",
      },
      {
        label: "The signal",
        narration:
          "One raised hand turned a hundred fugitives into a single force.",
        position: "bottom",
        bubbleSide: "right",
      },
    ],
  },
  {
    slug: "the-immortals-ledger",
    title: "The Immortal’s Ledger",
    kicker: "A PanelForge original",
    status: "PanelForge original",
    image: "/library/immortals-ledger-strip.webp",
    description:
      "A cultivation archivist discovers a jade book that records every ascension—and every erased name.",
    genres: ["Cultivation", "Mystery", "Dark fantasy"],
    palette: "#93a8ff",
    pages: [
      {
        label: "The hanging archive",
        narration:
          "The forbidden library had no floor, only shelves suspended over moonlit nothing.",
        position: "top",
        bubbleSide: "right",
      },
      {
        label: "An unwritten fate",
        dialogue: "Blank jade does not mean an empty destiny.",
        position: "middle",
        bubbleSide: "left",
      },
      {
        label: "The sealed name",
        narration:
          "When the ledger opened, something ancient opened its eyes with it.",
        position: "bottom",
        bubbleSide: "right",
      },
    ],
  },
];

export function getShowcaseStory(slug: string) {
  return showcaseStories.find((story) => story.slug === slug);
}
