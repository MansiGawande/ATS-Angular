import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { CandidateJobDto, JobService } from '../../services/job.service';
import { SessionCookieService } from '../../services/session-cookie.service';

@Component({
  selector: 'app-dashboard-home',
  templateUrl: './dashboard-home.component.html',
  styleUrl: './dashboard-home.component.css'
})
export class DashboardHomeComponent implements OnInit {
  private readonly jobService = inject(JobService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly router = inject(Router);
  private readonly requestTimeoutMs = 15000;

  protected jobs: CandidateJobDto[] = [];
  protected filteredJobs: CandidateJobDto[] = [];
  protected isLoading = false;
  protected errorMessage = '';
  protected searchText = '';

  private readonly roles = this.sessionCookieService.getRoles().map((r) => r.toLowerCase());
  protected readonly isAdmin = this.roles.includes('admin');
  protected readonly isCandidate = this.roles.includes('candidate');
  protected readonly isHrManager = this.roles.includes('hrmanager');
  protected readonly isRecruiter = this.roles.includes('recruiter');
  protected readonly isInterviewer = this.roles.includes('interviewer');
  protected readonly userName = this.sessionCookieService.getEmail()?.split('@')[0] ?? 'User';
  protected readonly roleSummary = this.buildRoleSummary();

  ngOnInit(): void {
    this.loadJobs();
  }

  protected get activeJobCount(): number {
    return this.jobs.filter((j) => j.isActive).length;
  }

  protected get totalJobCount(): number {
    return this.jobs.length;
  }

  protected get uniqueCompanyCount(): number {
    return new Set(this.jobs.map((j) => j.companyName)).size;
  }

  protected onSearch(value: string): void {
    this.searchText = value.toLowerCase();
    this.applyFilter();
  }

  protected navigateToJobFeed(): void {
    void this.router.navigate(['/admin-dashboard/candidate-jobs']);
  }

  protected navigateToJobPosting(): void {
    void this.router.navigate(['/admin-dashboard/jobs']);
  }

  protected getCompanyInitials(name: string): string {
    const words = name.split(' ').filter((item) => item.trim().length > 0);
    if (words.length === 0) return 'CO';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }

  protected formatDate(value: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private buildRoleSummary(): string {
    const roles = this.sessionCookieService.getRoles();
    return roles.join(', ');
  }

  private loadJobs(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.jobService
      .getCandidateFeed()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (jobs) => {
          this.jobs = this.isCandidate ? jobs.filter((j) => j.isActive) : jobs;
          this.applyFilter();
        },
        error: () => {
          this.errorMessage = 'Unable to load job listings.';
        }
      });
  }

  private applyFilter(): void {
    if (!this.searchText) {
      this.filteredJobs = this.jobs;
      return;
    }
    this.filteredJobs = this.jobs.filter(
      (j) =>
        j.jobTitle.toLowerCase().includes(this.searchText) ||
        j.companyName.toLowerCase().includes(this.searchText) ||
        (j.departmentName ?? '').toLowerCase().includes(this.searchText) ||
        (j.location ?? '').toLowerCase().includes(this.searchText)
    );
  }
}
