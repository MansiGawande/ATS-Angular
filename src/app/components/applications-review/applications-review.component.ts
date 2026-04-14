import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component,
  ElementRef, OnDestroy, OnInit, ViewChild, inject
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import DataTable from 'datatables.net-bs5';
import { finalize, timeout } from 'rxjs';
import {
  AllApplicationDto, ApplicationDetailStaff,
  ApplicationScoreResult, JobApplicationService
} from '../../services/job-application.service';
import { SessionCookieService } from '../../services/session-cookie.service';
import { AtsScoreDetailComponent } from '../ats-score-detail/ats-score-detail.component';
import { getResumeFileUrl, resumeDisplayLabel } from '../../services/resume.service';

type TableRow = AllApplicationDto & { appliedMs: number; appliedLabel: string };

@Component({
  selector: 'app-applications-review',
  imports: [AtsScoreDetailComponent, DecimalPipe],
  templateUrl: './applications-review.component.html',
  styleUrl: './applications-review.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ApplicationsReviewComponent implements OnInit, OnDestroy {
  @ViewChild('appTable', { static: true })
  protected appTable?: ElementRef<HTMLTableElement>;

  private readonly svc  = inject(JobApplicationService);
  private readonly session = inject(SessionCookieService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cdr  = inject(ChangeDetectorRef);

  protected applications: AllApplicationDto[] = [];
  protected tableRows: TableRow[] = [];
  protected isLoading   = false;
  protected errorMessage = '';

  // ── Detail panel ────────────────────────────────────────────────────
  protected panelOpen    = false;
  protected panelLoading = false;
  protected panelError   = '';
  protected detail: ApplicationDetailStaff | null = null;

  protected resumeUrl: SafeResourceUrl | null = null;
  protected resumeRawUrl: string | null = null;
  protected resumeIsPdf  = false;
  protected resumeOfficeUrl = '';
  protected resumeName = '';

  // ── ATS Score ────────────────────────────────────────────────────────
  protected scoreResult: ApplicationScoreResult | null = null;
  protected scoreLoading = false;

  // ── Role flags ────────────────────────────────────────────────────────
  private readonly roles = this.session.getRoles().map(r => r.toLowerCase());
  protected readonly isAdmin       = this.roles.includes('admin');
  protected readonly isCandidate   = this.roles.includes('candidate');
  // Candidates and admins see simple view; recruiters/HR/interviewers see full
  protected readonly showFullScore = !this.isAdmin && !this.isCandidate;

private dataTable: any = null;
  private clickHandler?: (e: Event) => void;

  // ── Lifecycle ────────────────────────────────────────────────────────

  ngOnInit(): void { this.load(); }

  ngOnDestroy(): void { this.destroyDT(); }

  // ── Data ─────────────────────────────────────────────────────────────

  private load(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.destroyDT();
    this.cdr.markForCheck();

    this.svc.getAllApplications()
      .pipe(
        timeout(20000),
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
          this.cdr.detectChanges();
          this.initDT();
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage = 'Unable to load applications.';
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

    this.dataTable = new DataTable(el, {
      data:       this.tableRows,
      searching:  true,
      paging:     true,
      pageLength: 10,
      lengthMenu: [5, 10, 25, 50],
      order:      [[4, 'desc']],
      columns: [
        {
          data: 'candidateName', title: 'Candidate', defaultContent: '—',
          render: (v: string | null, _t: string, row: AllApplicationDto) => {
            const name  = v ?? row.candidateEmail ?? '—';
            const email = row.candidateEmail ? `<div class="small text-muted">${row.candidateEmail}</div>` : '';
            return `<div>${name}${email}</div>`;
          }
        },
        { data: 'jobTitle',    title: 'Job Title' },
        { data: 'companyName', title: 'Company' },
        {
          data: 'resumeDisplayName', title: 'Resume', defaultContent: '—',
          render: (_v: string | null, _t: string, row: AllApplicationDto) => {
            if (!row.resumeFilePath) return '<span class="text-muted small">—</span>';
            const url  = getResumeFileUrl(row.resumeFilePath);
            const name = (row.resumeDisplayName ?? 'Resume').replace(/"/g, '&quot;');
            return `<a href="${encodeURI(url)}" target="_blank" rel="noopener"
                       class="dt-resume-link" title="${name}"> ${name}</a>`;
          }
        },
        {
          data: 'appliedMs', title: 'Applied On',
          render: (_v: number, _t: string, row: TableRow) => row.appliedLabel
        },
        {
          data: 'matchScore', title: 'ATS Score', defaultContent: '—',
          render: (v: number | null) => {
            if (v == null) return '<span class="text-muted small">Pending</span>';
            const color = v >= 80 ? '#16a34a' : v >= 60 ? '#2563eb' : v >= 40 ? '#d97706' : '#dc2626';
            return `<span class="dt-score-badge" style="background:${color}">${Math.round(v)}%</span>`;
          }
        },
        {
          data: 'status', title: 'Status',
          render: (v: string) => `<span class="badge rounded-pill ${this.getStatusClass(v)}">${v}</span>`
        },
        {
          data: null, title: '', orderable: false, searchable: false,
          render: (_: unknown, __: unknown, row: AllApplicationDto) =>
            `<button type="button" class="btn btn-sm btn-outline-primary"
               data-action="view" data-app-id="${row.id}">View</button>`
        }
      ],
      language: { emptyTable: 'No applications found.' }
    });

    // Column-wise filter wiring
    const filters = el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-col]');
    filters.forEach(filter => {
      const handler = () => {
        if (!this.dataTable) return;
        const col = Number(filter.dataset['col']);
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

  private destroyDT(): void {
    const el = this.appTable?.nativeElement;
    if (this.clickHandler && el) { el.removeEventListener('click', this.clickHandler); this.clickHandler = undefined; }
    if (this.dataTable) { this.dataTable.destroy(); this.dataTable = null; }
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
    this.cdr.markForCheck();

    this.svc.getApplicationDetail(id)
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
              filePath:  d.resume.filePath,
              fileType:  d.resume.fileType,
              uploadedAt: d.resume.uploadedAt
            });
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.panelError   = 'Could not load application details.';
          this.panelLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  protected loadScore(applicationId: number): void {
    this.scoreLoading = true;
    this.scoreResult  = null;
    this.cdr.markForCheck();

    this.svc.getApplicationScore(applicationId)
      .pipe(
        timeout(20000),
        finalize(() => { this.scoreLoading = false; this.cdr.markForCheck(); })
      )
      .subscribe({
        next: (r) => { this.scoreResult = r; this.cdr.markForCheck(); },
        error: () => { this.cdr.markForCheck(); }
      });
  }

  protected closePanel(): void {
    this.panelOpen   = false;
    this.detail      = null;
    this.resumeUrl   = null;
    this.resumeRawUrl = null;
    this.scoreResult  = null;
    this.panelError   = '';
    this.cdr.markForCheck();
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
    if (!v) return '—';
    return new Date(v).toLocaleString();
  }

  protected formatDateShort(v: string | null | undefined): string {
    if (!v) return '—';
    return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected get app()  { return this.detail?.application ?? null; }
  protected get cand() { return this.detail?.candidate ?? null; }
  protected get job()  { return this.detail?.job ?? null; }
}
