import type { OmpModel, OmpProvider } from "@omp-switch/core";

export function modelLabel(providers: Array<[string, OmpProvider]>, providerId: string, modelId: string): OmpModel | undefined {
  return providers.find(([id]) => id === providerId)?.[1]?.models?.find((model) => model.id === modelId);
}
