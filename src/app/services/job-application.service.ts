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
  matchScore?: number | null;
  scoreMessage?: string | null;
};

export type ApplicationScoreResult = {
  applicationId: number;
  matchScore: number;
  skillScore: number;
  experienceScore: number;
  educationScore: number;
  candidateYears: number;
  matchedSkills: string[];
  missingSkills: string[];
  recommendation: string;
  skillsNotConfigured: boolean;
  expNotConfigured: boolean;
  eduNotConfigured: boolean;
  warnings: string[];
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
  matchScore?: number | null;
};

export type AllApplicationDto = {
  id: number;
  candidateId: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
  jobId: number;
  resumeId?: number | null;
  resumeFilePath?: string | null;
  resumeDisplayName?: string | null;
  jobTitle: string;
  companyName: string;
  status: string;
  appliedAt: string;
  matchScore?: number | null;
  skillScore?: number | null;
  experienceScore?: number | null;
  educationScore?: number | null;
};

export type ExtractedEducation = {
  degree?: string | null; fieldOfStudy?: string | null;
  university?: string | null; startYear?: number | null; endYear?: number | null;
};

export type ExtractedExperience = {
  companyName?: string | null; jobTitle?: string | null;
  startDate?: string | null; endDate?: string | null;
  durationInMonths?: number | null;
};

export type ExtractedData = {
  skills: string[];
  education: ExtractedEducation[];
  experiences: ExtractedExperience[];
};

export type JobDetailPayload = {
  jobId: number; jobTitle: string; description: string;
  employmentType?: string | null; experienceLevel?: string | null;
  experienceRequired?: string | null; educationRequirement?: string | null;
  minSalary?: number | null; maxSalary?: number | null;
  location?: string | null; workMode?: string | null;
  isRemote?: boolean; numberOfOpenings?: number;
  applicationDeadline?: string | null; status?: string;
  createdAt?: string; isActive?: boolean;
  companyName?: string | null; companyIndustry?: string | null;
  companyEmail?: string | null; companyWebsite?: string | null;
  companyAddress?: string | null; companyProfilePicture?: string | null;
  requiredSkills?: string[] | null;
  interviewStages?: { id: number; stageName: string; orderIndex: number }[] | null;
};

export type ApplicationDetailStaff = {
  application: {
    id: number; jobId: number; resumeId: number | null;
    status: string; appliedAt: string; coverNote: string | null;
    matchScore?: number | null; skillScore?: number | null;
    experienceScore?: number | null; educationScore?: number | null;
  };
  candidate: {
    candidateId: string; name: string | null; email: string | null;
  };
  resume: {
    resumeId: number; originalFileName: string | null;
    filePath: string; fileType: string; uploadedAt: string;
  } | null;
  job: JobDetailPayload | null;
  extractedData: ExtractedData;
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
    matchScore?: number | null;
    skillScore?: number | null;
    experienceScore?: number | null;
    educationScore?: number | null;
  };
  resume: ApplicationDetailResume | null;
  job: JobDetailPayload | null;
  extractedData: ExtractedData;
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
    })(),
    matchScore: pickOptNum(o, 'matchScore', 'MatchScore')
  };
}

function normalizeAllApplicationRow(raw: unknown): AllApplicationDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = pickNum(o, 'id', 'Id');
  if (!Number.isFinite(id)) return null;
  return {
    id,
    candidateId: pickStr(o, 'candidateId', 'CandidateId'),
    candidateName: (() => { const v = o['candidateName'] ?? o['CandidateName']; return v == null ? null : String(v); })(),
    candidateEmail: (() => { const v = o['candidateEmail'] ?? o['CandidateEmail']; return v == null ? null : String(v); })(),
    jobId: pickNum(o, 'jobId', 'JobId'),
    resumeId: pickOptNum(o, 'resumeId', 'ResumeId'),
    resumeFilePath: (() => { const v = o['resumeFilePath'] ?? o['ResumeFilePath']; return v == null || v === '' ? null : String(v); })(),
    resumeDisplayName: (() => { const v = o['resumeDisplayName'] ?? o['ResumeDisplayName']; return v == null || v === '' ? null : String(v); })(),
    jobTitle: pickStr(o, 'jobTitle', 'JobTitle'),
    companyName: pickStr(o, 'companyName', 'CompanyName'),
    status: pickStr(o, 'status', 'Status'),
    appliedAt: pickStr(o, 'appliedAt', 'AppliedAt'),
    matchScore: pickOptNum(o, 'matchScore', 'MatchScore'),
    skillScore: pickOptNum(o, 'skillScore', 'SkillScore'),
    experienceScore: pickOptNum(o, 'experienceScore', 'ExperienceScore'),
    educationScore: pickOptNum(o, 'educationScore', 'EducationScore')
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

  /** Triggers (re-)scoring for an existing application and returns the score breakdown. */
  getApplicationScore(applicationId: number): Observable<ApplicationScoreResult> {
    return this.http
      .post<ApplicationScoreResult>(`${this.apiUrl}/applications/${applicationId}/score`, {}, {
        headers: this.getAuthHeaders()
      });
  }

  /** For Recruiter / HrManager / Interviewer – all applications */
  getAllApplications(): Observable<AllApplicationDto[]> {
    return this.http
      .get<unknown[]>(`${this.apiUrl}/applications`, { headers: this.getAuthHeaders() })
      .pipe(
        map(rows => rows.map(normalizeAllApplicationRow).filter((r): r is AllApplicationDto => r !== null)),
        catchError(() => throwError(() => new Error('Failed to load applications')))
      );
  }

  /** Full detail for staff roles */
  getApplicationDetail(applicationId: number): Observable<ApplicationDetailStaff> {
    return this.http
      .get<ApplicationDetailStaff>(`${this.apiUrl}/applications/${applicationId}/detail`, {
        headers: this.getAuthHeaders()
      });
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

  /** Unified detail: for candidates uses my-detail endpoint, for staff uses detail endpoint */
  getAnyApplicationDetail(applicationId: number, isStaff: boolean): Observable<ApplicationDetailStaff> {
    if (isStaff) {
      return this.getApplicationDetail(applicationId);
    }
    return this.getMyApplicationDetail(applicationId).pipe(
      map(r => ({
        application: {
          id: r.application.id,
          jobId: r.application.jobId,
          resumeId: r.application.resumeId,
          status: r.application.status,
          appliedAt: r.application.appliedAt,
          coverNote: r.application.coverNote,
          matchScore: r.application.matchScore,
          skillScore: r.application.skillScore,
          experienceScore: r.application.experienceScore,
          educationScore: r.application.educationScore
        },
        candidate: { candidateId: '', name: null, email: null },
        resume: r.resume ? {
          resumeId: r.resume.resumeId,
          originalFileName: r.resume.originalFileName,
          filePath: r.resume.filePath,
          fileType: r.resume.fileType,
          uploadedAt: r.resume.uploadedAt
        } : null,
        job: r.job,
        extractedData: r.extractedData ?? { skills: [], education: [], experiences: [] }
      } as ApplicationDetailStaff))
    );
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
