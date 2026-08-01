export interface GeneratedAssetPreloadQueueOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

export function runGeneratedAssetPreloadQueue<Job, Result>(
  jobs: readonly Job[],
  worker: (job: Job, index: number) => Result | PromiseLike<Result>,
  options?: GeneratedAssetPreloadQueueOptions,
): Promise<PromiseSettledResult<Result>[]>;
