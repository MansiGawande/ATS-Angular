import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { RegisterComponent } from './components/register/register.component';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { UserManagementComponent } from './components/user-management/userManagement.component';
import { CompanyComponent } from './components/company/company.component';
import { DepartmentSkillsComponent } from './components/department-skills/department-skills.component';
import { DashboardHomeComponent } from './components/dashboard-home/dashboard-home.component';
import { JobPostingComponent } from './components/job-posting/job-posting.component';
import { InterviewStagesComponent } from './components/interview-stages/interview-stages.component';
import { CandidateJobsComponent } from './components/candidate-jobs/candidate-jobs.component';
import { MyApplicationsComponent } from './components/my-applications/my-applications.component';
import { MyProfileComponent } from './components/my-profile/my-profile.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  {
    path: 'admin-dashboard',
    component: AdminDashboardComponent,
    children: [
      { path: '', component: DashboardHomeComponent },
      { path: 'users', component: UserManagementComponent },
      { path: 'users/:id', component: UserManagementComponent },
      { path: 'users/:id/edit', component: UserManagementComponent },
      { path: 'companies', component: CompanyComponent },
      { path: 'companies/new', component: CompanyComponent },
      { path: 'companies/:id/edit', component: CompanyComponent },
      { path: 'department-and-skills/departments', component: DepartmentSkillsComponent },
      { path: 'department-and-skills/skills', component: DepartmentSkillsComponent },
      { path: 'jobs', component: JobPostingComponent },
      { path: 'interview-stages', component: InterviewStagesComponent },
      { path: 'candidate-jobs', component: CandidateJobsComponent },
      { path: 'my-applications', component: MyApplicationsComponent },
      { path: 'profile', component: MyProfileComponent }
    ]
  },
  { path: '**', redirectTo: 'login' }
];
