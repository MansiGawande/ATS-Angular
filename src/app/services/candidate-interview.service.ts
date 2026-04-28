import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionCookieService } from './session-cookie.service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export type CompanyInterviewer = {
  id: string;
  name: string;
  email: string;
  isHr?: boolean;
  isRecruiter?: boolean;
  isInterviewer?: boolean;
};

export type CandidateInterviewDto = {
  id: number;
  jobApplicationId: number;
  candidateId: string;
  jobId: number;
  interviewStageId?: number | null;
  stageName?: string | null;
  stageOrder?: number | null;
  interviewerId?: string | null;
  interviewerName?: string | null;
  interviewerEmail?: string | null;
  scheduledDateTime?: string | null;
  meetingLink?: string | null;
  location?: string | null;
  mode?: string | null;
  status: string;
  score?: number | null;
  remarks?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  feedbackCount: number;
};

export type InterviewFeedbackDto = {
  id: number;
  candidateInterviewId: number;
  technicalScore?: number | null;
  communicationScore?: number | null;
  overallScore?: number | null;
  feedback?: string | null;
  recommendation?: string | null;
  createdBy?: string | null;
  createdByEmail?: string | null;
  createdAt: string;
};

export type ScheduleInterviewRequest = {
  jobApplicationId: number;
  interviewStageId?: number | null;
  interviewerId?: string | null;
  scheduledDateTime?: string | null;
  mode?: string;
  meetingLink?: string | null;
  location?: string | null;
  remarks?: string | null;
};

export type UpdateInterviewStatusRequest = {
  status: string;
  score?: number | null;
  remarks?: string | null;
};

export type UpdateInterviewDetailsRequest = {
  interviewerId?: string | null;
  scheduledDateTime?: string | null;
  mode?: string | null;
  meetingLink?: string | null;
  location?: string | null;
  remarks?: string | null;
  interviewStageId?: number | null;
};

export type SubmitFeedbackRequest = {
  technicalScore?: number | null;
  communicationScore?: number | null;
  overallScore?: number | null;
  feedback?: string | null;
  recommendation?: string | null;
};

export type UpdateApplicationStatusRequest = {
  status: string;
};

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class CandidateInterviewService {
  private readonly base = environment.apiUrl;

  constructor(
    private readonly http: HttpClient,
    private readonly session: SessionCookieService
  ) {}

  /** All interviews for a given job application */
  getByApplication(applicationId: number): Observable<CandidateInterviewDto[]> {
    return this.http.get<CandidateInterviewDto[]>(
      `${this.base}/candidate-interviews?applicationId=${applicationId}`,
      { headers: this.headers() }
    );
  }

  /** Schedule a new interview */
  schedule(req: ScheduleInterviewRequest): Observable<{ id: number; status: string; appStatus: string }> {
    return this.http.post<{ id: number; status: string; appStatus: string }>(
      `${this.base}/candidate-interviews`,
      req,
      { headers: this.headers() }
    );
  }

  /** Update interview status (+ optional score/remarks) */
  updateStatus(id: number, req: UpdateInterviewStatusRequest): Observable<{ id: number; status: string }> {
    return this.http.put<{ id: number; status: string }>(
      `${this.base}/candidate-interviews/${id}/status`,
      req,
      { headers: this.headers() }
    );
  }

  /** Fill / update scheduling details on an auto-created or unassigned interview */
  updateDetails(id: number, req: UpdateInterviewDetailsRequest): Observable<{ id: number }> {
    return this.http.patch<{ id: number }>(
      `${this.base}/candidate-interviews/${id}/details`,
      req,
      { headers: this.headers() }
    );
  }

  /** Submit feedback for an interview */
  submitFeedback(interviewId: number, req: SubmitFeedbackRequest): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(
      `${this.base}/candidate-interviews/${interviewId}/feedback`,
      req,
      { headers: this.headers() }
    );
  }

  /** Get feedback for an interview */
  getFeedback(interviewId: number): Observable<InterviewFeedbackDto[]> {
    return this.http.get<InterviewFeedbackDto[]>(
      `${this.base}/candidate-interviews/${interviewId}/feedback`,
      { headers: this.headers() }
    );
  }

  /** Get all interviewers in the logged-in user's company */
  getCompanyInterviewers(): Observable<CompanyInterviewer[]> {
    return this.http.get<CompanyInterviewer[]>(
      `${this.base}/candidate-interviews/company-interviewers`,
      { headers: this.headers() }
    );
  }

  /** Update application status (HR/Recruiter) */
  updateApplicationStatus(applicationId: number, req: UpdateApplicationStatusRequest): Observable<{ id: number; status: string }> {
    return this.http.put<{ id: number; status: string }>(
      `${this.base}/applications/${applicationId}/status`,
      req,
      { headers: this.headers() }
    );
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.session.getToken()}` });
  }
}
