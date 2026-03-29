/**
 * Generic undo stack with clone-on-push semantics.
 *
 * Stores deep clones of state snapshots. Popped snapshots are returned
 * directly (no re-cloning) since they are already detached.
 */
export class UndoStack<T> {
  private stack: T[] = [];

  /** Push a deep clone of the given state onto the stack. */
  push(state: T): void {
    this.stack.push(structuredClone(state));
  }

  /** Pop and return the most recent snapshot, or undefined if empty. */
  pop(): T | undefined {
    return this.stack.pop();
  }

  /** Remove all snapshots. */
  clear(): void {
    this.stack.length = 0;
  }

  get length(): number {
    return this.stack.length;
  }
}
