/**
 * @template Job, Result
 * @param {readonly Job[]} jobs
 * @param {(job: Job, index: number) => Result | PromiseLike<Result>} worker
 * @param {{ concurrency?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<PromiseSettledResult<Result>[]>}
 */
export async function runGeneratedAssetPreloadQueue(
  jobs,
  worker,
  options = {},
) {
  const { concurrency = 2, signal } = options;
  const limit = Math.max(1, Math.floor(concurrency));
  const completed = new Array(jobs.length);
  const results = [];
  let nextIndex = 0;
  let nextCommitIndex = 0;

  const run = async () => {
    while (nextIndex < jobs.length && !signal?.aborted) {
      const index = nextIndex++;
      try {
        completed[index] = { status: 'fulfilled', value: await worker(jobs[index], index) };
      } catch (reason) {
        completed[index] = { status: 'rejected', reason };
      }
      if (signal?.aborted) continue;
      while (completed[nextCommitIndex]) {
        results.push(completed[nextCommitIndex++]);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, run));
  return results;
}
