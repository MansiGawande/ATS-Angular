import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionCookieService } from '../../services/session-cookie.service';

type AdminMenuIconId = 'home' | 'users' | 'company' | 'departmentSkills' | 'jobs' | 'interviewStages' | 'candidateJobs' | 'myApplications' | 'myResumes';

type AdminMenuItem = {
  id: AdminMenuIconId;
  label: string;
  icon: AdminMenuIconId;
  route?: string;
  children?: Array<{ id: 'departments' | 'skills'; label: string; route: string }>;
};

@Component({
  selector: 'app-admin-dashboard',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.css'
})
export class AdminDashboardComponent {
  private readonly router = inject(Router);
  private readonly sessionCookieService = inject(SessionCookieService);

  protected sidebarOpen = true;
  protected readonly profileUserId = this.sessionCookieService.getUserId();
  protected readonly profileEmail = this.sessionCookieService.getEmail() || 'admin@ats.local';
  protected readonly profileInitial = this.profileEmail.charAt(0).toUpperCase() || 'A';
  private readonly roles = this.readRoles().map((role) => role.toLowerCase());
  protected readonly isAdmin = this.roles.includes('admin');
  protected readonly isHrManager = this.roles.includes('hrmanager');
  protected readonly isRecruiter = this.roles.includes('recruiter');
  protected readonly isInterviewer = this.roles.includes('interviewer');
  protected readonly isCandidate = this.roles.includes('candidate');
  protected readonly menuItems: AdminMenuItem[] = this.buildMenuItems();
  protected readonly expandedMenus = new Set<string>();

  constructor() {
    if (!this.sessionCookieService.hasToken()) {
      void this.router.navigate(['/login']);
    }
  }

  private readRoles(): string[] {
    return this.sessionCookieService.getRoles();
  }

  protected logout(): void {
    this.sessionCookieService.clearSession();
    void this.router.navigate(['/login']);
  }

  protected toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  protected openLoggedInProfile(): void {
    void this.router.navigate(['/admin-dashboard/profile']);
  }

  protected isExpanded(menuId: string): boolean {
    return this.expandedMenus.has(menuId);
  }

  protected toggleExpanded(menuId: string): void {
    if (this.expandedMenus.has(menuId)) {
      this.expandedMenus.delete(menuId);
      return;
    }
    this.expandedMenus.add(menuId);
  }

  protected isDepartmentSkillsRouteActive(): boolean {
    return this.router.url.includes('/admin-dashboard/department-and-skills/');
  }

  private buildMenuItems(): AdminMenuItem[] {
    const items: AdminMenuItem[] = [];
    items.push({ id: 'home', label: 'Home', icon: 'home', route: '/admin-dashboard' });
    if (this.isAdmin || this.isHrManager) {
      items.push({ id: 'users', label: 'User Management', icon: 'users', route: '/admin-dashboard/users' });
    }
    if (this.isAdmin) {
      items.push({ id: 'company', label: 'Company Creation', icon: 'company', route: '/admin-dashboard/companies' });
    }
    if (this.isHrManager) {
      items.push({ id: 'jobs', label: 'Job Posting', icon: 'jobs', route: '/admin-dashboard/jobs' });
      items.push({
        id: 'interviewStages',
        label: 'Interview Stages',
        icon: 'interviewStages',
        route: '/admin-dashboard/interview-stages'
      });
      items.push({
        id: 'departmentSkills',
        label: 'Department & Skills',
        icon: 'departmentSkills',
        children: [
          { id: 'departments', label: 'Create Department', route: '/admin-dashboard/department-and-skills/departments' },
          { id: 'skills', label: 'Create Skill', route: '/admin-dashboard/department-and-skills/skills' }
        ]
      });
    }
    if (this.isRecruiter) {
      items.push({ id: 'jobs', label: 'Job Posting', icon: 'jobs', route: '/admin-dashboard/jobs' });
    }
    items.push({ id: 'candidateJobs', label: 'Job Feed', icon: 'candidateJobs', route: '/admin-dashboard/candidate-jobs' });
    if (this.isCandidate) {
      items.push({
        id: 'myResumes',
        label: 'My Resumes',
        icon: 'myResumes',
        route: '/admin-dashboard/my-resumes'
      });
      items.push({
        id: 'myApplications',
        label: 'My Applications',
        icon: 'myApplications',
        route: '/admin-dashboard/my-applications'
      });
    }
    return items;
  }
}
