import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component,
  ElementRef, OnDestroy, OnInit, ViewChild, inject
} from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import DataTable from 'datatables.net-bs5';
import { finalize, timeout } from 'rxjs';
import { Observable } from 'rxjs';
import {
  AllApplicationDto, ApplicationDetailStaff,
  ApplicationScoreResult, JobApplicationService,
  MyApplicationDto
} from '../../services/job-application.service';
import {
  CandidateInterviewService,
  CandidateInterviewDto, CompanyInterviewer, InterviewFeedbackDto,
  UpdateInterviewDetailsRequest
} from '../../services/candidate-interview.service';
import { SessionCookieService } from '../../services/session-cookie.service';
import { AtsScoreDetailComponent } from '../ats-score-detail/ats-score-detail.component';
import { getResumeFileUrl, resumeDisplayLabel } from '../../services/resume.service';

type UnifiedRow = {
  id: number;
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
  candidateId?: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
  appliedMs: number;
  appliedLabel: string;
};

@Component({
  selector: 'app-applications-review',
  imports: [AtsScoreDetailComponent, DecimalPipe, DatePipe, FormsModule],
  templateUrl: './applications-review.component.html',
  styleUrl: './applications-review.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ApplicationsReviewComponent implements OnInit, OnDestroy {
  @ViewChild('appTable',  { static: true }) protected appTable?: ElementRef<HTMLTableElement>;
  @ViewChild('filterBar', { static: true }) protected filterBar?: ElementRef<HTMLDivElement>;

  private readonly svc       = inject(JobApplicationService);
  private readonly itvSvc    = inject(CandidateInterviewService);
  private readonly session   = inject(SessionCookieService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cdr       = inject(ChangeDetectorRef);

  // ── Role flags ────────────────────────────────────────────────────────
  private readonly roles         = this.session.getRoles().map(r => r.toLowerCase());
  protected readonly loggedInUserId  = this.session.getUserId();
  protected readonly isAdmin         = this.roles.includes('admin');
  protected readonly isCandidate     = this.roles.includes('candidate');
  protected readonly isHrManagerRole = this.roles.includes('hrmanager');
  protected readonly isRecruiterRole = this.roles.includes('recruiter');
  protected readonly isInterviewerRole = this.roles.includes('interviewer');
  protected readonly isStaff  = this.isHrManagerRole || this.isRecruiterRole || this.isInterviewerRole;
  /** Only HR and Recruiter can schedule interviews */
  protected readonly canSchedule = this.isHrManagerRole || this.isRecruiterRole;
  /** HR can update any interview; others only if they are the assigned interviewer */
  protected canUpdateInterview(itv: CandidateInterviewDto): boolean {
    if (this.isHrManagerRole) return true;
    return itv.interviewerId === this.loggedInUserId;
  }
  /** Min datetime string for date input (today's date, local ISO) */
  protected readonly todayMin = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  })();

  // ── Table ─────────────────────────────────────────────────────────────
  protected tableRows: UnifiedRow[] = [];
  protected isLoading    = false;
  protected errorMessage = '';

  // ── Detail panel ──────────────────────────────────────────────────────
  protected panelOpen    = false;
  protected panelLoading = false;
  protected panelError   = '';
  protected detail: ApplicationDetailStaff | null = null;

  // ── Resume preview ────────────────────────────────────────────────────
  protected resumeUrl: SafeResourceUrl | null = null;
  protected resumeRawUrl: string | null = null;
  protected resumeIsPdf  = false;
  protected resumeOfficeUrl = '';
  protected resumeName = '';

  // ── ATS Score ─────────────────────────────────────────────────────────
  protected scoreResult: ApplicationScoreResult | null = null;
  protected scoreLoading = false;

  // ── Comparison data (staff only) ──────────────────────────────────────
  protected compMatchedSkills: string[] = [];
  protected compMissingSkills: string[] = [];
  protected compExtSkills: string[] = [];
  protected compTotalYears = 0;

  private dataTable: unknown = null;
  private clickHandler?: (e: Event) => void;

  // ── Lifecycle ─────────────────────────────────────────────────────────
  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.destroyDT(); }

  // ── Data ──────────────────────────────────────────────────────────────
  private load(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.destroyDT();
    this.cdr.markForCheck();

    const source$: Observable<(MyApplicationDto | AllApplicationDto)[]> = this.isStaff
      ? this.svc.getAllApplications()
      : this.svc.getMyApplications();

    source$.pipe(
      timeout(20000),
      finalize(() => { this.isLoading = false; this.cdr.markForCheck(); })
    ).subscribe({
      next: (apps) => {
        this.tableRows = apps.map(a => {
          const aa = a as AllApplicationDto;
          return {
            id: a.id, jobId: a.jobId, resumeId: a.resumeId,
            resumeFilePath:    (a as MyApplicationDto).resumeFilePath    ?? null,
            resumeDisplayName: (a as MyApplicationDto).resumeDisplayName ?? null,
            jobTitle: a.jobTitle, companyName: a.companyName,
            status: a.status, appliedAt: a.appliedAt, matchScore: a.matchScore,
            skillScore:      aa.skillScore      ?? null,
            experienceScore: aa.experienceScore ?? null,
            educationScore:  aa.educationScore  ?? null,
            candidateId:    aa.candidateId,
            candidateName:  aa.candidateName  ?? null,
            candidateEmail: aa.candidateEmail ?? null,
            appliedMs:    new Date(a.appliedAt).getTime(),
            appliedLabel: new Date(a.appliedAt).toLocaleString()
          };
        });
        this.cdr.detectChanges();
        this.initDT();
        this.cdr.markForCheck();
      },
      error: () => {
        this.errorMessage = 'Unable to load applications. Please refresh.';
        this.cdr.markForCheck();
      }
    });
  }

  // ── DataTable ─────────────────────────────────────────────────────────
  private initDT(): void {
    const el = this.appTable?.nativeElement;
    if (!el) return;
    this.destroyDT();

    this.clickHandler = (ev: Event) => {
      const btn = (ev.target as HTMLElement).closest('button[data-action="view"]') as HTMLButtonElement | null;
      if (!btn) return;
      const id = Number(btn.dataset['appId']);
      if (Number.isFinite(id)) this.openPanel(id);
    };
    el.addEventListener('click', this.clickHandler);

    const candidateColumns = [
      {
        data: 'jobTitle', title: 'Job Title',
        render: (v: string) => v
      },
      {
        data: 'companyName', title: 'Company',
        render: (v: string) => v
      },
      {
        data: 'resumeDisplayName', title: 'Resume', defaultContent: '—',
        render: (_v: string | null, type: string, row: UnifiedRow) => {
          const name = row.resumeDisplayName ?? '';
          if (type === 'filter' || type === 'sort') return name;
          if (!row.resumeFilePath) return '<span class="text-muted small">—</span>';
          const url = getResumeFileUrl(row.resumeFilePath);
          return `<a href="${encodeURI(url)}" target="_blank" rel="noopener" class="dt-resume-link"
                     title="${name.replace(/"/g, '&quot;')}">📄 ${name || 'Resume'}</a>`;
        }
      },
      {
        data: 'appliedMs', title: 'Applied On',
        render: (_v: number, type: string, row: UnifiedRow) => row.appliedLabel
      },
      {
        data: 'matchScore', title: 'ATS Score', defaultContent: '—',
        render: (v: number | null, type: string) => {
          if (type === 'filter' || type === 'sort') return v != null ? String(Math.round(v)) : '';
          if (v == null) return '<span class="text-muted small">Pending</span>';
            const cls = v >= 75 ? 'score-green' : v >= 50 ? 'score-blue' : v >= 25 ? 'score-amber' : 'score-red';
            return `<span class="dt-score-badge ${cls}">${Math.round(v)}%</span>`;
        }
      },
      {
        data: 'status', title: 'Status',
        render: (v: string, type: string) => {
          if (type === 'filter' || type === 'sort') return v;
          return `<span class="badge rounded-pill ${this.getStatusClass(v)}">${v}</span>`;
        }
      },
      {
        data: null, title: '', orderable: false, searchable: false,
        render: (_: unknown, __: unknown, row: UnifiedRow) =>
          `<button type="button" class="btn btn-sm btn-outline-primary"
             data-action="view" data-app-id="${row.id}">View</button>`
      }
    ];

    const staffColumns = [
      {
        data: 'candidateName', title: 'Candidate', defaultContent: '—',
        render: (v: string | null, type: string, row: UnifiedRow) => {
          if (type === 'filter' || type === 'sort')
            return `${v ?? ''} ${row.candidateEmail ?? ''}`.trim();
          const name  = v ?? row.candidateEmail ?? '—';
          const email = row.candidateEmail
            ? `<div class="small text-muted">${row.candidateEmail}</div>` : '';
          return `<div>${name}${email}</div>`;
        }
      },
      ...candidateColumns
    ];

    this.dataTable = new DataTable(el, {
      data:       this.tableRows,
      searching:  true,
      paging:     true,
      pageLength: 10,
      lengthMenu: [5, 10, 25, 50],
      order:      [[this.isStaff ? 4 : 3, 'desc']],
      columns:    this.isStaff ? staffColumns : candidateColumns,
      language:   { emptyTable: 'No applications found.' }
    });

    const fb = this.filterBar?.nativeElement;
    if (fb) {
      fb.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-col]').forEach(input => {
        const col = Number(input.dataset['col']);
        if (Number.isNaN(col)) return;
        const handler = () => {
          const dtRef = this.dataTable as { column: (n: number) => { search: (v: string, r: boolean, s: boolean) => { draw: () => void } } } | null;
          if (!dtRef) return;
          const val = input.value;
          if (input instanceof HTMLSelectElement) {
            dtRef.column(col).search(val === 'all' ? '' : `^${val}$`, val !== 'all', false).draw();
          } else {
            dtRef.column(col).search(val, false, false).draw();
          }
        };
        input.addEventListener('input', handler);
        input.addEventListener('keyup', handler);
        input.addEventListener('change', handler);
      });
    }
  }

  private destroyDT(): void {
    const el = this.appTable?.nativeElement;
    if (this.clickHandler && el) {
      el.removeEventListener('click', this.clickHandler);
      this.clickHandler = undefined;
    }
    if (this.dataTable) {
      (this.dataTable as { destroy: () => void }).destroy();
      this.dataTable = null;
    }
  }

  // ── Panel ─────────────────────────────────────────────────────────────
  protected openPanel(id: number): void {
    this.panelOpen    = true;
    this.panelLoading = true;
    this.panelError   = '';
    this.detail       = null;
    this.resumeUrl    = null;
    this.resumeRawUrl = null;
    this.scoreResult  = null;
    this.scoreLoading = false;
    this.compMatchedSkills = [];
    this.compMissingSkills = [];
    this.compExtSkills     = [];
    this.compTotalYears    = 0;
    this.interviews        = [];
    this.showScheduleForm  = false;
    this.updatingInterviewId = null;
    this.showFeedbackFormFor = null;
    this.pendingStatus     = '';
    this.cdr.markForCheck();

    this.svc.getAnyApplicationDetail(id, this.isStaff)
      .pipe(timeout(20000))
      .subscribe({
        next: (d) => {
          this.detail       = d;
          this.panelLoading = false;
          if (d.resume) {
            const rawUrl = getResumeFileUrl(d.resume.filePath);
            this.resumeRawUrl    = rawUrl;
            this.resumeUrl       = this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl);
            this.resumeIsPdf     = d.resume.fileType === '.pdf';
            this.resumeOfficeUrl = this.resumeIsPdf ? '' :
              `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(rawUrl)}`;
            this.resumeName = resumeDisplayLabel({
              originalFileName: d.resume.originalFileName,
              filePath:         d.resume.filePath,
              fileType:         d.resume.fileType,
              uploadedAt:       d.resume.uploadedAt
            });
          }
          this.pendingStatus = d.application.status;
          this.computeComparison();
          this.cdr.markForCheck();
          this.loadScore(d.application.id);
          if (this.isStaff) {
            this.loadInterviews(d.application.id);
            this.loadInterviewers();
          }
        },
        error: () => {
          this.panelError   = 'Could not load application details.';
          this.panelLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  private computeComparison(): void {
    if (!this.detail) return;
    const extracted = this.detail.extractedData ?? { skills: [], education: [], experiences: [] };
    const reqSkills = (this.detail.job?.requiredSkills ?? []);
    const extLower  = (extracted.skills ?? []).map(s => s.toLowerCase().trim());

    this.compExtSkills     = extracted.skills ?? [];
    this.compMatchedSkills = reqSkills.filter(s => extLower.includes(s.toLowerCase().trim()));
    this.compMissingSkills = reqSkills.filter(s => !extLower.includes(s.toLowerCase().trim()));
    this.compTotalYears    = (extracted.experiences ?? []).reduce(
      (sum, e) => sum + (e.durationInMonths ?? 0) / 12, 0
    );
  }

  protected loadScore(applicationId: number): void {
    this.scoreLoading = true;
    this.scoreResult  = null;
    this.cdr.markForCheck();
    this.svc.getApplicationScore(applicationId).pipe(
      timeout(30000),
      finalize(() => { this.scoreLoading = false; this.cdr.markForCheck(); })
    ).subscribe({
      next:  (r) => { this.scoreResult = r; this.cdr.markForCheck(); },
      error: ()  => { this.cdr.markForCheck(); }
    });
  }

  protected closePanel(): void {
    this.panelOpen           = false;
    this.detail              = null;
    this.resumeUrl           = null;
    this.resumeRawUrl        = null;
    this.scoreResult         = null;
    this.panelError          = '';
    this.interviews          = [];
    this.feedbackMap         = new Map();
    this.showScheduleForm    = false;
    this.editingInterviewId  = null;
    this.scheduleErrors      = {};
    this.updatingInterviewId = null;
    this.showFeedbackFormFor = null;
    this.cdr.markForCheck();
  }

  // ── Interview management ──────────────────────────────────────────────
  private readonly HR_ONLY_STATUSES = ['Offer Sent', 'Final Hired', 'Final Rejected', 'Final Review'];
  private readonly ALL_APP_STATUSES = [
    'Applied', 'Shortlisted', 'Rejected',
    'Interview Scheduled', 'Interview Passed', 'Interview Failed',
    'On Hold', 'Final Review',
    'Offer Sent', 'Final Hired', 'Final Rejected'
  ];
  readonly INTERVIEW_STATUSES = ['Scheduled', 'Hold', 'Passed', 'Rejected'];
  readonly FEEDBACK_RECS      = ['Hire', 'Reject', 'Next Round'];

  /** Status options filtered by role. HR sees all; recruiter/interviewer see non-terminal ones. */
  get APP_STATUSES(): string[] {
    const current = this.app?.status ?? '';
    const list = this.isHrManagerRole
      ? this.ALL_APP_STATUSES
      : this.ALL_APP_STATUSES.filter(s => !this.HR_ONLY_STATUSES.includes(s));
    if (!this.isHrManagerRole && this.HR_ONLY_STATUSES.includes(current) && !list.includes(current))
      return [current, ...list];
    return list;
  }

  /** Stage summary aggregated from job.interviewStages + loaded interviews */
  get stageSummary() {
    const stages = this.job?.interviewStages ?? [];
    return stages.map(stage => {
      const matched = (this.interviews ?? [])
        .filter(i => i.interviewStageId === stage.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const latest   = matched[0] ?? null;
      const feedbacks = matched.flatMap(i => this.feedbackMap.get(i.id) ?? []);
      return { stageName: stage.stageName, stageId: stage.id, orderIndex: stage.orderIndex,
               interview: latest as CandidateInterviewDto | null, feedbacks };
    });
  }

  protected interviews: CandidateInterviewDto[] = [];
  protected interviewsLoading = false;
  protected interviewers: CompanyInterviewer[] = [];

  // Status change
  protected pendingStatus = '';
  protected statusSaving  = false;

  // Schedule / Edit form (shared for both new schedule and editing existing)
  protected showScheduleForm   = false;
  /** When set, the schedule form is editing this interview (not creating a new one) */
  protected editingInterviewId: number | null = null;
  protected scheduleForm: {
    interviewStageId: number | null;
    interviewerId: string;
    scheduledDateTime: string;
    mode: string;
    meetingLink: string;
    location: string;
    remarks: string;
  } = { interviewStageId: null, interviewerId: '', scheduledDateTime: '', mode: 'Online', meetingLink: '', location: '', remarks: '' };
  protected scheduling = false;
  /** Field-level validation errors for the schedule form */
  protected scheduleErrors: { stage?: string; interviewer?: string; dateTime?: string } = {};

  // Per-interview: status update
  protected updatingInterviewId: number | null = null;
  protected interviewStatusForm: { status: string; score: number | null; remarks: string } = { status: '', score: null, remarks: '' };
  protected interviewStatusSaving = false;

  // Feedback
  protected feedbackMap = new Map<number, InterviewFeedbackDto[]>();
  protected loadingFeedbackFor: number | null = null;
  protected showFeedbackFormFor: number | null = null;
  protected feedbackForm: {
    technicalScore: number | null;
    communicationScore: number | null;
    overallScore: number | null;
    feedback: string;
    recommendation: string;
  } = { technicalScore: null, communicationScore: null, overallScore: null, feedback: '', recommendation: 'Hire' };
  protected feedbackSaving = false;

  protected loadInterviews(applicationId: number): void {
    this.interviewsLoading = true;
    this.interviews = [];
    this.cdr.markForCheck();
    this.itvSvc.getByApplication(applicationId).pipe(
      finalize(() => { this.interviewsLoading = false; this.cdr.markForCheck(); })
    ).subscribe({
      next: (list) => {
        this.interviews = list;
        // Auto-load all feedbacks so stage summary can show them
        list.forEach(itv => {
          if (itv.feedbackCount > 0) this.loadFeedback(itv.id);
        });
        this.cdr.markForCheck();
      },
      error: () => { this.cdr.markForCheck(); }
    });
  }

  /** Open the top form pre-populated with an existing interview's data (edit mode). */
  protected openEditInterview(itv: CandidateInterviewDto): void {
    this.editingInterviewId = itv.id;
    this.scheduleForm = {
      interviewStageId:  itv.interviewStageId ?? null,
      interviewerId:     itv.interviewerId ?? '',
      scheduledDateTime: itv.scheduledDateTime
        ? new Date(itv.scheduledDateTime).toISOString().slice(0, 16) : '',
      mode:        itv.mode ?? 'Online',
      meetingLink: itv.meetingLink ?? '',
      location:    itv.location ?? '',
      remarks:     itv.remarks ?? ''
    };
    this.scheduleErrors = {};
    this.showScheduleForm = true;
    this.loadInterviewers();
    this.cdr.markForCheck();
    // Scroll to the form
    setTimeout(() => {
      document.querySelector('.itv-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  /** Generate and print an offer letter in a new browser window (HR Manager only). */
  protected generateOfferLetter(): void {
    const job  = this.job;
    const cand = this.cand;
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    const salaryRange = (job?.minSalary != null || job?.maxSalary != null)
      ? `₹${(job?.minSalary ?? 0).toLocaleString('en-IN')} – ₹${(job?.maxSalary ?? 0).toLocaleString('en-IN')} per annum`
      : 'As discussed';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Offer Letter – ${cand?.name ?? 'Candidate'}</title>
  <style>
    body { font-family: 'Times New Roman', Times, serif; padding: 60px; max-width: 800px; margin: 0 auto; color: #1a1a1a; line-height: 1.7; font-size: 15px; }
    .logo-header { text-align: center; border-bottom: 3px solid #1e40af; padding-bottom: 16px; margin-bottom: 32px; }
    .company-name { font-size: 28px; font-weight: bold; color: #1e40af; letter-spacing: 1px; }
    .company-sub  { font-size: 13px; color: #555; margin-top: 4px; }
    .date-line { text-align: right; color: #444; margin-bottom: 24px; }
    h1 { font-size: 21px; text-align: center; text-decoration: underline; letter-spacing: 1px; margin-bottom: 28px; }
    .details-table { width: 100%; border-collapse: collapse; margin: 24px 0; }
    .details-table td { padding: 9px 14px; border: 1px solid #ccc; }
    .details-table td:first-child { font-weight: bold; background: #f5f7fb; width: 220px; }
    .signature { margin-top: 70px; }
    .sig-line { border-top: 1px solid #333; width: 220px; margin-top: 40px; padding-top: 6px; }
    @media print { body { padding: 30px; } }
  </style>
</head>
<body>
  <div class="logo-header">
    <div class="company-name">${job?.companyName ?? 'Company'}</div>
    <div class="company-sub">${job?.location ?? ''}</div>
  </div>
  <div class="date-line">Date: ${today}</div>
  <h1>LETTER OF OFFER</h1>
  <p>Dear <strong>${cand?.name ?? 'Candidate'}</strong>,</p>
  <p>
    We are pleased to offer you the position of <strong>${job?.jobTitle ?? 'Position'}</strong>
    at <strong>${job?.companyName ?? 'the Company'}</strong>, subject to the terms and conditions outlined below.
  </p>
  <table class="details-table">
    <tr><td>Position</td><td>${job?.jobTitle ?? '—'}</td></tr>
    <tr><td>Employment Type</td><td>${job?.employmentType ?? '—'}</td></tr>
    <tr><td>Location / Work Mode</td><td>${job?.location ?? '—'} (${job?.workMode ?? 'On-site'})</td></tr>
    <tr><td>Annual Compensation</td><td>${salaryRange}</td></tr>
    <tr><td>Date of Joining</td><td>To be mutually agreed upon</td></tr>
  </table>
  <p>
    This offer is contingent upon satisfactory completion of background verification, reference checks,
    and submission of required documents as specified by the HR department.
  </p>
  <p>
    Kindly sign and return a copy of this letter by <strong>${deadline}</strong> to confirm your acceptance.
    If you have any questions, please do not hesitate to contact us.
  </p>
  <p>We look forward to welcoming you to our team!</p>
  <div class="signature">
    <p>Yours sincerely,</p>
    <div class="sig-line">
      <strong>HR Manager</strong><br>
      ${job?.companyName ?? 'Company'}
    </div>
  </div>
  <hr style="margin-top:60px; border-color:#ccc;">
  <p style="font-size:12px; color:#888; text-align:center;">
    Candidate Acknowledgement: I, <strong>${cand?.name ?? '____________________'}</strong>,
    accept the above offer.&nbsp;&nbsp;&nbsp;
    Signature: ___________________________&nbsp;&nbsp;&nbsp; Date: _______________
  </p>
</body>
</html>`;

    const w = window.open('', '_blank', 'width=960,height=720');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600); }
  }

  protected loadInterviewers(): void {
    if (this.interviewers.length) return;
    this.itvSvc.getCompanyInterviewers().subscribe({
      next: (list) => { this.interviewers = list; this.cdr.markForCheck(); },
      error: ()    => { this.cdr.markForCheck(); }
    });
  }

  protected saveApplicationStatus(): void {
    if (!this.app || !this.pendingStatus) return;
    this.statusSaving = true;
    this.cdr.markForCheck();
    this.itvSvc.updateApplicationStatus(this.app.id, { status: this.pendingStatus }).pipe(
      finalize(() => { this.statusSaving = false; this.cdr.markForCheck(); })
    ).subscribe({
      next: (r) => {
        if (this.detail?.application) this.detail.application.status = r.status;
        this.cdr.markForCheck();
        // reload table row too
        const row = this.tableRows.find(x => x.id === this.app!.id);
        if (row) row.status = r.status;
      },
      error: () => { this.cdr.markForCheck(); }
    });
  }

  protected openScheduleForm(): void {
    this.editingInterviewId = null;   // new schedule (not edit)
    this.showScheduleForm = true;
    this.scheduleForm = { interviewStageId: null, interviewerId: '', scheduledDateTime: '', mode: 'Online', meetingLink: '', location: '', remarks: '' };
    this.scheduleErrors = {};
    this.loadInterviewers();
    this.cdr.markForCheck();
  }

  protected cancelScheduleForm(): void {
    this.showScheduleForm   = false;
    this.editingInterviewId = null;
    this.scheduleErrors     = {};
    this.cdr.markForCheck();
  }

  protected submitSchedule(): void {
    if (!this.app) return;

    // ── Validate ────────────────────────────────────────────────────────
    this.scheduleErrors = {};
    if (!this.scheduleForm.interviewStageId)
      this.scheduleErrors['stage'] = 'Stage is required.';
    if (!this.scheduleForm.interviewerId)
      this.scheduleErrors['interviewer'] = 'Interviewer / Assignee is required.';
    if (!this.scheduleForm.scheduledDateTime)
      this.scheduleErrors['dateTime'] = 'Date & Time is required.';
    if (Object.keys(this.scheduleErrors).length) {
      this.cdr.markForCheck();
      return;
    }

    this.scheduling = true;
    this.cdr.markForCheck();

    // ── Edit mode: PATCH existing interview ─────────────────────────────
    if (this.editingInterviewId != null) {
      const patchReq: UpdateInterviewDetailsRequest = {
        interviewerId:     this.scheduleForm.interviewerId || null,
        scheduledDateTime: this.scheduleForm.scheduledDateTime || null,
        mode:              this.scheduleForm.mode,
        meetingLink:       this.scheduleForm.meetingLink || null,
        location:          this.scheduleForm.location || null,
        remarks:           this.scheduleForm.remarks || null,
        interviewStageId:  this.scheduleForm.interviewStageId ?? null
      };
      this.itvSvc.updateDetails(this.editingInterviewId, patchReq).pipe(
        finalize(() => { this.scheduling = false; this.cdr.markForCheck(); })
      ).subscribe({
        next: () => {
          this.showScheduleForm   = false;
          this.editingInterviewId = null;
          if (this.app) this.loadInterviews(this.app.id);
          this.cdr.markForCheck();
        },
        error: () => { this.cdr.markForCheck(); }
      });
      return;
    }

    // ── Create mode: POST new schedule ──────────────────────────────────
    const req: import('../../services/candidate-interview.service').ScheduleInterviewRequest = {
      jobApplicationId:  this.app.id,
      interviewStageId:  this.scheduleForm.interviewStageId,
      interviewerId:     this.scheduleForm.interviewerId || null,
      scheduledDateTime: this.scheduleForm.scheduledDateTime || null,
      mode:              this.scheduleForm.mode,
      meetingLink:       this.scheduleForm.meetingLink || null,
      location:          this.scheduleForm.location || null,
      remarks:           this.scheduleForm.remarks || null
    };
    this.itvSvc.schedule(req).pipe(
      finalize(() => { this.scheduling = false; this.cdr.markForCheck(); })
    ).subscribe({
      next: (res) => {
        this.showScheduleForm = false;
        if (this.detail?.application) this.detail.application.status = res.appStatus;
        this.loadInterviews(this.app!.id);
        this.cdr.markForCheck();
      },
      error: () => { this.cdr.markForCheck(); }
    });
  }

  protected openInterviewStatusEdit(itv: CandidateInterviewDto): void {
    this.updatingInterviewId = itv.id;
    this.interviewStatusForm = { status: itv.status, score: itv.score ?? null, remarks: itv.remarks ?? '' };
    this.cdr.markForCheck();
  }

  protected saveInterviewStatus(): void {
    if (this.updatingInterviewId == null) return;
    this.interviewStatusSaving = true;
    this.cdr.markForCheck();
    this.itvSvc.updateStatus(this.updatingInterviewId, {
      status:  this.interviewStatusForm.status,
      score:   this.interviewStatusForm.score,
      remarks: this.interviewStatusForm.remarks || null
    }).pipe(
      finalize(() => { this.interviewStatusSaving = false; this.cdr.markForCheck(); })
    ).subscribe({
      next: () => {
        this.updatingInterviewId = null;
        if (this.app) this.loadInterviews(this.app.id);
        this.cdr.markForCheck();
      },
      error: () => { this.cdr.markForCheck(); }
    });
  }

  protected loadFeedback(interviewId: number): void {
    this.loadingFeedbackFor = interviewId;
    this.cdr.markForCheck();
    this.itvSvc.getFeedback(interviewId).pipe(
      finalize(() => { this.loadingFeedbackFor = null; this.cdr.markForCheck(); })
    ).subscribe({
      next: (fb) => { this.feedbackMap.set(interviewId, fb); this.cdr.markForCheck(); },
      error: ()  => { this.cdr.markForCheck(); }
    });
  }

  protected openFeedbackForm(interviewId: number): void {
    this.showFeedbackFormFor = interviewId;
    this.feedbackForm = { technicalScore: null, communicationScore: null, overallScore: null, feedback: '', recommendation: 'Hire' };
    this.cdr.markForCheck();
  }

  protected submitFeedback(): void {
    if (this.showFeedbackFormFor == null) return;
    this.feedbackSaving = true;
    this.cdr.markForCheck();
    this.itvSvc.submitFeedback(this.showFeedbackFormFor, {
      technicalScore:     this.feedbackForm.technicalScore,
      communicationScore: this.feedbackForm.communicationScore,
      overallScore:       this.feedbackForm.overallScore,
      feedback:           this.feedbackForm.feedback || null,
      recommendation:     this.feedbackForm.recommendation
    }).pipe(
      finalize(() => { this.feedbackSaving = false; this.cdr.markForCheck(); })
    ).subscribe({
      next: () => {
        const id = this.showFeedbackFormFor!;
        this.showFeedbackFormFor = null;
        this.loadFeedback(id);
        if (this.app) this.loadInterviews(this.app.id);
        this.cdr.markForCheck();
      },
      error: () => { this.cdr.markForCheck(); }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  protected getStatusClass(s: string): string {
    switch ((s ?? '').toLowerCase()) {
      case 'shortlisted': return 'text-bg-success';
      case 'reviewed':    return 'text-bg-info';
      case 'rejected':    return 'text-bg-danger';
      default:            return 'text-bg-secondary';
    }
  }

  protected formatDate(v: string | null | undefined): string {
    return v ? new Date(v).toLocaleString() : '—';
  }

  protected formatDateShort(v: string | null | undefined): string {
    return v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  protected getCompanyInitials(name?: string | null): string {
    if (!name) return 'J';
    return name.split(' ').slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
  }

  protected get app()  { return this.detail?.application ?? null; }
  protected get cand() { return this.detail?.candidate   ?? null; }
  protected get job()  { return this.detail?.job         ?? null; }
  protected get extractedData() { return this.detail?.extractedData ?? null; }
  protected get tableTitle(): string {
    return this.isStaff ? 'Applications Review' : 'My Applications';
  }

  /**
   * Interview assessment rows: one row per interview (across all stages),
   * enriched with feedback loaded in feedbackMap. Used in the Interview
   * Assessment scoring section so HR sees T/C/O scores + recommendation.
   */
  get interviewAssessmentRows(): Array<{
    id: number; stageName: string | null; stageOrder: number | null;
    interviewerName: string | null; scheduledDateTime: string | null;
    status: string; score: number | null; remarks: string | null;
    feedbacks: InterviewFeedbackDto[];
    avgTech: number | null; avgComm: number | null; avgOverall: number | null;
  }> {
    return (this.interviews ?? []).map(itv => {
      const fbs = this.feedbackMap.get(itv.id) ?? [];
      const avg = (key: keyof InterviewFeedbackDto) => {
        const vals = fbs.map(f => f[key] as number | null | undefined).filter(v => v != null) as number[];
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      };
      return {
        id:                itv.id,
        stageName:         itv.stageName ?? null,
        stageOrder:        itv.stageOrder ?? null,
        interviewerName:   itv.interviewerName ?? null,
        scheduledDateTime: itv.scheduledDateTime ?? null,
        status:            itv.status,
        score:             itv.score ?? null,
        remarks:           itv.remarks ?? null,
        feedbacks:         fbs,
        avgTech:           avg('technicalScore'),
        avgComm:           avg('communicationScore'),
        avgOverall:        avg('overallScore')
      };
    });
  }

  protected interviewerRoleLabel(iv: import('../../services/candidate-interview.service').CompanyInterviewer): string {
    if (iv.isHr) return 'HR';
    if (iv.isRecruiter) return 'Recruiter';
    if (iv.isInterviewer) return 'Interviewer';
    return '';
  }
}
