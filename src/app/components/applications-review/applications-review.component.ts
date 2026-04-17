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
  CandidateInterviewDto, CompanyInterviewer, InterviewFeedbackDto
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
  private readonly roles      = this.session.getRoles().map(r => r.toLowerCase());
  protected readonly isAdmin     = this.roles.includes('admin');
  protected readonly isCandidate = this.roles.includes('candidate');
  protected readonly isStaff     = this.roles.includes('hrmanager') ||
                                    this.roles.includes('recruiter') ||
                                    this.roles.includes('interviewer');

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
          const color = v >= 80 ? '#16a34a' : v >= 60 ? '#2563eb' : v >= 40 ? '#d97706' : '#dc2626';
          return `<span class="dt-score-badge" style="background:${color}">${Math.round(v)}%</span>`;
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
    this.showScheduleForm    = false;
    this.updatingInterviewId = null;
    this.showFeedbackFormFor = null;
    this.cdr.markForCheck();
  }

  // ── Interview management ──────────────────────────────────────────────
  readonly APP_STATUSES = [
    'Applied', 'Shortlisted', 'Rejected',
    'Interview Scheduled', 'Interview Passed', 'Interview Failed',
    'Offer Sent', 'Hired', 'On Hold'
  ];
  readonly INTERVIEW_STATUSES = ['Scheduled', 'Completed', 'Passed', 'Rejected'];
  readonly FEEDBACK_RECS      = ['Hire', 'Reject', 'Next Round'];

  protected interviews: CandidateInterviewDto[] = [];
  protected interviewsLoading = false;
  protected interviewers: CompanyInterviewer[] = [];

  // Status change
  protected pendingStatus = '';
  protected statusSaving  = false;

  // Schedule form
  protected showScheduleForm = false;
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
      next: (list) => { this.interviews = list; this.cdr.markForCheck(); },
      error: ()    => { this.cdr.markForCheck(); }
    });
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
    this.showScheduleForm = true;
    this.scheduleForm = { interviewStageId: null, interviewerId: '', scheduledDateTime: '', mode: 'Online', meetingLink: '', location: '', remarks: '' };
    this.loadInterviewers();
    this.cdr.markForCheck();
  }

  protected submitSchedule(): void {
    if (!this.app) return;
    this.scheduling = true;
    this.cdr.markForCheck();

    const req: import('../../services/candidate-interview.service').ScheduleInterviewRequest = {
      jobApplicationId: this.app.id,
      interviewStageId: this.scheduleForm.interviewStageId,
      interviewerId:    this.scheduleForm.interviewerId || null,
      scheduledDateTime: this.scheduleForm.scheduledDateTime || null,
      mode:             this.scheduleForm.mode,
      meetingLink:      this.scheduleForm.meetingLink || null,
      location:         this.scheduleForm.location || null,
      remarks:          this.scheduleForm.remarks || null
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
}
