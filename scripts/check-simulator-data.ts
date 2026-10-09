/** Structural check only. Never runs a model, buying policy, settlement or metrics. */
import { loadDevelopment, prepareInput } from "./simulator/input";
const dataset = loadDevelopment();
let historyRowsDelivered = 0;
for (const race of dataset.races) {
  const input = prepareInput(race, dataset.historyByHorse);
  for (const horse of input.horses) {
    if (horse.history.some((r) => r.date >= input.date || r.netKeibaRaceId === input.raceId)) {
      throw new Error("Future/self history reached predictor input");
    }
    historyRowsDelivered += horse.history.length;
  }
}
console.log(JSON.stringify({ races: dataset.races.length,
  starts: dataset.races.reduce((n, r) => n + r.starters.length, 0),
  uniqueHorses: Object.keys(dataset.historyByHorse).length,
  historicalRowsAcrossTargetInputs: historyRowsDelivered,
  sourceHashes: dataset.sourceHashes, constraints: dataset.constraints,
  predictionExecuted: false, performanceComputed: false }, null, 2));
