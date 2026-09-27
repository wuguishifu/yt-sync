import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type AppEventType = 'status' | 'playlists';

export interface AppEvent {
  type: AppEventType;
  data: unknown;
}

/** In-process bus for state changes pushed to the web UI over SSE. */
@Injectable()
export class EventsService {
  private readonly events = new Subject<AppEvent>();
  readonly stream: Observable<AppEvent> = this.events.asObservable();

  emit(type: AppEventType, data: unknown): void {
    this.events.next({ type, data });
  }
}
