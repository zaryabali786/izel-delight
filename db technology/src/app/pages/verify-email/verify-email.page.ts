import { Component, OnInit, ChangeDetectorRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent, IonSpinner, IonIcon, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  checkmarkCircleOutline,
  alertCircleOutline,
  mailOutline,
  sparklesOutline,
  arrowForwardOutline,
  refreshOutline,
  shieldCheckmarkOutline,
  keyOutline,
  moonOutline,
  sunnyOutline
} from 'ionicons/icons';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-verify-email',
  templateUrl: './verify-email.page.html',
  styleUrls: ['./verify-email.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonContent,
    IonSpinner,
    IonIcon
  ]
})
export class VerifyEmailPage implements OnInit {
  token: string | null = null;
  email: string = '';
  otpCode: string = '';

  state = signal<'loading' | 'success' | 'input' | 'error'>('input');
  statusMessage = signal<string>('');
  isSubmitting = signal<boolean>(false);
  countdown = signal<number>(3);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public authService: AuthService,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({
      checkmarkCircleOutline,
      alertCircleOutline,
      mailOutline,
      sparklesOutline,
      arrowForwardOutline,
      refreshOutline,
      shieldCheckmarkOutline,
      keyOutline,
      moonOutline,
      sunnyOutline
    });
  }

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      this.token = params['token'] || null;
      this.email = params['email'] || '';

      if (params['verified'] === 'true') {
        this.state.set('success');
        this.statusMessage.set('Email confirmed successfully! Your account and store are now active.');
        this.startAutoRedirect();
        this.cdr.markForCheck();
      } else if (params['error']) {
        this.state.set('error');
        this.statusMessage.set(
          params['error'] === 'invalid_token'
            ? 'Verification link is invalid or has expired. Please enter your email and OTP code below.'
            : 'An error occurred during verification. Please request a new code.'
        );
        this.cdr.markForCheck();
      } else if (this.token) {
        this.verifyWithToken(this.token);
      } else {
        this.state.set('input');
        this.cdr.markForCheck();
      }
    });
  }

  toggleTheme(): void {
    this.authService.toggleTheme();
  }

  async verifyWithToken(token: string): Promise<void> {
    this.state.set('loading');
    this.statusMessage.set('Verifying your email address...');
    this.cdr.markForCheck();

    try {
      const res = await this.authService.verifyEmail(token);
      if (res.success) {
        this.state.set('success');
        this.statusMessage.set(res.message || 'Email verified successfully!');
        this.startAutoRedirect();
      } else {
        this.state.set('error');
        this.statusMessage.set(res.message || 'Verification link is invalid or expired.');
      }
    } catch (err: any) {
      this.state.set('error');
      this.statusMessage.set(err.message || 'Unable to verify email. Please enter your code manually.');
    } finally {
      this.cdr.markForCheck();
    }
  }

  startAutoRedirect(): void {
    let timeLeft = 3;
    this.countdown.set(timeLeft);
    const interval = setInterval(() => {
      timeLeft--;
      this.countdown.set(timeLeft);
      this.cdr.markForCheck();
      if (timeLeft <= 0) {
        clearInterval(interval);
        this.router.navigate(['/login'], { queryParams: { verified: 'true', email: this.email } });
      }
    }, 1000);
  }

  async submitOtp(): Promise<void> {
    if (!this.email || !this.email.trim()) {
      const toast = await this.toastCtrl.create({
        message: 'Please enter your registered email address.',
        duration: 2500,
        color: 'warning',
        position: 'top'
      });
      await toast.present();
      return;
    }

    if (!this.otpCode || this.otpCode.trim().length !== 6) {
      const toast = await this.toastCtrl.create({
        message: 'Please enter the 6-digit verification code sent to your email.',
        duration: 2500,
        color: 'warning',
        position: 'top'
      });
      await toast.present();
      return;
    }

    this.isSubmitting.set(true);
    this.cdr.markForCheck();

    try {
      const res = await this.authService.verifyEmail(undefined, this.otpCode.trim(), this.email.trim());
      if (res.success) {
        this.state.set('success');
        this.statusMessage.set(res.message);
        this.startAutoRedirect();
      } else {
        const toast = await this.toastCtrl.create({
          message: res.message,
          duration: 3500,
          color: 'danger',
          position: 'top'
        });
        await toast.present();
      }
    } finally {
      this.isSubmitting.set(false);
      this.cdr.markForCheck();
    }
  }

  async resendEmail(): Promise<void> {
    if (!this.email || !this.email.trim()) {
      const toast = await this.toastCtrl.create({
        message: 'Please provide your email address to resend.',
        duration: 2500,
        color: 'warning',
        position: 'top'
      });
      await toast.present();
      return;
    }

    this.isSubmitting.set(true);
    this.cdr.markForCheck();

    try {
      const res = await this.authService.resendVerification(this.email.trim());
      const toast = await this.toastCtrl.create({
        message: res.message,
        duration: 3500,
        color: res.success ? 'primary' : 'danger',
        position: 'top'
      });
      await toast.present();
    } finally {
      this.isSubmitting.set(false);
      this.cdr.markForCheck();
    }
  }
}
