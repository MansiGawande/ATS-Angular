import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { finalize, timeout } from 'rxjs';
import { JobApplicationService, MyApplicationDto } from '../../services/job-application.service';
import { SessionCookieService } from '../../services/session-cookie.service';

@Component({
  selector: 'app-my-applications',
  templateUrl: './my-applications.component.html',
  styleUrl: './my-applications.component.css'
})
export class MyApplicationsComponent implements OnInit {
  private readonly jobApplicationService = inject(JobApplicationService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly router = inject(Router);
  private readonly requestTimeoutMs = 15000;

  protected applications: MyApplicationDto[] = [];
  protected isLoading = false;
  protected errorMessage = '';

  ngOnInit(): void {
    const isCandidate = this.sessionCookieService
      .getRoles()
      .map((r) => r.toLowerCase())
      .includes('candidate');

    if (!isCandidate) {
      void this.router.navigate(['/admin-dashboard']);
      return;
    }

    this.loadApplications();
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleDateString();
  }

  protected getStatusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'shortlisted':
        return 'text-bg-success';
      case 'reviewed':
        return 'text-bg-info';
      case 'rejected':
        return 'text-bg-danger';
      default:
        return 'text-bg-secondary';
    }
  }

  private loadApplications(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.jobApplicationService
      .getMyApplications()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (apps) => {
          this.applications = apps;
        },
        error: () => {
          this.errorMessage = 'Unable to load your applications.';
        }
      });
  }
}
