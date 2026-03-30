import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

export type ApplyJobRequest = {
  jobId: number;
  resumeId?: number | null;
  coverNote?: string | null;
};

export type ApplyJobResponse = {
  id: number;
  jobId: number;
  resumeId?: number | null;
  status: string;
  appliedAt: string;
};

export type MyApplicationDto = {
  id: number;
  jobId: number;
  resumeId?: number | null;
  resumeFilePath?: string | null;
  jobTitle: string;
  companyName: string;
  status: string;
  appliedAt: string;
  coverNote: string | null;
};

@Injectable({
  providedIn: 'root'
})
export class JobApplicationService {
  private readonly apiUrl = environment.apiUrl;

  constructor(
    private readonly http: HttpClient,
    private readonly sessionCookieService: SessionCookieService
  ) {}

  applyJob(jobId: number, coverNote?: string | null, resumeId?: number | null): Observable<ApplyJobResponse> {
    const payload: ApplyJobRequest = { jobId, coverNote: coverNote ?? null, resumeId: resumeId ?? null };
    return this.http
      .post<ApplyJobResponse>(`${this.apiUrl}/applications`, payload, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status !== 404) {
            return throwError(() => error);
          }
          return this.http.post<ApplyJobResponse>(`${this.apiUrl}/job-applications`, payload, {
            headers: this.getAuthHeaders()
          });
        })
      );
  }

  getMyApplications(): Observable<MyApplicationDto[]> {
    return this.http
      .get<MyApplicationDto[]>(`${this.apiUrl}/applications/my`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status !== 404) {
            return throwError(() => error);
          }
          return this.http.get<MyApplicationDto[]>(`${this.apiUrl}/job-applications/my`, {
            headers: this.getAuthHeaders()
          });
        }),
        catchError(() => of([]))
      );
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
