/**
 * A call with a second one alongside if the first is slow (or fails): the
 * first answer counts. For the short model calls people wait on (the
 * assassin discussion, the lobby): one hung call shouldn't hold the table.
 */
export function hedged<T>(call: () => Promise<T>, afterMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    let started = 0;
    let failed = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      started += 1;
      call().then(
        (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          failed += 1;
          if (done || failed < started) return;
          if (started < 2) go();
          else {
            done = true;
            clearTimeout(timer);
            reject(err);
          }
        }
      );
    };
    go();
    timer = setTimeout(() => {
      if (!done && started < 2) go();
    }, afterMs);
  });
}
