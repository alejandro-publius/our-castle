// Original 90-colour palette built around the existing Tiny Castle material family.
const anchors = [
  "536979",
  "B7C2CB",
  "DDBA79",
  "EDDCB4",
  "9D3E46",
  "355F93",
  "527557",
  "86A56C",
  "BF8569",
  "777099",
];
const shades = [-0.83, -0.65, -0.45, -0.23, 0, 0.18, 0.36, 0.57, 0.78];
export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
export function srgbToOKLab([red, green, blue]) {
  const r = srgbToLinear(red),
    g = srgbToLinear(green),
    b = srgbToLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export const PALETTE = Object.freeze(
  anchors.flatMap((hex) => {
    const rgb = [0, 2, 4].map((offset) =>
      parseInt(hex.slice(offset, offset + 2), 16),
    );
    return shades.map((shade) =>
      Object.freeze(
        rgb.map(
          (v) =>
            Math.round(shade < 0 ? v * (1 + shade) : v + (255 - v) * shade) /
            255,
        ),
      ),
    );
  }),
);
export const PALETTE_LAB = Object.freeze(
  PALETTE.map((rgb) => Object.freeze(srgbToOKLab(rgb))),
);
