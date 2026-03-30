import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { CandidateJobDto, JobService } from '../../services/job.service';
import { JobApplicationService } from '../../services/job-application.service';
import { SessionCookieService } from '../../services/session-cookie.service';

@Component({
  selector: 'app-candidate-jobs',
  templateUrl: './candidate-jobs.component.html',
  styleUrl: './candidate-jobs.component.css'
})
export class CandidateJobsComponent implements OnInit {
  private readonly jobService = inject(JobService);
  private readonly jobApplicationService = inject(JobApplicationService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly router = inject(Router);
  private readonly requestTimeoutMs = 15000;

  protected jobs: CandidateJobDto[] = [];
  protected isLoading = false;
  protected isApplying = false;
  protected isUpdatingStatus = false;
  protected errorMessage = '';
  protected successMessage = '';
  protected readonly isCandidate = this.sessionCookieService
    .getRoles()
    .map((role) => role.toLowerCase())
    .includes('candidate');
  protected readonly isHrManager = this.sessionCookieService
    .getRoles()
    .map((role) => role.toLowerCase())
    .includes('hrmanager');
  protected readonly isRecruiter = this.sessionCookieService
    .getRoles()
    .map((role) => role.toLowerCase())
    .includes('recruiter');

  ngOnInit(): void {
    this.loadJobs();
  }

  protected apply(job: CandidateJobDto): void {
    if (!this.isCandidate || this.isApplying) {
      return;
    }

    this.isApplying = true;
    this.successMessage = '';
    this.errorMessage = '';
    this.jobApplicationService
      .applyJob(job.jobId)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isApplying = false)))
      .subscribe({
        next: () => {
          this.successMessage = `Application submitted for "${job.jobTitle}".`;
        },
        error: (error) => {
          if (error?.status === 409) {
            this.errorMessage = 'You already applied for this job.';
            return;
          }
          if (error?.status === 403) {
            this.errorMessage = 'Only candidate role can apply.';
            return;
          }
          this.errorMessage = 'Unable to apply now. Please try again.';
        }
      });
  }

  protected formatDateTime(value: string | null): string {
    if (!value) {
      return '-';
    }
    return new Date(value).toLocaleString();
  }

  protected getCompanyInitials(name: string): string {
    const words = name.split(' ').filter((item) => item.trim().length > 0);
    if (words.length === 0) {
      return 'CO';
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }

  protected openJobManagement(): void {
    void this.router.navigate(['/admin-dashboard/jobs']);
  }

  protected openEditJob(job: CandidateJobDto): void {
    if (!this.isHrManager && !this.isRecruiter) {
      return;
    }
    void this.router.navigate(['/admin-dashboard/jobs'], { queryParams: { editJobId: job.jobId } });
  }

  protected toggleStatus(job: CandidateJobDto): void {
    if ((!this.isHrManager && !this.isRecruiter) || this.isUpdatingStatus) {
      return;
    }

    this.isUpdatingStatus = true;
    this.errorMessage = '';
    this.successMessage = '';

    if (job.isActive) {
      this.jobService
        .deactivateJob(job.jobId)
        .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isUpdatingStatus = false)))
        .subscribe({
          next: () => {
            this.successMessage = 'Job deactivated successfully.';
            this.loadJobs();
          },
          error: () => {
            this.errorMessage = 'Unable to update job status.';
          }
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
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isUpdatingStatus = false)))
      .subscribe({
        next: () => {
          this.successMessage = 'Job activated successfully.';
          this.loadJobs();
        },
        error: () => {
          this.errorMessage = 'Unable to update job status.';
        }
      });
  }

  private loadJobs(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.jobService
      .getCandidateFeed()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (jobs) => {
          this.jobs = this.isCandidate ? jobs.filter((item) => item.isActive) : jobs;
        },
        error: () => {
          this.errorMessage = 'Unable to load job feed.';
        }
      });
  }
}
