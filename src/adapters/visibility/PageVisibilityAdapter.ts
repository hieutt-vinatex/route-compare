/**
 * Page Visibility + Page Lifecycle (RT-103, ADR-06).
 * Emits deduplicated visible/hidden transitions from visibilitychange, pagehide/pageshow
 * (bfcache) and freeze/resume. Does not rely on beforeunload to save data.
 */
import type { Unsubscribe, VisibilityAdapter } from '@/domain/ports';

export class PageVisibilityAdapter implements VisibilityAdapter {
  private readonly doc: Document;
  private readonly win: Window;

  constructor(doc: Document = document, win: Window = window) {
    this.doc = doc;
    this.win = win;
  }

  isVisible(): boolean {
    return this.doc.visibilityState === 'visible';
  }

  subscribe(listener: (visible: boolean) => void): Unsubscribe {
    let last = this.isVisible();
    const emit = (visible: boolean): void => {
      if (visible === last) return;
      last = visible;
      listener(visible);
    };
    const onVisibility = (): void => {
      emit(this.isVisible());
    };
    const onHidden = (): void => {
      emit(false);
    };

    this.doc.addEventListener('visibilitychange', onVisibility);
    this.doc.addEventListener('freeze', onHidden);
    this.doc.addEventListener('resume', onVisibility);
    this.win.addEventListener('pagehide', onHidden);
    this.win.addEventListener('pageshow', onVisibility);

    return () => {
      this.doc.removeEventListener('visibilitychange', onVisibility);
      this.doc.removeEventListener('freeze', onHidden);
      this.doc.removeEventListener('resume', onVisibility);
      this.win.removeEventListener('pagehide', onHidden);
      this.win.removeEventListener('pageshow', onVisibility);
    };
  }
}
