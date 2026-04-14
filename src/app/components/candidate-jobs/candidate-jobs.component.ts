import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { CandidateJobDto, JobService } from '../../services/job.service';
import { ApplicationScoreResult, JobApplicationService } from '../../services/job-application.service';
import { ResumeDto, ResumeService, resumeDisplayLabel } from '../../services/resume.service';
import { AuthService, MyProfileResponse } from '../../services/auth.service';
import { SessionCookieService } from '../../services/session-cookie.service';
import { AtsScoreDetailComponent } from '../ats-score-detail/ats-score-detail.component';

@Component({
  selector: 'app-candidate-jobs',
  imports: [ReactiveFormsModule, AtsScoreDetailComponent],
  templateUrl: './candidate-jobs.component.html',
  styleUrl: './candidate-jobs.component.css'
})
export class CandidateJobsComponent implements OnInit {
  private readonly jobService = inject(JobService);
  private readonly jobApplicationService = inject(JobApplicationService);
  private readonly resumeService = inject(ResumeService);
  private readonly authService = inject(AuthService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly requestTimeoutMs = 15000;

  protected jobs: CandidateJobDto[] = [];
  protected isLoading = false;
  protected isUpdatingStatus = false;
  protected errorMessage = '';
  protected successMessage = '';

  /** Job IDs the candidate has already applied to (populated on load). */
  protected appliedJobIds = new Set<number>();

  // ── Apply form state ──────────────────────────────
  protected selectedJobForApply: CandidateJobDto | null = null;
  protected candidateProfile: MyProfileResponse | null = null;
  protected isLoadingProfile = false;

  /** 'existing' = pick from uploaded resumes  |  'new' = upload a file now */
  protected resumeChoice: 'existing' | 'new' = 'existing';
  protected existingResumes: ResumeDto[] = [];
  protected isLoadingResumes = false;
  protected selectedExistingResumeId: number | null = null;

  protected selectedResumeFile: File | null = null;
  protected resumeFileError = '';
  protected isSubmittingApply = false;
  protected applyErrorMessage = '';
  protected applySuccessMessage = '';
  protected resumeListError = '';
  /** Shown on the Job Feed page after the apply modal closes. */
  protected pageApplySuccess = '';

  protected readonly isCandidate = this.sessionCookieService.getRoles().map((r) => r.toLowerCase()).includes('candidate');
  protected readonly isHrManager = this.sessionCookieService.getRoles().map((r) => r.toLowerCase()).includes('hrmanager');
  protected readonly isRecruiter = this.sessionCookieService.getRoles().map((r) => r.toLowerCase()).includes('recruiter');

  // Score result shown after a successful application
  protected scoreResult: ApplicationScoreResult | null = null;
  protected isLoadingScore = false;

  protected applyForm = this.fb.group({
    coverNote: ['', [Validators.maxLength(2000)]]
  });

  ngOnInit(): void {
    this.loadJobs();
    if (this.isCandidate) {
      this.loadAppliedJobIds();
    }
  }

  protected hasApplied(jobId: number): boolean {
    return this.appliedJobIds.has(jobId);
  }

  // ── Apply Form ────────────────────────────────────

  protected openApplyForm(job: CandidateJobDto): void {
    if (!this.isCandidate) return;
    this.selectedJobForApply = job;
    this.applyErrorMessage = '';
    this.applySuccessMessage = '';
    this.selectedResumeFile = null;
    this.resumeFileError = '';
    this.applyForm.reset({ coverNote: '' });
    this.resumeListError = '';
    this.loadCandidateProfile();
    this.loadExistingResumes();
    this.cdr.markForCheck();
  }

  protected closeApplyForm(): void {
    this.selectedJobForApply = null;
    this.candidateProfile = null;
    this.existingResumes = [];
    this.selectedResumeFile = null;
    this.selectedExistingResumeId = null;
    this.applyErrorMessage = '';
    this.applySuccessMessage = '';
    this.resumeListError = '';
    this.scoreResult = null;
    this.isLoadingScore = false;
    this.cdr.markForCheck();
  }

  protected setResumeChoice(choice: 'existing' | 'new'): void {
    this.resumeChoice = choice;
    this.applyErrorMessage = '';
    this.cdr.markForCheck();
  }

  protected selectExistingResume(resumeId: number): void {
    this.selectedExistingResumeId = resumeId;
    this.cdr.markForCheck();
  }

  protected onResumeFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.resumeFileError = '';

    if (!file) {
      this.selectedResumeFile = null;
      this.cdr.markForCheck();
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['pdf', 'doc', 'docx'].includes(ext)) {
      this.resumeFileError = 'Only .pdf, .doc, and .docx files are allowed.';
      this.selectedResumeFile = null;
      this.cdr.markForCheck();
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      this.resumeFileError = 'File size cannot exceed 10 MB.';
      this.selectedResumeFile = null;
      this.cdr.markForCheck();
      return;
    }

    this.selectedResumeFile = file;
    this.cdr.markForCheck();
  }

  protected submitApply(): void {
    if (!this.selectedJobForApply || !this.isCandidate || this.isSubmittingApply) return;

    const jobToApply = this.selectedJobForApply;
    const coverNote = this.applyForm.controls.coverNote.value?.trim() || null;

    if (this.resumeChoice === 'existing') {
      if (!this.selectedExistingResumeId) {
        this.applyErrorMessage = 'Please select a resume.';
        this.cdr.markForCheck();
        return;
      }
      this.doApply(jobToApply, this.selectedExistingResumeId, coverNote);
    } else {
      if (!this.selectedResumeFile) {
        this.applyErrorMessage = 'Please upload your resume (PDF, DOC, or DOCX).';
        this.cdr.markForCheck();
        return;
      }
      this.isSubmittingApply = true;
      this.applyErrorMessage = '';
      this.cdr.markForCheck();

      this.resumeService
        .uploadResume(this.selectedResumeFile)
        .pipe(timeout(this.requestTimeoutMs))
        .subscribe({
          next: (resumeData) => {
            this.doApply(jobToApply, resumeData.resumeId, coverNote);
          },
          error: (error) => {
            this.isSubmittingApply = false;
            this.applyErrorMessage = typeof error?.error === 'string' ? error.error : 'Failed to upload resume. Please try again.';
            this.cdr.markForCheck();
          }
        });
    }
  }

  protected getResumeFileName(filePath: string): string {
    return filePath.split('/').pop() ?? filePath;
  }

  protected formatDateTime(value: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleString();
  }

  protected formatDate(value: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected getCompanyInitials(name: string): string {
    const words = name.split(' ').filter((item) => item.trim().length > 0);
    if (words.length === 0) return 'CO';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }

  protected getProfileInitials(): string {
    if (!this.candidateProfile) {
      const email = this.sessionCookieService.getEmail() ?? '';
      return email.charAt(0).toUpperCase() || 'C';
    }
    const first = this.candidateProfile.firstName?.charAt(0) ?? '';
    const last = this.candidateProfile.lastName?.charAt(0) ?? '';
    return (first + last).toUpperCase() || 'C';
  }

  protected openJobManagement(): void {
    void this.router.navigate(['/admin-dashboard/jobs']);
  }

  protected openEditJob(job: CandidateJobDto): void {
    if (!this.isHrManager && !this.isRecruiter) return;
    void this.router.navigate(['/admin-dashboard/jobs'], { queryParams: { editJobId: job.jobId } });
  }

  protected getResumeDisplayName(resume: ResumeDto): string {
    return resumeDisplayLabel(resume);
  }

  /** Open My Resumes page to preview the selected resume (large viewer). */
  protected openResumePreview(event: Event, resume: ResumeDto): void {
    event.preventDefault();
    event.stopPropagation();
    void this.router.navigate(['/admin-dashboard/my-resumes'], { queryParams: { preview: resume.resumeId } });
  }

  protected toggleStatus(job: CandidateJobDto): void {
    if ((!this.isHrManager && !this.isRecruiter) || this.isUpdatingStatus) return;

    this.isUpdatingStatus = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.markForCheck();

    if (job.isActive) {
      this.jobService
        .deactivateJob(job.jobId)
        .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isUpdatingStatus = false; this.cdr.markForCheck(); }))
        .subscribe({
          next: () => { this.successMessage = 'Job deactivated.'; this.loadJobs(); },
          error: () => { this.errorMessage = 'Unable to update job status.'; this.cdr.markForCheck(); }
        });
      return;
    }

    this.jobService
      .updateJob(job.jobId, {
        departmentId: job.departmentId,
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
        assignedRecruiterId: job.assignedRecruiter?.id ?? null,
        isActive: true
      })
      .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isUpdatingStatus = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: () => { this.successMessage = 'Job activated.'; this.loadJobs(); },
        error: () => { this.errorMessage = 'Unable to update job status.'; this.cdr.markForCheck(); }
      });
  }

  private doApply(job: CandidateJobDto, resumeId: number, coverNote: string | null): void {
    this.isSubmittingApply = true;
    this.applyErrorMessage = '';
    this.scoreResult = null;
    this.cdr.markForCheck();

    this.jobApplicationService
      .applyJob(job.jobId, coverNote, resumeId)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isSubmittingApply = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (response) => {
          this.appliedJobIds.add(job.jobId);
          this.applySuccessMessage = `Application submitted! Calculating your ATS score…`;
          this.selectedResumeFile = null;
          this.applyForm.reset({ coverNote: '' });
          this.cdr.markForCheck();

          // Fetch ATS score (after a short delay so the DB write settles)
          this.isLoadingScore = true;
          this.cdr.markForCheck();
          setTimeout(() => {
            this.jobApplicationService
              .getApplicationScore(response.id)
              .pipe(timeout(30000), finalize(() => { this.isLoadingScore = false; this.cdr.markForCheck(); }))
              .subscribe({
                next: (score) => {
                  this.scoreResult = score;
                  this.applySuccessMessage = `Application submitted!`;
                  this.cdr.markForCheck();
                },
                error: () => {
                  // Score unavailable – still show success
                  this.applySuccessMessage = `Application submitted! Score will be calculated shortly.`;
                  this.cdr.markForCheck();
                  setTimeout(() => {
                    this.closeApplyForm();
                    this.pageApplySuccess = `Your application for "${job.jobTitle}" at ${job.companyName} was submitted.`;
                    this.cdr.markForCheck();
                    setTimeout(() => { this.pageApplySuccess = ''; this.cdr.markForCheck(); }, 5000);
                  }, 2000);
                }
              });
          }, 2500);
        },
        error: (error) => {
          if (error?.status === 409) {
            this.applyErrorMessage = 'You have already applied for this job.';
            this.appliedJobIds.add(job.jobId);
          } else if (error?.status === 403) {
            this.applyErrorMessage = 'Only candidates can apply for jobs.';
          } else {
            this.applyErrorMessage = typeof error?.error === 'string' ? error.error : 'Unable to submit application. Please try again.';
          }
          this.cdr.markForCheck();
        }
      });
  }

  /** Silently load applied job IDs to mark cards as "Already Applied". */
  private loadAppliedJobIds(): void {
    this.jobApplicationService
      .getMyApplications()
      .pipe(timeout(10000))
      .subscribe({
        next: (apps) => {
          this.appliedJobIds = new Set(apps.map((a) => a.jobId));
          this.cdr.markForCheck();
        },
        error: () => { /* non-critical, ignore */ }
      });
  }

  private loadExistingResumes(): void {
    this.isLoadingResumes = true;
    this.existingResumes = [];
    this.selectedExistingResumeId = null;
    this.resumeListError = '';
    this.cdr.markForCheck();

    this.resumeService
      .getMyResumes()
      .pipe(timeout(10000), finalize(() => { this.isLoadingResumes = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (resumes) => {
          this.resumeListError = '';
          const activeOnly = resumes.filter((r) => r.isActive !== false);
          this.existingResumes = activeOnly;
          if (activeOnly.length > 0) {
            this.resumeChoice = 'existing';
            this.selectedExistingResumeId = activeOnly[0].resumeId;
          } else {
            this.resumeChoice = 'new';
          }
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.resumeListError =
            err?.status === 403
              ? 'You are not allowed to list resumes for this account. Re-login as a Candidate.'
              : 'Could not load your saved resumes. You can still upload a new file below.';
          this.resumeChoice = 'new';
          this.cdr.markForCheck();
        }
      });
  }

  private loadCandidateProfile(): void {
    const token = this.sessionCookieService.getToken();
    if (!token) return;

    this.candidateProfile = {
      id: this.sessionCookieService.getUserId(),
      firstName: '',
      lastName: '',
      email: this.sessionCookieService.getEmail(),
      phoneNumber: null,
      profilePicture: null,
      companyId: null,
      createdAt: '',
      isActive: true,
      lastLoginUtc: null,
      company: null,
      activityHistory: [],
      roles: this.sessionCookieService.getRoles()
    };
    this.cdr.markForCheck();

    this.isLoadingProfile = true;
    this.authService
      .getMyProfile(token)
      .pipe(timeout(5000), finalize(() => { this.isLoadingProfile = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (profile) => {
          this.candidateProfile = profile;
          this.cdr.markForCheck();
        },
        error: () => { /* keep session placeholder */ }
      });
  }

  private loadJobs(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();
    this.jobService
      .getCandidateFeed()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isLoading = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (jobs) => {
          this.jobs = this.isCandidate ? jobs.filter((item) => item.isActive) : jobs;
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage = 'Unable to load job feed.';
          this.cdr.markForCheck();
        }
      });
  }
}
