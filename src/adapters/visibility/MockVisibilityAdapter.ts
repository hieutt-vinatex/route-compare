import type { Unsubscribe, VisibilityAdapter } from '@/domain/ports';

export class MockVisibilityAdapter implements VisibilityAdapter {
  private visible = true;
  private readonly listeners = new Set<(visible: boolean) => void>();

  isVisible(): boolean {
    return this.visible;
  }

  subscribe(listener: (visible: boolean) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const listener of this.listeners) listener(visible);
  }
}
