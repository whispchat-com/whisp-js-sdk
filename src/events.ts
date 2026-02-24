/**
 * Minimal typed EventEmitter. No external dependencies.
 */
export class TypedEventEmitter<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<(data: never) => void>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (data: never) => void);

    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe a specific handler from an event.
   */
  off<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): void {
    this.listeners.get(event)?.delete(handler as (data: never) => void);
  }

  /**
   * Emit an event to all registered handlers.
   */
  protected emit<K extends keyof EventMap>(
    event: K,
    ...args: EventMap[K] extends void ? [] : [EventMap[K]]
  ): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (data: EventMap[K]) => void)(args[0] as EventMap[K]);
      } catch (err) {
        console.error(`[Whisp] Error in "${String(event)}" handler:`, err);
      }
    }
  }

  /**
   * Remove all listeners, optionally for a specific event.
   */
  removeAllListeners(event?: keyof EventMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
