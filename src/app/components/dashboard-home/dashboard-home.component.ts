import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionCookieService } from '../../services/session-cookie.service';

@Component({
  selector: 'app-dashboard-home',
  templateUrl: './dashboard-home.component.html',
  styleUrl: './dashboard-home.component.css'
})
export class DashboardHomeComponent {
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly router = inject(Router);
  protected readonly cdr = inject(ChangeDetectorRef);

  private readonly roles = this.sessionCookieService.getRoles().map((r) => r.toLowerCase());
  protected readonly isAdmin = this.roles.includes('admin');
  protected readonly isCandidate = this.roles.includes('candidate');
  protected readonly isHrManager = this.roles.includes('hrmanager');
  protected readonly isRecruiter = this.roles.includes('recruiter');
  protected readonly isInterviewer = this.roles.includes('interviewer');
  protected readonly email = this.sessionCookieService.getEmail() ?? '';
  protected readonly userName = this.email.split('@')[0] || 'User';
  protected readonly roleSummary = this.sessionCookieService.getRoles().join(', ');

  protected navigate(path: string): void {
    void this.router.navigate([path]);
  }
}
