import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
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
  resumeDisplayName?: string | null;
  jobTitle: string;
  companyName: string;
  status: string;
  appliedAt: string;
  coverNote: string | null;
};

export type ApplicationDetailResume = {
  resumeId: number;
  originalFileName: string | null;
  filePath: string;
  fileType: string;
  uploadedAt: string;
  parsed: boolean;
  isActive: boolean;
};

export type ApplicationDetailResponse = {
  application: {
    id: number;
    jobId: number;
    resumeId: number | null;
    status: string;
    appliedAt: string;
    coverNote: string | null;
  };
  resume: ApplicationDetailResume | null;
};

function pickStr(o: Record<string, unknown>, c: string, p: string): string {
  const v = o[c] ?? o[p];
  return typeof v === 'string' ? v : String(v ?? '');
}

function pickNum(o: Record<string, unknown>, c: string, p: string): number {
  const v = o[c] ?? o[p];
  return typeof v === 'number' ? v : Number(v);
}

function pickOptNum(o: Record<string, unknown>, c: string, p: string): number | null {
  const v = o[c] ?? o[p];
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeApplicationRow(raw: unknown): MyApplicationDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = pickNum(o, 'id', 'Id');
  if (!Number.isFinite(id)) return null;
  return {
    id,
    jobId: pickNum(o, 'jobId', 'JobId'),
    resumeId: pickOptNum(o, 'resumeId', 'ResumeId'),
    resumeFilePath: (() => {
      const v = o['resumeFilePath'] ?? o['ResumeFilePath'];
      return v == null || v === '' ? null : String(v);
    })(),
    resumeDisplayName: (() => {
      const v = o['resumeDisplayName'] ?? o['ResumeDisplayName'];
      return v == null || v === '' ? null : String(v);
    })(),
    jobTitle: pickStr(o, 'jobTitle', 'JobTitle'),
    companyName: pickStr(o, 'companyName', 'CompanyName'),
    status: pickStr(o, 'status', 'Status'),
    appliedAt: pickStr(o, 'appliedAt', 'AppliedAt'),
    coverNote: (() => {
      const v = o['coverNote'] ?? o['CoverNote'];
      return v == null ? null : String(v);
    })()
  };
}

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
      .get<unknown[]>(`${this.apiUrl}/applications/my`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        map((rows) => rows.map(normalizeApplicationRow).filter((r): r is MyApplicationDto => r !== null)),
        catchError((error: { status?: number }) => {
          if (error?.status !== 404) {
            return throwError(() => error);   // propagate to component error handler
          }
          // 404 → try legacy endpoint
          return this.http
            .get<unknown[]>(`${this.apiUrl}/job-applications/my`, {
              headers: this.getAuthHeaders()
            })
            .pipe(map((rows) => rows.map(normalizeApplicationRow).filter((r): r is MyApplicationDto => r !== null)));
        })
      );
  }

  getMyApplicationDetail(applicationId: number): Observable<ApplicationDetailResponse> {
    return this.http
      .get<ApplicationDetailResponse>(`${this.apiUrl}/applications/my/${applicationId}/detail`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status !== 404) {
            return throwError(() => error);
          }
          return this.http.get<ApplicationDetailResponse>(`${this.apiUrl}/job-applications/my/${applicationId}/detail`, {
            headers: this.getAuthHeaders()
          });
        })
      );
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
