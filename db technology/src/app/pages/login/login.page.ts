import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { IonContent, IonSpinner, IonIcon, ToastController, AlertController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  mailOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  arrowForwardOutline,
  flashOutline,
  sparklesOutline,
  shieldCheckmarkOutline,
  moonOutline,
  sunnyOutline,
  logoGoogle,
  logoApple,
  logoGithub
} from 'ionicons/icons';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    IonContent,
    IonSpinner,
    IonIcon
  ]
})
export class LoginPage implements OnInit {
  loginForm!: FormGroup;
  isLoading = false;
  showPassword = false;
  rememberMe = true;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    public authService: AuthService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {
    addIcons({
      mailOutline,
      lockClosedOutline,
      eyeOutline,
      eyeOffOutline,
      arrowForwardOutline,
      flashOutline,
      sparklesOutline,
      shieldCheckmarkOutline,
      moonOutline,
      sunnyOutline,
      logoGoogle,
      logoApple,
      logoGithub
    });
  }

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }

    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.route.queryParams.subscribe(async (params) => {
      if (params['email']) {
        this.loginForm.patchValue({ email: params['email'] });
      }

      if (params['verified'] === 'true') {
        const toast = await this.toastCtrl.create({
          message: '✅ Email verified successfully! You can now sign in with your password.',
          duration: 4000,
          position: 'top',
          color: 'success',
          icon: 'checkmark-circle-outline'
        });
        await toast.present();
      } else if (params['registered'] === 'true') {
        const toast = await this.toastCtrl.create({
          message: '✉️ Please verify your email before logging in. Check your inbox for the link or code.',
          duration: 5000,
          position: 'top',
          color: 'warning',
          icon: 'mail-outline'
        });
        await toast.present();
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  async onSubmit(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const { email, password } = this.loginForm.value;

    try {
      const res = await this.authService.login(email, password);
      this.isLoading = false;

      if (res.success) {
        const toast = await this.toastCtrl.create({
          message: `👋 Welcome back, ${res.user?.name || 'User'}!`,
          duration: 2500,
          position: 'top',
          color: 'success'
        });
        await toast.present();
        this.router.navigate(['/dashboard']);
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
        message: 'Something went wrong. Please try again.',
        duration: 3000,
        position: 'top',
        color: 'danger'
      });
      await toast.present();
    }
  }


  async forgotPassword(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Reset Password',
      message: 'Enter your registered email address and we will send you a reset link.',
      inputs: [
        {
          name: 'email',
          type: 'email',
          placeholder: 'name@example.com',
          value: this.loginForm.get('email')?.value || ''
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Send Reset Link',
          handler: async (data: any) => {
            if (data?.email) {
              const res = await this.authService.forgotPassword(data.email);
              const toast = await this.toastCtrl.create({
                message: res.message,
                duration: 3500,
                position: 'top',
                color: res.success ? 'primary' : 'danger'
              });
              await toast.present();
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async socialLogin(provider: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: `${provider} login is not yet supported. Please use email & password.`,
      duration: 3000,
      position: 'top',
      color: 'warning'
    });
    await toast.present();
  }
}
