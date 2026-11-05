// FFmpeg's AVRational stores two signed 32-bit integers. Their magnitudes
// are not the frame rate: 51234569/1707819 is a valid value near 30 fps.
export const rationalMax = 2_147_483_647;
export function parseFrameRate(
  value: unknown,
): { num: number; den: number } | null {
  if (typeof value !== "string" || !/^\d+\/\d+$/.test(value)) return null;
  const [num, den] = value.split("/").map(Number);
  if (
    ![num, den].every(
      (v) => Number.isSafeInteger(v) && v > 0 && v <= rationalMax,
    )
  )
    return null;
  let a = num,
    b = den;
  while (b !== 0) [a, b] = [b, a % b];
  return { num: num / a, den: den / a };
}
