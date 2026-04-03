import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

/** Absolute URL to the file served by the backend static-files middleware */
export function getResumeFileUrl(filePath: string): string {
  const origin = (environment.backendOriginUrl ?? '').replace(/\/$/, '');
  return `${origin}${filePath}`;
}

/** Human-readable label for UI (uses original upload name when available). */
export function resumeDisplayLabel(r: Pick<ResumeDto, 'originalFileName' | 'filePath' | 'fileType' | 'uploadedAt'>): string {
  const name = r.originalFileName?.trim();
  if (name) return name;
  const ext = (r.fileType || '').replace('.', '').toUpperCase();
  const when = r.uploadedAt ? new Date(r.uploadedAt).toLocaleString() : '';
  return `Resume${when ? ' — ' + when : ''}${ext ? ' (' + ext + ')' : ''}`;
}

export type ResumeDto = {
  resumeId: number;
  candidateId: string;
  filePath: string;
  fileType: string;
  originalFileName?: string | null;
  uploadedAt: string;
  parsed: boolean;
  isActive?: boolean;
  hasExtractedText?: boolean;
};

export type UploadResumeResponse = ResumeDto & {
  queueId?: number;
  queueStatus?: string;
};

function pickNum(o: Record<string, unknown>, camel: string, pascal: string): number {
  const v = o[camel] ?? o[pascal];
  return typeof v === 'number' ? v : Number(v);
}

function pickStr(o: Record<string, unknown>, camel: string, pascal: string): string {
  const v = o[camel] ?? o[pascal];
  return typeof v === 'string' ? v : String(v ?? '');
}

function pickBool(o: Record<string, unknown>, camel: string, pascal: string): boolean {
  const v = o[camel] ?? o[pascal];
  return Boolean(v);
}

function pickOptStr(o: Record<string, unknown>, camel: string, pascal: string): string | null {
  const v = o[camel] ?? o[pascal];
  if (v == null || v === '') return null;
  return String(v);
}

/** Normalize API row whether JSON uses camelCase or PascalCase */
function normalizeResumeRow(raw: unknown): ResumeDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const resumeId = pickNum(o, 'resumeId', 'ResumeId');
  if (!Number.isFinite(resumeId)) return null;
  const hasActive = o['isActive'] !== undefined || o['IsActive'] !== undefined;
  return {
    resumeId,
    candidateId: pickStr(o, 'candidateId', 'CandidateId'),
    filePath: pickStr(o, 'filePath', 'FilePath'),
    fileType: pickStr(o, 'fileType', 'FileType'),
    originalFileName: pickOptStr(o, 'originalFileName', 'OriginalFileName'),
    uploadedAt: pickStr(o, 'uploadedAt', 'UploadedAt'),
    parsed: pickBool(o, 'parsed', 'Parsed'),
    isActive: hasActive ? pickBool(o, 'isActive', 'IsActive') : true,
    hasExtractedText: pickBool(o, 'hasExtractedText', 'HasExtractedText')
  };
}

@Injectable({ providedIn: 'root' })
export class ResumeService {
  private readonly apiUrl = environment.apiUrl;


  constructor(
    private readonly http: HttpClient,
    private readonly sessionCookieService: SessionCookieService
  ) {}

  /** Upload a new resume (always inserts a new record — old resumes are kept) */
  uploadResume(file: File): Observable<UploadResumeResponse> {
    const formData = new FormData();
    formData.append('ResumeFile', file, file.name);
    return this.http.post<UploadResumeResponse>(`${this.apiUrl}/resumes/upload`, formData, {
      headers: this.getAuthHeaders()
    });
  }

  /** Get all resumes uploaded by the current candidate (newest first) */
  getMyResumes(): Observable<ResumeDto[]> {
    return this.http.get<unknown[]>(`${this.apiUrl}/resumes/my`, { headers: this.getAuthHeaders() }).pipe(
      map((rows) => rows.map(normalizeResumeRow).filter((r): r is ResumeDto => r !== null))
    );
  }

  setResumeActive(resumeId: number, isActive: boolean): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/resumes/${resumeId}/active`, { isActive }, { headers: this.getAuthHeaders() });
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
