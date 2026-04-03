import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

export type JobDto = {
  jobId: number;
  companyId: number;
  departmentId: number;
  jobTitle: string;
  description: string;
  employmentType: string | null;
  experienceLevel: string | null;
  experienceRequired: string | null;
  educationRequirement: string | null;
  minSalary: number | null;
  maxSalary: number | null;
  location: string | null;
  workMode: string | null;
  isRemote: boolean;
  numberOfOpenings: number;
  applicationDeadline: string | null;
  status: string;
  assignedRecruiterId: string | null;
  interviewStageId: number | null;
  createdAt: string;
  isActive: boolean;
};

export type CandidateJobDto = {
  jobId: number;
  companyId: number;
  companyName: string;
  companyProfilePicture?: string | null;
  companyIndustry?: string | null;
  companyWebsite?: string | null;
  companyEmail?: string | null;
  companyAddress?: string | null;
  departmentId: number;
  departmentName: string;
  jobTitle: string;
  description: string;
  employmentType: string | null;
  experienceLevel: string | null;
  experienceRequired: string | null;
  educationRequirement: string | null;
  minSalary: number | null;
  maxSalary: number | null;
  location: string | null;
  workMode: string | null;
  isRemote: boolean;
  numberOfOpenings: number;
  applicationDeadline: string | null;
  status: string;
  createdById?: string | null;
  assignedRecruiter?: {
    id: string;
    name: string;
    email: string | null;
    phoneNumber: string | null;
  } | null;
  createdByUser?: {
    id: string;
    name: string;
    email: string | null;
    phoneNumber: string | null;
  } | null;
  requiredSkills?: string[] | null;
  interviewStages?: Array<{ id: number; stageName: string; orderIndex: number }> | null;
  createdAt: string;
  isActive: boolean;
};

export type SaveJobRequest = {
  departmentId: number;
  jobTitle: string;
  description: string;
  employmentType?: string | null;
  experienceLevel?: string | null;
  experienceRequired?: string | null;
  educationRequirement?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  location?: string | null;
  workMode?: string | null;
  isRemote: boolean;
  numberOfOpenings: number;
  applicationDeadline?: string | null;
  status?: string | null;
  assignedRecruiterId?: string | null;
  interviewStageId?: number | null;
  isActive: boolean;
};

@Injectable({
  providedIn: 'root'
})
export class JobService {
  private readonly apiUrl = environment.apiUrl;

  constructor(
    private readonly http: HttpClient,
    private readonly sessionCookieService: SessionCookieService
  ) {}

  getJobs(): Observable<JobDto[]> {
    return this.http.get<JobDto[]>(`${this.apiUrl}/jobs`, { headers: this.getAuthHeaders() });
  }

  /** One job (same JSON shape as an item from candidate-feed), including inactive jobs. */
  getCandidateFeedJob(jobId: number): Observable<CandidateJobDto> {
    return this.http.get<CandidateJobDto>(`${this.apiUrl}/jobs/candidate-feed/job/${jobId}`, {
      headers: this.getAuthHeaders()
    });
  }

  getCandidateFeed(): Observable<CandidateJobDto[]> {
    return this.http
      .get<CandidateJobDto[]>(`${this.apiUrl}/jobs/candidate-feed`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status !== 404) {
            return throwError(() => error);
          }

          // Backward compatibility: if candidate-feed endpoint is unavailable,
          // try legacy /jobs response and adapt it for feed cards.
          return this.http.get<JobDto[]>(`${this.apiUrl}/jobs`, { headers: this.getAuthHeaders() }).pipe(
            map((jobs) =>
              jobs.map((job) => ({
                jobId: job.jobId,
                companyId: job.companyId,
                companyName: `Company ${job.companyId}`,
                companyProfilePicture: null,
                companyIndustry: null,
                companyWebsite: null,
                companyEmail: null,
                companyAddress: null,
                departmentId: job.departmentId,
                departmentName: `Department ${job.departmentId}`,
                jobTitle: job.jobTitle,
                description: job.description,
                employmentType: job.employmentType,
                experienceLevel: job.experienceLevel,
                experienceRequired: job.experienceRequired,
                educationRequirement: job.educationRequirement,
                minSalary: job.minSalary,
                maxSalary: job.maxSalary,
                location: job.location,
                workMode: job.workMode,
                isRemote: job.isRemote,
                numberOfOpenings: job.numberOfOpenings,
                applicationDeadline: job.applicationDeadline,
                status: job.status,
                createdById: null,
                assignedRecruiter: null,
                createdByUser: null,
                requiredSkills: [],
                createdAt: job.createdAt,
                isActive: job.isActive
              }))
            ),
            catchError(() => of([]))
          );
        })
      );
  }

  createJob(payload: SaveJobRequest): Observable<JobDto> {
    return this.http.post<JobDto>(`${this.apiUrl}/jobs`, payload, { headers: this.getAuthHeaders() });
  }

  updateJob(jobId: number, payload: SaveJobRequest): Observable<JobDto> {
    return this.http.put<JobDto>(`${this.apiUrl}/jobs/${jobId}`, payload, { headers: this.getAuthHeaders() });
  }

  deactivateJob(jobId: number): Observable<string> {
    return this.http.delete(`${this.apiUrl}/jobs/${jobId}`, {
      headers: this.getAuthHeaders(),
      responseType: 'text'
    });
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.sessionCookieService.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
