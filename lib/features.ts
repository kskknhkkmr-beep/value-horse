export function calculatePTrue(horse: {
  formScore: number;
  pedigreeScore: number;
  trainingScore: number;
  jockeyScore: number;
}) {
  const score =
    horse.formScore * 0.4 +
    horse.pedigreeScore * 0.2 +
    horse.trainingScore * 0.2 +
    horse.jockeyScore * 0.2;

  const probability = score / 100;

  return Number(probability.toFixed(3));
}