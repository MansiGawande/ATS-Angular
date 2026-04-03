import { ChangeDetectorRef, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import DataTable from 'datatables.net-bs5';
import { finalize, timeout } from 'rxjs';
import { JobApplicationService, MyApplicationDto } from '../../services/job-application.service';
import { SessionCookieService } from '../../services/session-cookie.service';
import { getResumeFileUrl, resumeDisplayLabel } from '../../services/resume.service';

type TableRow = MyApplicationDto & { appliedMs: number; appliedLabel: string };

// Shape returned by GET /api/applications/my/{id}/detail (now includes job)
type ViewDetail = {
  application: {
    id: number; jobId: number; resumeId: number | null;
    status: string; appliedAt: string; coverNote: string | null; matchScore?: number | null;
  };
  resume: {
    resumeId: number; originalFileName: string | null;
    filePath: string; fileType: string; uploadedAt: string;
  } | null;
  job: {
    jobId: number; jobTitle: string; description: string;
    employmentType?: string | null; experienceLevel?: string | null;
    experienceRequired?: string | null; educationRequirement?: string | null;
    minSalary?: number | null; maxSalary?: number | null;
    location?: string | null; workMode?: string | null;
    isRemote?: boolean; numberOfOpenings?: number;
    applicationDeadline?: string | null; status?: string;
    createdAt?: string; isActive?: boolean;
    companyName?: string | null; companyIndustry?: string | null;
    companyWebsite?: string | null; companyEmail?: string | null;
    companyAddress?: string | null; companyProfilePicture?: string | null;
    requiredSkills?: string[] | null;
    interviewStages?: Array<{ id: number; stageName: string; orderIndex: number }> | null;
  } | null;
};

@Component({
  selector: 'app-my-applications',
  templateUrl: './my-applications.component.html',
  styleUrl: './my-applications.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MyApplicationsComponent implements OnInit, OnDestroy {
  @ViewChild('applicationsTable', { static: true })
  protected applicationsTable?: ElementRef<HTMLTableElement>;

  private readonly jobApplicationService = inject(JobApplicationService);
  private readonly sessionCookieService  = inject(SessionCookieService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router    = inject(Router);
  private readonly cdr       = inject(ChangeDetectorRef);
  private readonly requestTimeoutMs = 20000;

  private dataTable: any = null;
  private clickHandler?: (e: Event) => void;

  protected applications: MyApplicationDto[] = [];
  protected tableRows: TableRow[] = [];
  protected isLoading  = false;
  protected errorMessage = '';

  // ── View detail state ────────────────────────────────────────────────
  protected viewOpen    = false;
  protected viewLoading = false;
  protected viewError   = '';
  protected viewDetail: ViewDetail | null = null;

  protected viewResumeUrl: SafeResourceUrl | null = null;
  protected viewResumeRawUrl: string | null = null;
  protected viewResumeIsPdf  = false;
  protected viewResumeOfficeUrl = '';
  protected viewResumeName = '';

  // ── Computed helpers ─────────────────────────────────────────────────
  protected get viewApp()  { return this.viewDetail?.application ?? null; }
  protected get viewJob()  { return this.viewDetail?.job ?? null; }

  ngOnInit(): void {
    const isCandidate = this.sessionCookieService
      .getRoles().map(r => r.toLowerCase()).includes('candidate');

    if (!isCandidate) {
      void this.router.navigate(['/admin-dashboard']);
      return;
    }
    this.loadApplications();
  }

  ngOnDestroy(): void {
    this.destroyDataTable();
  }

  // ── Formatters ───────────────────────────────────────────────────────

  protected formatDate(value: string | null | undefined): string {
    if (!value) return '-';
    return new Date(value).toLocaleString();
  }

  protected formatDateShort(value: string | null | undefined): string {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected getStatusClass(status: string): string {
    switch ((status ?? '').toLowerCase()) {
      case 'shortlisted': return 'text-bg-success';
      case 'reviewed':    return 'text-bg-info';
      case 'rejected':    return 'text-bg-danger';
      default:            return 'text-bg-secondary';
    }
  }

  protected getCompanyInitials(name: string | null | undefined): string {
    const words = (name ?? '').split(' ').filter(w => w.length > 0);
    if (!words.length) return 'CO';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  // ── Close view ───────────────────────────────────────────────────────

  protected closeView(): void {
    this.viewOpen         = false;
    this.viewDetail       = null;
    this.viewResumeUrl    = null;
    this.viewResumeRawUrl = null;
    this.viewResumeOfficeUrl = '';
    this.viewResumeName   = '';
    this.viewError        = '';
    this.cdr.markForCheck();
  }

  // ── Load applications ────────────────────────────────────────────────

  private loadApplications(): void {
    this.isLoading     = true;
    this.errorMessage  = '';
    this.destroyDataTable();
    this.cdr.markForCheck();

    this.jobApplicationService.getMyApplications()
      .pipe(
        timeout(this.requestTimeoutMs),
        finalize(() => { this.isLoading = false; this.cdr.markForCheck(); })
      )
      .subscribe({
        next: (apps) => {
          this.applications = apps;
          this.tableRows = apps.map(a => ({
            ...a,
            appliedMs:    new Date(a.appliedAt).getTime(),
            appliedLabel: new Date(a.appliedAt).toLocaleString()
          }));
          this.cdr.detectChanges();          // flush DOM before DataTable init
          this.initDataTable();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.errorMessage = (err?.status === 401)
            ? 'Session expired. Please log in again.'
            : 'Unable to load your applications. Please refresh the page.';
          this.cdr.markForCheck();
        }
      });
  }

  // ── DataTable ────────────────────────────────────────────────────────

  private initDataTable(): void {
    const el = this.applicationsTable?.nativeElement;
    if (!el) return;

    this.destroyDataTable();

    this.clickHandler = (event: Event) => {
      const btn = (event.target as HTMLElement)
        .closest('button[data-action="view"]') as HTMLButtonElement | null;
      if (!btn) return;
      const id = Number(btn.dataset['applicationId']);
      if (Number.isFinite(id)) this.openView(id);
    };
    el.addEventListener('click', this.clickHandler);

    this.dataTable = new DataTable(el, {
      data:        this.tableRows,
      searching:   true,
      paging:      true,
      pageLength:  10,
      lengthMenu:  [5, 10, 25, 50],
      order:       [[3, 'desc']],
      columns: [
        { data: 'jobTitle',     title: 'Job Title' },
        { data: 'companyName',  title: 'Company' },
        {
          data: 'resumeDisplayName', title: 'Resume Used', defaultContent: '-',
          render: (v: string | null) => v
            ? `<span class="text-truncate d-inline-block" style="max-width:180px" title="${v}">${v}</span>` : '-'
        },
        {
          data: 'appliedMs', title: 'Applied On',
          render: (_v: number, _t: string, row: TableRow) => row.appliedLabel
        },
        {
          data: 'status', title: 'Status',
          render: (v: string) => {
            const cls = this.getStatusClass(v);
            return `<span class="badge rounded-pill ${cls}">${v}</span>`;
          }
        },
        {
          data: null, title: '', orderable: false, searchable: false,
          render: (_: unknown, __: unknown, row: MyApplicationDto) =>
            `<button type="button" class="btn btn-sm btn-outline-primary"
               data-action="view" data-application-id="${row.id}">View</button>`
        }
      ],
      language: { emptyTable: 'You have not applied to any jobs yet.' }
    });

    // Column-wise search filters
    const filters = el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-app-column]');
    filters.forEach(filter => {
      const handler = () => {
        if (!this.dataTable) return;
        const col = Number(filter.dataset['appColumn']);
        if (Number.isNaN(col)) return;
        const val = (filter as HTMLSelectElement).value;
        if (filter instanceof HTMLSelectElement) {
          this.dataTable.column(col).search(val === 'all' ? '' : `^${val}$`, val !== 'all', false).draw();
        } else {
          this.dataTable.column(col).search(val).draw();
        }
      };
      filter.addEventListener('keyup', handler);
      filter.addEventListener('change', handler);
    });
  }

  private destroyDataTable(): void {
    const el = this.applicationsTable?.nativeElement;
    if (this.clickHandler && el) {
      el.removeEventListener('click', this.clickHandler);
      this.clickHandler = undefined;
    }
    if (this.dataTable) {
      this.dataTable.destroy();
      this.dataTable = null;
    }
  }

  // ── Open view detail ─────────────────────────────────────────────────

  private openView(applicationId: number): void {
    this.viewOpen       = true;
    this.viewLoading    = true;
    this.viewError      = '';
    this.viewDetail     = null;
    this.viewResumeUrl  = null;
    this.viewResumeRawUrl = null;
    this.viewResumeName = '';
    this.cdr.markForCheck();

    this.jobApplicationService.getMyApplicationDetail(applicationId)
      .pipe(timeout(this.requestTimeoutMs))
      .subscribe({
        next: (detail) => {
          // Store full detail (job + application + resume)
          this.viewDetail = detail as ViewDetail;

          // Resume URLs
          if (detail.resume) {
            const rawUrl = getResumeFileUrl(detail.resume.filePath);
            this.viewResumeRawUrl  = rawUrl;
            this.viewResumeUrl     = this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl);
            this.viewResumeIsPdf   = detail.resume.fileType === '.pdf';
            this.viewResumeOfficeUrl = this.viewResumeIsPdf ? '' :
              `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(rawUrl)}`;
            this.viewResumeName = resumeDisplayLabel({
              originalFileName: detail.resume.originalFileName,
              filePath:  detail.resume.filePath,
              fileType:  detail.resume.fileType,
              uploadedAt: detail.resume.uploadedAt
            });
          }

          this.viewLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.viewError   = 'Could not load application details. Please try again.';
          this.viewLoading = false;
          this.cdr.markForCheck();
        }
      });
  }
}
