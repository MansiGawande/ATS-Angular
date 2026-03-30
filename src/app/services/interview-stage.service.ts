import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

export type InterviewStageDto = {
  id: number;
  companyId: number;
  stageName: string;
  orderIndex: number;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
};

export type SaveInterviewStageRequest = {
  stageName: string;
  orderIndex: number;
  isActive: boolean;
};

@Injectable({
  providedIn: 'root'
})
export class InterviewStageService {
  private readonly apiUrl = environment.apiUrl;
  private endpointAvailable: boolean | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly sessionCookieService: SessionCookieService
  ) {}

  getStages(): Observable<InterviewStageDto[]> {
    if (this.endpointAvailable === false) {
      return of([]);
    }
    return this.http
      .get<InterviewStageDto[]>(`${this.apiUrl}/interview-stages`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status === 404) {
            this.endpointAvailable = false;
            return of([]);
          }
          return throwError(() => error);
        })
      );
  }

  createStage(payload: SaveInterviewStageRequest): Observable<InterviewStageDto> {
    if (this.endpointAvailable === false) {
      return throwError(() => new Error('Interview Stages API is not available on backend.'));
    }
    return this.http
      .post<InterviewStageDto>(`${this.apiUrl}/interview-stages`, payload, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status === 404) {
            this.endpointAvailable = false;
            return throwError(() => new Error('Interview Stages API is not available on backend.'));
          }
          return throwError(() => error);
        })
      );
  }

  updateStage(stageId: number, payload: SaveInterviewStageRequest): Observable<InterviewStageDto> {
    if (this.endpointAvailable === false) {
      return throwError(() => new Error('Interview Stages API is not available on backend.'));
    }
    return this.http
      .put<InterviewStageDto>(`${this.apiUrl}/interview-stages/${stageId}`, payload, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status === 404) {
            this.endpointAvailable = false;
            return throwError(() => new Error('Interview Stages API is not available on backend.'));
          }
          return throwError(() => error);
        })
      );
  }

  updateStatus(stageId: number, isActive: boolean): Observable<InterviewStageDto> {
    if (this.endpointAvailable === false) {
      return throwError(() => new Error('Interview Stages API is not available on backend.'));
    }
    return this.http
      .patch<InterviewStageDto>(
        `${this.apiUrl}/interview-stages/${stageId}/status`,
        { isActive },
        { headers: this.getAuthHeaders() }
      )
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status === 404) {
            this.endpointAvailable = false;
            return throwError(() => new Error('Interview Stages API is not available on backend.'));
          }
          return throwError(() => error);
        })
      );
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
