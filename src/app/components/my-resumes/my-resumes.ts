import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import DataTable from 'datatables.net-bs5';
import { Subscription, finalize, timeout } from 'rxjs';
import { AuthService, MyProfileResponse } from '../../services/auth.service';
import { ResumeDto, ResumeService, getResumeFileUrl, resumeDisplayLabel } from '../../services/resume.service';
import { SessionCookieService } from '../../services/session-cookie.service';

type ResumeRow = ResumeDto & {
  displayName: string;
  uploadedMs: number;
  uploadedLabel: string;
  activeLabel: string;
  parsedLabel: string;
};

@Component({
  selector: 'app-my-resumes',
  templateUrl: './my-resumes.html',
  styleUrl: './my-resumes.css'
})
export class MyResumes implements OnInit, OnDestroy {
  @ViewChild('resumesDataTable') protected resumesDataTable?: ElementRef<HTMLTableElement>;

  private readonly resumeService = inject(ResumeService);
  private readonly authService = inject(AuthService);
  private readonly sessionCookieService = inject(SessionCookieService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly cdr = inject(ChangeDetectorRef);

  private dataTable: any = null;
  private tableClickHandler?: (e: Event) => void;
  private querySub?: Subscription;
  private previewBlobRawUrl: string | null = null;

  protected resumes: ResumeDto[] = [];
  protected tableRows: ResumeRow[] = [];
  protected isLoading = false;
  protected errorMessage = '';
  protected selectedPreview: ResumeDto | null = null;
  protected previewBlobSafeUrl: SafeResourceUrl | null = null;

  protected showUploadModal = false;
  protected uploadProfile: MyProfileResponse | null = null;
  protected isLoadingUploadProfile = false;
  protected uploadFile: File | null = null;
  protected uploadError = '';
  protected isUploading = false;
  protected uploadSuccessMessage = '';

  private readonly requestTimeoutMs = 20000;

  protected readonly isCandidate = this.sessionCookieService
    .getRoles()
    .map((r) => r.toLowerCase())
    .includes('candidate');

  ngOnInit(): void {
    if (!this.isCandidate) {
      void this.router.navigate(['/admin-dashboard']);
      return;
    }

    this.querySub = this.route.queryParamMap.subscribe((params) => {
      const previewId = params.get('preview');
      if (previewId) {
        const id = Number(previewId);
        if (Number.isFinite(id)) {
          this.applyPreviewById(id);
        }
      }
      this.cdr.markForCheck();
    });

    this.loadResumes();
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
    this.destroyDataTable();
    this.revokePreviewBlob();
  }

  protected resumeDisplayLabel(r: ResumeDto): string {
    return resumeDisplayLabel(r);
  }

  /** Safe URL for [data] binding on <object> (PDF embed). */
  protected getSafePreviewUrl(resume: ResumeDto): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(getResumeFileUrl(resume.filePath));
  }

  /** Plain Office Online URL (opens in new tab) – only works with publicly hosted files. */
  protected getOfficeOnlineUrl(resume: ResumeDto): string {
    const fileUrl = getResumeFileUrl(resume.filePath);
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(fileUrl)}`;
  }

  /** Plain file URL for [href] download links. */
  protected getPreviewUrl(resume: ResumeDto): string {
    return getResumeFileUrl(resume.filePath);
  }

  /** Suggested filename for the browser `download` attribute. */
  protected getDownloadName(resume: ResumeDto): string {
    const name = resume.originalFileName?.trim();
    if (name) return name;
    const ext = (resume.fileType || '').replace('.', '');
    const ts = resume.uploadedAt ? new Date(resume.uploadedAt).toISOString().slice(0, 10) : 'resume';
    return `resume-${ts}${ext ? '.' + ext : ''}`;
  }

  protected isPdf(resume: ResumeDto): boolean {
    return resume.fileType === '.pdf';
  }

  protected isDocx(resume: ResumeDto): boolean {
    return resume.fileType === '.docx' || resume.fileType === '.doc';
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  protected openUploadModal(): void {
    this.showUploadModal = true;
    this.uploadFile = null;
    this.uploadError = '';
    this.uploadSuccessMessage = '';
    this.revokePreviewBlob();
    const token = this.sessionCookieService.getToken();
    if (!token) return;
    this.isLoadingUploadProfile = true;
    this.authService
      .getMyProfile(token)
      .pipe(timeout(10000), finalize(() => { this.isLoadingUploadProfile = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (p) => {
          this.uploadProfile = p;
          this.cdr.markForCheck();
        },
        error: () => {
          this.uploadError = 'Could not load your profile.';
          this.cdr.markForCheck();
        }
      });
    this.cdr.markForCheck();
  }

  protected closeUploadModal(): void {
    this.showUploadModal = false;
    this.uploadProfile = null;
    this.uploadFile = null;
    this.uploadError = '';
    this.uploadSuccessMessage = '';
    this.revokePreviewBlob();
    this.cdr.markForCheck();
  }

  protected onUploadFilePick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.revokePreviewBlob();
    this.uploadFile = null;
    this.uploadError = '';
    if (!file) {
      this.cdr.markForCheck();
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['pdf', 'doc', 'docx'].includes(ext)) {
      this.uploadError = 'Only PDF, DOC, or DOCX files are allowed.';
      this.cdr.markForCheck();
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.uploadError = 'Max file size is 10 MB.';
      this.cdr.markForCheck();
      return;
    }
    this.uploadFile = file;
    if (ext === 'pdf') {
      this.previewBlobRawUrl = URL.createObjectURL(file);
      this.previewBlobSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewBlobRawUrl);
    }
    this.cdr.markForCheck();
  }

  protected submitUpload(): void {
    if (!this.uploadFile || this.isUploading) return;
    this.isUploading = true;
    this.uploadError = '';
    this.resumeService
      .uploadResume(this.uploadFile)
      .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isUploading = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: () => {
          this.uploadSuccessMessage = 'Resume uploaded successfully! Redirecting to Job Feed...';
          this.cdr.markForCheck();
          setTimeout(() => {
            this.closeUploadModal();
            void this.router.navigate(['/admin-dashboard/candidate-jobs']);
          }, 1800);
        },
        error: () => {
          this.uploadError = 'Upload failed. Please try again.';
          this.cdr.markForCheck();
        }
      });
  }

  protected selectPreview(resume: ResumeDto): void {
    this.selectedPreview = resume;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { preview: resume.resumeId },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.cdr.markForCheck();
  }

  private applyPreviewById(id: number): void {
    const found = this.resumes.find((r) => r.resumeId === id);
    if (found) {
      this.selectedPreview = found;
    }
  }

  private loadResumes(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.destroyDataTable();
    this.cdr.markForCheck();

    this.resumeService
      .getMyResumes()
      .pipe(timeout(this.requestTimeoutMs), finalize(() => { this.isLoading = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (list) => {
          this.resumes = list;
          this.tableRows = list.map((r) => this.toRow(r));
          const previewParam = this.route.snapshot.queryParamMap.get('preview');
          if (previewParam) {
            this.applyPreviewById(Number(previewParam));
          } else if (list.length > 0 && !this.selectedPreview) {
            this.selectedPreview = list[0];
          }
          setTimeout(() => this.initDataTable(), 0);
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage = 'Unable to load resumes.';
          this.cdr.markForCheck();
        }
      });
  }

  private toRow(r: ResumeDto): ResumeRow {
    const uploadedMs = new Date(r.uploadedAt).getTime();
    return {
      ...r,
      displayName: resumeDisplayLabel(r),
      uploadedMs,
      uploadedLabel: new Date(r.uploadedAt).toLocaleString(),
      activeLabel: r.isActive !== false ? 'Active' : 'Inactive',
      parsedLabel: r.parsed ? 'Yes' : 'No'
    };
  }

  private initDataTable(): void {
    const el = this.resumesDataTable?.nativeElement;
    if (!el || this.tableRows.length === 0) {
      return;
    }
    this.destroyDataTable();
    this.tableClickHandler = (event: Event) => {
      const target = (event.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
      if (!target) return;
      const id = Number(target.dataset['resumeId']);
      if (!Number.isFinite(id)) return;
      const resume = this.resumes.find((x) => x.resumeId === id);
      if (!resume) return;
      const action = target.dataset['action'];
      if (action === 'preview') {
        this.selectPreview(resume);
        this.cdr.markForCheck();
      } else if (action === 'toggle-active') {
        const currentlyActive = resume.isActive !== false;
        const next = !currentlyActive;
        this.resumeService.setResumeActive(id, next).subscribe({
          next: () => this.loadResumes(),
          error: () => {
            this.errorMessage = 'Could not update resume status.';
            this.cdr.markForCheck();
          }
        });
      }
    };
    el.addEventListener('click', this.tableClickHandler);

    this.dataTable = new DataTable(el, {
      data: this.tableRows,
      searching: true,
      paging: true,
      pageLength: 10,
      lengthMenu: [5, 10, 25, 50],
      order: [[2, 'desc']],
      columns: [
        { data: 'displayName' },
        { data: 'fileType' },
        {
          data: 'uploadedMs',
          render: (_v: number, _t: string, row: ResumeRow) => row.uploadedLabel
        },
        { data: 'parsedLabel' },
        { data: 'activeLabel' },
        {
          data: null,
          orderable: false,
          searchable: false,
          render: (_: unknown, __: unknown, row: ResumeRow) => {
            const active = row.isActive !== false;
            return `
              <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-primary" data-action="preview" data-resume-id="${row.resumeId}">Preview</button>
                <button type="button" class="btn ${active ? 'btn-outline-warning' : 'btn-outline-success'}" data-action="toggle-active" data-resume-id="${row.resumeId}">
                  ${active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            `;
          }
        }
      ],
      language: { emptyTable: 'No resumes yet.' }
    });

    const filters = el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-resume-column]');
    filters.forEach((filter) => {
      const listener = () => {
        if (!this.dataTable) return;
        const col = Number(filter.dataset['resumeColumn']);
        if (Number.isNaN(col)) return;
        if (filter instanceof HTMLSelectElement && filter.value === 'all') {
          this.dataTable.column(col).search('').draw();
          return;
        }
        if (filter instanceof HTMLSelectElement) {
          this.dataTable.column(col).search(`^${filter.value}$`, true, false).draw();
          return;
        }
        this.dataTable.column(col).search(filter.value).draw();
      };
      filter.addEventListener('keyup', listener);
      filter.addEventListener('change', listener);
    });
  }

  private destroyDataTable(): void {
    const el = this.resumesDataTable?.nativeElement;
    if (this.tableClickHandler && el) {
      el.removeEventListener('click', this.tableClickHandler);
      this.tableClickHandler = undefined;
    }
    if (this.dataTable) {
      this.dataTable.destroy();
      this.dataTable = null;
    }
  }

  private revokePreviewBlob(): void {
    if (this.previewBlobRawUrl) {
      URL.revokeObjectURL(this.previewBlobRawUrl);
      this.previewBlobRawUrl = null;
      this.previewBlobSafeUrl = null;
    }
  }
}
