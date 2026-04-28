import { Injectable, signal, inject } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HttpTransportType } from '@microsoft/signalr';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

type InterviewAssignedPayload = {
  id?: number;
  jobApplicationId?: number;
  scheduledDateTime?: string;
  message?: string;
};

@Injectable({
  providedIn: 'root'
})
export class InterviewNotificationHubService {
  private readonly session = inject(SessionCookieService);
  private connection: HubConnection | null = null;
  private starting = false;

  /** Shown in the root layout when the hub pushes InterviewAssigned. */
  readonly toastMessage = signal<string | null>(null);

  startIfAuthenticated(): void {
    if (!this.session.hasToken() || this.starting) {
      return;
    }
    if (this.connection?.state === 'Connected') {
      return;
    }

    this.starting = true;
    const hubUrl = this.resolveHubUrl();
    this.connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => this.session.getToken() ?? '',
        transport: HttpTransportType.WebSockets | HttpTransportType.ServerSentEvents
      })
      .withAutomaticReconnect()
      .build();

    this.connection.on('InterviewAssigned', (payload: InterviewAssignedPayload) => {
      const text =
        payload?.message ??
        'You have been assigned as interviewer for a scheduled interview.';
      this.toastMessage.set(text);
      window.setTimeout(() => {
        if (this.toastMessage() === text) {
          this.toastMessage.set(null);
        }
      }, 12000);
    });

    void this.connection
      .start()
      .then(() => {
        this.starting = false;
      })
      .catch(() => {
        this.starting = false;
        this.connection = null;
      });
  }

  dismissToast(): void {
    this.toastMessage.set(null);
  }

  stop(): void {
    const conn = this.connection;
    this.connection = null;
    this.starting = false;
    if (conn?.state === 'Connected' || conn?.state === 'Connecting' || conn?.state === 'Reconnecting') {
      void conn.stop();
    }
  }

  private resolveHubUrl(): string {
    const path = environment.interviewHubUrl.trim();
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const base = window.location.origin;
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalized}`;
  }
}
