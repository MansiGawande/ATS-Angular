import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { InterviewNotificationHubService } from './services/interview-notification-hub.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly interviewHub = inject(InterviewNotificationHubService);
  protected readonly interviewToast = this.interviewHub.toastMessage;

  ngOnInit(): void {
    this.interviewHub.startIfAuthenticated();
  }
}
