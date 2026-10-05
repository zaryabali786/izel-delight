import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonSpinner, IonIcon, ToastController, AlertController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  personOutline,
  mailOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  arrowForwardOutline,
  checkmarkCircleOutline,
  sparklesOutline,
  shieldCheckmarkOutline,
  moonOutline,
  sunnyOutline,
  logoGoogle,
  logoApple,
  logoGithub,
  ribbonOutline,
  infiniteOutline,
  storefrontOutline
} from 'ionicons/icons';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    IonContent,
    IonSpinner,
    IonIcon
  ]
})
export class SignupPage implements OnInit {
  signupForm!: FormGroup;
  isLoading = false;
  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    public authService: AuthService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {
    addIcons({
      personOutline,
      mailOutline,
      lockClosedOutline,
      eyeOutline,
      eyeOffOutline,
      arrowForwardOutline,
      checkmarkCircleOutline,
      sparklesOutline,
      shieldCheckmarkOutline,
      moonOutline,
      sunnyOutline,
      logoGoogle,
      logoApple,
      logoGithub,
      ribbonOutline,
      infiniteOutline,
      storefrontOutline
    });
  }

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }

    this.signupForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      storeName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      agreeTerms: [true, [Validators.requiredTrue]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  passwordMatchValidator(g: FormGroup) {
    const password = g.get('password')?.value;
    const confirm = g.get('confirmPassword')?.value;
    return password === confirm ? null : { mismatch: true };
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  getPasswordStrength(): { level: number; label: string; color: string } {
    const password = this.signupForm?.get('password')?.value || '';
    if (!password) {
      return { level: 0, label: 'Empty', color: '#94a3b8' };
    }

    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 2) {
      return { level: 1, label: 'Weak', color: '#f43f5e' };
    } else if (score <= 3) {
      return { level: 2, label: 'Medium', color: '#f59e0b' };
    } else {
      return { level: 3, label: 'Strong', color: '#10b981' };
    }
  }

  async onSubmit(): Promise<void> {
    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const { fullName, storeName, email, password } = this.signupForm.value;

    try {
      const res = await this.authService.signup(fullName, email, password, storeName);
      this.isLoading = false;

      if (res.success) {
        const toast = await this.toastCtrl.create({
          message: `🎉 Account created! Verification email sent to ${email}. Please check your inbox and verify before logging in.`,
          duration: 4500,
          position: 'top',
          color: 'success',
          icon: 'checkmark-circle-outline'
        });
        await toast.present();
        // Automatically route to sign-in page without popup
        this.router.navigate(['/login'], { queryParams: { registered: 'true', email } });
      } else {
        const toast = await this.toastCtrl.create({
          message: res.message,
          duration: 3500,
          position: 'top',
          color: 'danger'
        });
        await toast.present();
      }
    } catch {
      this.isLoading = false;
      const toast = await this.toastCtrl.create({
        message: 'Registration failed. Please try again.',
        duration: 3000,
        position: 'top',
        color: 'danger'
      });
      await toast.present();
    }
  }

  async socialSignup(provider: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: `${provider} signup is not yet supported. Please use email & password.`,
      duration: 3000,
      position: 'top',
      color: 'warning'
    });
    await toast.present();
  }
}
