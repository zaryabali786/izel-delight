import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  logoWhatsapp,
  logoFacebook,
  logoInstagram,
  logoGoogle,
  mailOutline,
  bagHandleOutline,
  sparklesOutline,
  linkOutline,
  closeOutline,
  copyOutline,
  chatbubblesOutline
} from 'ionicons/icons';
import { AnalyticsService } from '../../core/services/analytics.service';
import { StoreService } from '../../core/services/store.service';
import { SupportChannelItem } from '../../core/models/analytics.models';

@Component({
  selector: 'app-channels',
  templateUrl: './channels.page.html',
  styleUrls: ['./channels.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon]
})
export class ChannelsPage {
  emailAddress = signal<string>('');
  emailName = signal<string>('');
  showEmailForm = signal<boolean>(false);

  activeStore = computed(() => this.storeService.activeStore());

  channelsOf = (type: SupportChannelItem['channel_type']) =>
    computed(() => this.analytics.supportChannels().filter((c) => c.channel_type === type && c.status !== 'disconnected'));

  facebook = this.channelsOf('facebook');
  instagram = this.channelsOf('instagram');
  email = this.channelsOf('email');
  shopify = this.channelsOf('shopify');

  whatsappIntegration = computed(() => this.analytics.integrations().find((i) => i.id === 'whatsapp-business'));

  constructor(public analytics: AnalyticsService, private storeService: StoreService, private router: Router) {
    addIcons({
      logoWhatsapp,
      logoFacebook,
      logoInstagram,
      logoGoogle,
      mailOutline,
      bagHandleOutline,
      sparklesOutline,
      linkOutline,
      closeOutline,
      copyOutline,
      chatbubblesOutline
    });
    const storeId = this.storeService.activeStore()?.id;
    if (storeId) this.analytics.loadSupportChannels(storeId);
  }

  async saveEmail(): Promise<void> {
    const ok = await this.analytics.connectEmailChannel(this.emailAddress(), this.emailName());
    if (ok) {
      this.showEmailForm.set(false);
      this.emailAddress.set('');
      this.emailName.set('');
    }
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  openWhatsAppSetup(): void {
    this.router.navigate(['/dashboard/integrations']);
  }
}
