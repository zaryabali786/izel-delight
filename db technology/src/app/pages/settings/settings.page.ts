import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  settingsOutline,
  shieldCheckmarkOutline,
  walletOutline,
  saveOutline,
  keyOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../core/services/analytics.service';
import { AuthService } from '../../core/services/auth.service';
import { StoreService } from '../../core/services/store.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon]
})
export class SettingsPage {
  constructor(
    public analytics: AnalyticsService,
    public authService: AuthService,
    public storeService: StoreService,
    private toastCtrl: ToastController
  ) {
    addIcons({
      settingsOutline,
      shieldCheckmarkOutline,
      walletOutline,
      saveOutline,
      keyOutline
    });
  }

  async saveSettings(): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: '✅ Configuration saved successfully!',
      duration: 2000,
      position: 'top',
      color: 'success'
    });
    await toast.present();
  }
}
