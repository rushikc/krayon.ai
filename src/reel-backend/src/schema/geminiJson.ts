/** Gemini responseSchema (uppercase types). Object roots only. */

const timeProperties = {
  type: "OBJECT",
  properties: {
    start: { type: "NUMBER" },
    end: { type: "NUMBER" },
    track: { type: "INTEGER" },
  },
  required: ["start", "end", "track"],
};

const colorEnum = [
  "ink",
  "violet",
  "green",
  "blue",
  "sky",
  "lavender",
  "mint",
  "tan",
  "yellow",
  "orange",
  "pink",
  "salmon",
];

const boxItem = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING" },
    type: { type: "STRING", enum: ["box"] },
    matrix: { type: "ARRAY", items: { type: "INTEGER" }, minItems: 4, maxItems: 4 },
    label: { type: "STRING" },
    sublabel: { type: "STRING" },
    fontSize: { type: "NUMBER" },
    colorTheme: { type: "STRING", enum: colorEnum },
    time: timeProperties,
  },
  required: ["id", "type", "matrix", "label", "colorTheme", "time"],
};

const numberItem = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING" },
    type: { type: "STRING", enum: ["number"] },
    matrix: { type: "ARRAY", items: { type: "NUMBER" }, minItems: 2, maxItems: 4 },
    size: { type: "NUMBER" },
    value: { type: "NUMBER" },
    colorTheme: { type: "STRING", enum: colorEnum },
    time: timeProperties,
  },
  required: ["id", "type", "matrix", "value", "colorTheme", "time"],
};

const arrowItem = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING" },
    type: { type: "STRING", enum: ["arrow"] },
    sourceId: { type: "STRING" },
    targetId: { type: "STRING" },
    variant: { type: "STRING", enum: ["solid", "dashed"] },
    time: timeProperties,
  },
  required: ["id", "type", "sourceId", "targetId", "time"],
};

export const sceneResponseSchema = {
  type: "OBJECT",
  properties: {
    elements: {
      type: "ARRAY",
      items: {
        anyOf: [boxItem, numberItem, arrowItem],
      },
    },
  },
  required: ["elements"],
};

export const reviewResponseSchema = {
  type: "OBJECT",
  properties: {
    clarity: { type: "NUMBER" },
    readability: { type: "NUMBER" },
    accuracy: { type: "NUMBER" },
    issues: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          problem: { type: "STRING" },
          severity: { type: "STRING", enum: ["low", "medium", "high"] },
          frameIndex: { type: "INTEGER" },
        },
        required: ["problem", "severity"],
      },
    },
  },
  required: ["clarity", "readability", "accuracy", "issues"],
};
