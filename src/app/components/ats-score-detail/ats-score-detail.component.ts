import { DecimalPipe, NgClass } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { ApplicationScoreResult } from '../../services/job-application.service';

/**
 * Reusable ATS score panel.
 *
 * Usage:
 *   <app-ats-score-detail [score]="scoreResult" [candidateMode]="true" />
 *
 * candidateMode = true  → Candidate view: overall % + motivational message only.
 * candidateMode = false → Full view: factor bars, matched/missing skills, warnings.
 */
@Component({
  selector: 'app-ats-score-detail',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './ats-score-detail.component.html',
  styleUrl: './ats-score-detail.component.css'
})
export class AtsScoreDetailComponent implements OnChanges {
  @Input() score: ApplicationScoreResult | null = null;
  @Input() isLoading = false;

  /**
   * true  → candidate view (simple message only)
   * false → full breakdown (recruiter / admin / HR view)
   */
  @Input() candidateMode = false;

  protected totalPct = 0;
  protected ringOffset = 0;
  private readonly CIRCUMFERENCE = 2 * Math.PI * 28; // r = 28

  ngOnChanges(): void {
    this.totalPct   = this.score?.matchScore ?? 0;
    this.ringOffset = this.CIRCUMFERENCE * (1 - this.totalPct / 100);
  }

  protected getScoreColor(score: number): string {
    if (score >= 80) return '#16a34a';   // green
    if (score >= 60) return '#2563eb';   // blue
    if (score >= 40) return '#d97706';   // amber
    return '#dc2626';                    // red
  }

  protected get candidateMessage(): string {
    const s = this.totalPct;
    if (s >= 80) return `You are an excellent fit for this role!`;
    if (s >= 60) return `You are a strong match for this role.`;
    if (s >= 40) return `You are a moderate match. Consider highlighting relevant skills.`;
    if (s >= 20) return `Your profile partially matches. Upskilling could improve your chances.`;
    return `Your profile does not closely match the requirements for this role.`;
  }
}
