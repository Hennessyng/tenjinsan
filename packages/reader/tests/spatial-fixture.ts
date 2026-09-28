import { PublicationProjection } from "@reading-studio/contracts"

// Independent content oracle: never import renderer presets or state enumerators.
export const perspectiveLegendInventory = [
  { index: 0, label: { en: "Near form", ja: "手前の形" } },
  { index: 1, label: { en: "Far form", ja: "奥の形" } },
] as const
export const spatialInventory = [
  {
    id: "front",
    label: { en: "Front: shared outline", ja: "正面：共通する輪郭" },
    explanation: {
      en: "Depth is hidden when the forms align.",
      ja: "形が重なると奥行きは見えません。",
    },
  },
  {
    id: "side",
    label: { en: "Side: distance matters", ja: "側面：距離の違い" },
    explanation: {
      en: "A second view separates the forms.",
      ja: "別の視点では形の間隔が見えます。",
    },
  },
  {
    id: "top",
    label: { en: "Above: relationships", ja: "上面：位置関係" },
    explanation: { en: "Look down to compare positions.", ja: "上から位置関係を比べます。" },
  },
  {
    id: "oblique",
    label: { en: "Oblique: the whole", ja: "斜め：全体を見る" },
    explanation: {
      en: "Combine height, width and depth.",
      ja: "高さ、幅、奥行きを合わせて見ます。",
    },
  },
] as const
export const layerInventory = [
  {
    id: "words",
    label: { en: "Spoken words", ja: "語られた言葉" },
    explanation: { en: "Start with what was said.", ja: "実際の言葉から始めます。" },
  },
  {
    id: "context",
    label: { en: "Surrounding context", ja: "周囲の状況" },
    explanation: { en: "Consider the setting.", ja: "その場の状況を考えます。" },
  },
  {
    id: "interpretation",
    label: { en: "Our interpretation", ja: "自分の解釈" },
    explanation: { en: "Keep inference distinct.", ja: "推測を区別します。" },
  },
] as const
export const spatialLesson = PublicationProjection.parse({
  title: { en: "One model, several views", ja: "一つのモデル、複数の視点" },
  sections: [
    {
      id: "views",
      heading: { en: "Compare before concluding", ja: "結論の前に比べる" },
      content: {
        en: "These are illustrative models, not measurements.",
        ja: "これは説明用のモデルであり、測定結果ではありません。",
      },
      practice: [],
      sourceNotes: [],
      scenes: [
        {
          id: "perspective",
          kind: "perspective-3d",
          title: { en: "Perspective comparison", ja: "視点の比較" },
          viewpoints: spatialInventory,
          practice: [],
        },
        {
          id: "spatial",
          kind: "spatial-layers-3d",
          title: { en: "Layers of understanding", ja: "理解の層" },
          viewpoints: spatialInventory,
          layers: layerInventory,
          practice: [],
        },
      ],
    },
  ],
  assets: [],
})
