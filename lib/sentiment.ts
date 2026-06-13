export function calculateSentiment(
  proScore: number,
  youtubeScore: number
) {
  const score =
    proScore * 0.6 +
    youtubeScore * 0.4;

  const probability = score / 100;

  return Number(probability.toFixed(3));
}