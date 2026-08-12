export class BoundedWorkScheduler {
  private activeCount = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Scheduler concurrency must be a positive integer");
    }
  }

  run<TValue>(work: () => Promise<TValue>): Promise<TValue> {
    return new Promise<TValue>((resolve, reject) => {
      this.queue.push(() => {
        this.activeCount += 1;
        void work()
          .then(resolve, reject)
          .finally(() => {
            this.activeCount -= 1;
            this.drain();
          });
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.activeCount < this.concurrency) {
      const start = this.queue.shift();
      if (!start) {
        return;
      }
      start();
    }
  }
}
